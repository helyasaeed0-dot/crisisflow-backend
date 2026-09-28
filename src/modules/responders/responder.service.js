const Responder = require('./responder.model');
const Assignment = require('../assignments/assignment.model');
const { ACTIVE_ASSIGNMENT_STATUSES } = require('./responder.matcher');
const notificationService = require('../notifications/notification.service');
const { logAction } = require('../audit/audit.service');
const ApiError = require('../../utils/ApiError');
const { toPoint } = require('../../utils/pointSchema');
const { haversineKm, estimateEtaMinutes, fromPoint } = require('../../utils/geo');
const {
  ASSIGNMENT_STATUS,
  RESPONDER_AVAILABILITY,
  VERIFICATION_STATUS,
} = require('../../utils/constants');
const EVENTS = require('../../websocket/events');
const { emitToAdmins, emitToIncident } = require('../../websocket/emitter');

const NEARBY_THRESHOLD_KM = 0.5;

// Statuses where the responder is actually working the incident
const WORKING_STATUSES = [
  ASSIGNMENT_STATUS.ACCEPTED,
  ASSIGNMENT_STATUS.ON_THE_WAY,
  ASSIGNMENT_STATUS.ARRIVED,
  ASSIGNMENT_STATUS.HANDLING,
];

const INCIDENT_FIELDS =
  'referenceId category severity severityScore status location address description aiAnalysis.requiredResources createdAt';

async function getMyResponder(user) {
  const responder = await Responder.findOne({ user: user._id });
  if (!responder) throw new ApiError(404, 'Responder profile not found');
  return responder;
}

/**
 * Pushes the responder's live position to admins and to each incident they are working.
 * Also updates ETA and sends a one-time "Responder Nearby" notification to citizens.
 * Exported so Demo Mode can reuse it for simulated movement.
 */
async function broadcastResponderLocation(responder, name) {
  const pos = fromPoint(responder.location);
  if (!pos) return { activeAssignments: [] };

  const active = await Assignment.find({
    responder: responder._id,
    status: { $in: WORKING_STATUSES },
  }).populate('incident', 'location referenceId');

  const activeAssignments = [];

  for (const assignment of active) {
    if (!assignment.incident) continue;

    const inc = fromPoint(assignment.incident.location);
    const distanceKm = Number(haversineKm(pos.latitude, pos.longitude, inc.latitude, inc.longitude).toFixed(2));
    const etaMinutes = estimateEtaMinutes(distanceKm);

    assignment.distanceKm = distanceKm;
    assignment.etaMinutes = etaMinutes;

    if (
      !assignment.nearbyNotified &&
      assignment.status === ASSIGNMENT_STATUS.ON_THE_WAY &&
      distanceKm <= NEARBY_THRESHOLD_KM
    ) {
      assignment.nearbyNotified = true;
      notificationService.notifyIncidentReporters(assignment.incident._id, {
        title: 'Responder Nearby',
        message: `Help is about ${etaMinutes} minute(s) away`,
        type: 'RESPONDER_NEARBY',
        data: { incidentId: assignment.incident._id },
      });
    }

    await assignment.save();

    const item = {
      incidentId: assignment.incident._id,
      assignmentId: assignment._id,
      status: assignment.status,
      distanceKm,
      etaMinutes,
    };
    activeAssignments.push(item);

    emitToIncident(assignment.incident._id.toString(), EVENTS.RESPONDER_LOCATION_UPDATED, {
      responderId: responder._id,
      type: responder.type,
      location: pos,
      ...item,
    });
  }

  emitToAdmins(EVENTS.RESPONDER_LOCATION_UPDATED, {
    responderId: responder._id,
    name,
    type: responder.type,
    availability: responder.availability,
    location: pos,
    activeAssignments,
  });

  return { activeAssignments };
}

async function updateMyStatus(user, { availability, latitude, longitude }) {
  const responder = await getMyResponder(user);

  if (availability) {
    const hasActive = await Assignment.exists({
      responder: responder._id,
      status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
    });
    if (hasActive) {
      throw new ApiError(409, 'Finish your active assignment before changing availability');
    }
    responder.availability = availability;
  }

  if (latitude !== undefined && longitude !== undefined) {
    responder.location = toPoint(latitude, longitude);
    responder.lastLocationAt = new Date();
  }

  await responder.save();
  const { activeAssignments } = await broadcastResponderLocation(responder, user.name);
  return { responder, activeAssignments };
}

async function getMyProfile(user) {
  const responder = await getMyResponder(user);
  const activeAssignments = await Assignment.find({
    responder: responder._id,
    status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
  })
    .sort({ assignedAt: -1 })
    .populate('incident', INCIDENT_FIELDS);

  return { responder, activeAssignments };
}

async function getMyAssignments(user, { active }) {
  const responder = await getMyResponder(user);
  const filter = { responder: responder._id };
  if (active) filter.status = { $in: ACTIVE_ASSIGNMENT_STATUSES };

  return Assignment.find(filter)
    .sort({ assignedAt: -1 })
    .limit(50)
    .populate('incident', INCIDENT_FIELDS);
}

async function listResponders(query) {
  const filter = {};
  if (query.type) filter.type = query.type;
  if (query.availability) filter.availability = query.availability;
  if (query.verificationStatus) filter.verificationStatus = query.verificationStatus;

  const { page, limit } = query;
  const [items, total] = await Promise.all([
    Responder.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('user', 'name email phone'),
    Responder.countDocuments(filter),
  ]);

  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function findNearby({ latitude, longitude, radiusKm, type, availableOnly }) {
  const filter = {
    verificationStatus: VERIFICATION_STATUS.VERIFIED,
    location: {
      $near: {
        $geometry: toPoint(latitude, longitude),
        $maxDistance: radiusKm * 1000,
      },
    },
  };
  if (type) filter.type = type;
  if (availableOnly) filter.availability = RESPONDER_AVAILABILITY.AVAILABLE;

  const responders = await Responder.find(filter).limit(50).populate('user', 'name phone');

  return responders.map((r) => {
    const pos = fromPoint(r.location);
    const distanceKm = Number(haversineKm(latitude, longitude, pos.latitude, pos.longitude).toFixed(2));
    return { responder: r, distanceKm, etaMinutes: estimateEtaMinutes(distanceKm) };
  });
}

async function verifyResponder(adminUser, responderId, { verificationStatus }) {
  const responder = await Responder.findById(responderId).populate('user', 'name');
  if (!responder) throw new ApiError(404, 'Responder not found');

  responder.verificationStatus = verificationStatus;
  if (verificationStatus === VERIFICATION_STATUS.REJECTED) {
    responder.availability = RESPONDER_AVAILABILITY.OFFLINE;
  }
  await responder.save();

  await logAction({
    userId: adminUser._id,
    action: `RESPONDER_${verificationStatus}`,
    entity: 'Responder',
    entityId: responder._id,
  });

  notificationService.notifyUser(responder.user._id, {
    title: 'Verification Update',
    message: `Your responder account is now ${verificationStatus}`,
    type: 'VERIFICATION',
    data: { responderId: responder._id },
  });

  return responder;
}

module.exports = {
  updateMyStatus,
  getMyProfile,
  getMyAssignments,
  listResponders,
  findNearby,
  verifyResponder,
  broadcastResponderLocation,
};