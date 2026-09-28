const Assignment = require('./assignment.model');
const Incident = require('../incidents/incident.model');
const Responder = require('../responders/responder.model');
const matcher = require('../responders/responder.matcher');
const { addStatus, broadcastIncident, isAdmin } = require('../incidents/incident.service');
const notificationService = require('../notifications/notification.service');
const { logAction } = require('../audit/audit.service');
const ApiError = require('../../utils/ApiError');
const {
  ROLES,
  INCIDENT_STATUS,
  ASSIGNMENT_STATUS,
  RESPONDER_AVAILABILITY,
  VERIFICATION_STATUS,
} = require('../../utils/constants');
const EVENTS = require('../../websocket/events');
const { emitToAdmins, emitToIncident, emitToUser } = require('../../websocket/emitter');

const { ACTIVE_ASSIGNMENT_STATUSES } = matcher;
const CLOSED_STATUSES = [INCIDENT_STATUS.RESOLVED, INCIDENT_STATUS.CLOSED];
const INCIDENT_ORDER = Object.values(INCIDENT_STATUS);

const isAfter = (a, b) => INCIDENT_ORDER.indexOf(a) > INCIDENT_ORDER.indexOf(b);

// Steps a responder moves through, in order
const RESPONDER_FLOW = [
  ASSIGNMENT_STATUS.ACCEPTED,
  ASSIGNMENT_STATUS.ON_THE_WAY,
  ASSIGNMENT_STATUS.ARRIVED,
  ASSIGNMENT_STATUS.HANDLING,
  ASSIGNMENT_STATUS.COMPLETED,
];

// Incident status sent by the responder -> assignment status
const STATUS_TO_ASSIGNMENT = {
  ON_THE_WAY: ASSIGNMENT_STATUS.ON_THE_WAY,
  ARRIVED: ASSIGNMENT_STATUS.ARRIVED,
  HANDLING: ASSIGNMENT_STATUS.HANDLING,
  RESOLVED: ASSIGNMENT_STATUS.COMPLETED,
};

const ASSIGNMENT_TIMESTAMP = {
  ACCEPTED: 'acceptedAt',
  DECLINED: 'declinedAt',
  ON_THE_WAY: 'onTheWayAt',
  ARRIVED: 'arrivedAt',
  HANDLING: 'handlingAt',
  COMPLETED: 'completedAt',
};

// Citizen-facing messages for each responder step
const CITIZEN_MESSAGES = {
  ON_THE_WAY: { title: 'Responder On the Way', message: 'A responder is on the way to your location', type: 'RESPONDER_ON_THE_WAY' },
  ARRIVED: { title: 'Responder Arrived', message: 'The responder has arrived at the scene', type: 'RESPONDER_ARRIVED' },
  HANDLING: { title: 'Help in Progress', message: 'Responders are handling the emergency', type: 'RESPONDER_HANDLING' },
};

function populateAssignment(id) {
  return Assignment.findById(id).populate({
    path: 'responder',
    select: 'type location availability',
    populate: { path: 'user', select: 'name phone' },
  });
}

async function getIncidentOrFail(incidentId) {
  const incident = await Incident.findById(incidentId);
  if (!incident) throw new ApiError(404, 'Incident not found');
  return incident;
}

async function getMyResponder(user) {
  const responder = await Responder.findOne({ user: user._id });
  if (!responder) throw new ApiError(404, 'Responder profile not found');
  return responder;
}

async function getRecommendations(incidentId, query) {
  const incident = await getIncidentOrFail(incidentId);
  if (CLOSED_STATUSES.includes(incident.status)) {
    throw new ApiError(409, 'Incident is already resolved');
  }
  const result = await matcher.getRecommendations(incident, query);
  return {
    incident: {
      _id: incident._id,
      referenceId: incident.referenceId,
      category: incident.category,
      severity: incident.severity,
      status: incident.status,
    },
    ...result,
  };
}

async function assignResponders(adminUser, incidentId, responderIds) {
  const incident = await getIncidentOrFail(incidentId);
  if (CLOSED_STATUSES.includes(incident.status)) {
    throw new ApiError(409, 'Incident is already resolved');
  }

  const uniqueIds = [...new Set(responderIds.map(String))];
  const responders = await Responder.find({ _id: { $in: uniqueIds } }).populate('user', 'name');
  if (responders.length !== uniqueIds.length) {
    throw new ApiError(404, 'One or more responders were not found');
  }

  for (const r of responders) {
    if (r.verificationStatus !== VERIFICATION_STATUS.VERIFIED) {
      throw new ApiError(409, `${r.user.name} is not verified`);
    }
    if (!r.location) {
      throw new ApiError(409, `${r.user.name} has no known location`);
    }
  }

  const created = [];
  const skipped = [];

  for (const r of responders) {
    // Atomic claim: succeeds only if the responder is still available
    const claimed = await Responder.findOneAndUpdate(
      { _id: r._id, availability: RESPONDER_AVAILABILITY.AVAILABLE },
      { availability: RESPONDER_AVAILABILITY.BUSY },
      { new: true }
    );
    if (!claimed) {
      skipped.push({ responderId: r._id, name: r.user.name, reason: 'Not available' });
      continue;
    }

    const match = matcher.scoreResponder(r, incident);
    const assignment = await Assignment.create({
      incident: incident._id,
      responder: r._id,
      assignedBy: adminUser._id,
      matchScore: match.score,
      distanceKm: match.distanceKm,
      etaMinutes: match.etaMinutes,
      isDemo: incident.isDemo,
    });
    created.push(assignment);

    notificationService.notifyUser(r.user._id, {
      title: 'New Assignment',
      message: `${incident.severity} ${incident.category} incident, ${match.distanceKm} km away`,
      type: 'ASSIGNMENT',
      data: { incidentId: incident._id, assignmentId: assignment._id },
    });
    emitToUser(r.user._id.toString(), EVENTS.INCIDENT_ASSIGNED, {
      incident: incident.toJSON(),
      assignment: assignment.toJSON(),
    });
  }

  if (!created.length) {
    throw new ApiError(409, 'Selected responders are no longer available');
  }

  if ([INCIDENT_STATUS.REPORTED, INCIDENT_STATUS.AI_ANALYSIS, INCIDENT_STATUS.VERIFIED].includes(incident.status)) {
    addStatus(incident, INCIDENT_STATUS.ASSIGNED, adminUser._id, `Assigned to ${created.length} responder(s)`);
  }
  await incident.save();

  await logAction({
    userId: adminUser._id,
    action: 'RESPONDERS_ASSIGNED',
    entity: 'Incident',
    entityId: incident._id,
    meta: { responderIds: created.map((a) => a.responder), skipped },
  });

  broadcastIncident(incident, EVENTS.INCIDENT_ASSIGNED);
  notificationService.notifyIncidentReporters(incident._id, {
    title: 'Responder Assigned',
    message: 'Help has been assigned to your emergency',
    type: 'RESPONDER_ASSIGNED',
    data: { incidentId: incident._id },
  });

  const assignments = await Promise.all(created.map((a) => populateAssignment(a._id)));
  return { incident, assignments, skipped };
}

async function respondToAssignment(user, incidentId, action) {
  const responder = await getMyResponder(user);
  const assignment = await Assignment.findOne({
    incident: incidentId,
    responder: responder._id,
    status: ASSIGNMENT_STATUS.ASSIGNED,
  });
  if (!assignment) throw new ApiError(404, 'No pending assignment for this incident');

  const incident = await getIncidentOrFail(incidentId);
  const now = new Date();

  if (action === 'accept') {
    assignment.status = ASSIGNMENT_STATUS.ACCEPTED;
    assignment.acceptedAt = now;
    await assignment.save();

    if (incident.status === INCIDENT_STATUS.ASSIGNED) {
      addStatus(incident, INCIDENT_STATUS.ACCEPTED, user._id, `Accepted by ${user.name}`);
    }
    await incident.save();

    const payload = { incidentId: incident._id, assignment: assignment.toJSON(), responderName: user.name };
    emitToAdmins(EVENTS.RESPONDER_ACCEPTED, payload);
    emitToIncident(incident._id.toString(), EVENTS.RESPONDER_ACCEPTED, payload);
  } else {
    assignment.status = ASSIGNMENT_STATUS.DECLINED;
    assignment.declinedAt = now;
    await assignment.save();

    await Responder.updateOne({ _id: responder._id }, { availability: RESPONDER_AVAILABILITY.AVAILABLE });

    // If nobody else is working on it, send it back for reassignment
    const stillActive = await Assignment.exists({
      incident: incident._id,
      status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
    });
    if (!stillActive && incident.status === INCIDENT_STATUS.ASSIGNED) {
      addStatus(incident, INCIDENT_STATUS.VERIFIED, user._id, 'Assignment declined, awaiting reassignment');
    }
    await incident.save();

    notificationService.notifyAdmins({
      title: 'Assignment Declined',
      message: `${user.name} declined incident ${incident.referenceId}`,
      type: 'ASSIGNMENT_DECLINED',
      data: { incidentId: incident._id },
    });
  }

  broadcastIncident(incident);
  return { incident, assignment: await populateAssignment(assignment._id) };
}

// Resolves the incident and frees every responder working on it
async function resolveIncident(incident, actorId, note, extraResponderIds = []) {
  const now = new Date();
  addStatus(incident, INCIDENT_STATUS.RESOLVED, actorId, note);
  incident.resolvedAt = now;
  incident.needsReview = false;
  await incident.save();

  const active = await Assignment.find({
    incident: incident._id,
    status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
  });

  // Never-accepted assignments are cancelled, accepted ones are completed
  await Assignment.updateMany(
    { incident: incident._id, status: ASSIGNMENT_STATUS.ASSIGNED },
    { status: ASSIGNMENT_STATUS.CANCELLED }
  );
  await Assignment.updateMany(
    { incident: incident._id, status: { $in: ACTIVE_ASSIGNMENT_STATUSES } },
    { status: ASSIGNMENT_STATUS.COMPLETED, completedAt: now }
  );

  const responderIds = [...active.map((a) => a.responder), ...extraResponderIds];
  await Responder.updateMany(
    { _id: { $in: responderIds } },
    { availability: RESPONDER_AVAILABILITY.AVAILABLE }
  );

  broadcastIncident(incident, EVENTS.INCIDENT_RESOLVED);
  notificationService.notifyIncidentReporters(incident._id, {
    title: 'Emergency Resolved',
    message: `Incident ${incident.referenceId} has been resolved`,
    type: 'INCIDENT_RESOLVED',
    data: { incidentId: incident._id },
  });

  return incident;
}

async function responderUpdateStatus(user, incidentId, { status, note }) {
  const target = STATUS_TO_ASSIGNMENT[status];
  if (!target) {
    throw new ApiError(400, 'Responders can set status to ON_THE_WAY, ARRIVED, HANDLING or RESOLVED');
  }

  const responder = await getMyResponder(user);
  const assignment = await Assignment.findOne({
    incident: incidentId,
    responder: responder._id,
    status: {
      $in: [
        ASSIGNMENT_STATUS.ACCEPTED,
        ASSIGNMENT_STATUS.ON_THE_WAY,
        ASSIGNMENT_STATUS.ARRIVED,
        ASSIGNMENT_STATUS.HANDLING,
      ],
    },
  });
  if (!assignment) {
    throw new ApiError(404, 'No accepted assignment for this incident. Accept it first.');
  }

  const currentIndex = RESPONDER_FLOW.indexOf(assignment.status);
  const nextIndex = RESPONDER_FLOW.indexOf(target);
  if (nextIndex <= currentIndex) {
    throw new ApiError(400, `Cannot move from ${assignment.status} to ${status}`);
  }

  assignment.status = target;
  assignment[ASSIGNMENT_TIMESTAMP[target]] = new Date();
  await assignment.save();

  const incident = await getIncidentOrFail(incidentId);

  if (status === INCIDENT_STATUS.RESOLVED) {
    await resolveIncident(incident, user._id, note || `Resolved by ${user.name}`, [responder._id]);
  } else {
    // Notify citizens only when the incident itself moves forward,
    // so several responders on one incident do not send the same message twice
    const advanced = isAfter(status, incident.status);
    if (advanced) {
      addStatus(incident, status, user._id, note || `${user.name}: ${status}`);
    }
    await incident.save();
    broadcastIncident(incident);

    const msg = CITIZEN_MESSAGES[status];
    if (msg && advanced) {
      notificationService.notifyIncidentReporters(incident._id, { ...msg, data: { incidentId: incident._id } });
    }
  }

  return { incident, assignment: await populateAssignment(assignment._id) };
}

async function adminUpdateStatus(adminUser, incidentId, { status, note }) {
  const incident = await getIncidentOrFail(incidentId);

  if (status === INCIDENT_STATUS.RESOLVED) {
    if (CLOSED_STATUSES.includes(incident.status)) {
      throw new ApiError(409, 'Incident is already resolved');
    }
    await resolveIncident(incident, adminUser._id, note || 'Resolved by admin');
  } else if (status === INCIDENT_STATUS.CLOSED) {
    if (incident.status !== INCIDENT_STATUS.RESOLVED) {
      throw new ApiError(409, 'Only resolved incidents can be closed');
    }
    addStatus(incident, INCIDENT_STATUS.CLOSED, adminUser._id, note || 'Closed and audited');
    incident.closedAt = new Date();
    await incident.save();
    broadcastIncident(incident);
  } else {
    throw new ApiError(400, 'Admins can set status to RESOLVED or CLOSED');
  }

  await logAction({
    userId: adminUser._id,
    action: `INCIDENT_${status}`,
    entity: 'Incident',
    entityId: incident._id,
    meta: { note },
  });

  return { incident };
}

async function updateIncidentStatus(user, incidentId, body) {
  if (isAdmin(user)) return adminUpdateStatus(user, incidentId, body);
  if (user.role === ROLES.RESPONDER) return responderUpdateStatus(user, incidentId, body);
  throw new ApiError(403, 'You do not have permission to perform this action');
}

module.exports = {
  getRecommendations,
  assignResponders,
  respondToAssignment,
  updateIncidentStatus,
  resolveIncident,
};