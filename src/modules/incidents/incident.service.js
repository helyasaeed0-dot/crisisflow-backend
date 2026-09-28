const Incident = require('./incident.model');
const IncidentReport = require('./incidentReport.model');
const Assignment = require('../assignments/assignment.model');
const Responder = require('../responders/responder.model');
const aiService = require('../ai/ai.service');
const matcher = require('../responders/responder.matcher');
const notificationService = require('../notifications/notification.service');
const { findDuplicateIncident } = require('../ai/duplicate.detector');
const { logAction } = require('../audit/audit.service');
const ApiError = require('../../utils/ApiError');
const { toPoint } = require('../../utils/pointSchema');
const { generateReferenceId } = require('../../utils/referenceId');
const { signMediaUrl } = require('../../utils/signedUrl');
const {
  ROLES,
  INCIDENT_STATUS,
  INCIDENT_CATEGORIES,
  SEVERITY,
} = require('../../utils/constants');
const EVENTS = require('../../websocket/events');
const { emitToAdmins, emitToIncident } = require('../../websocket/emitter');

const ADMIN_ROLES = [ROLES.ADMIN, ROLES.SUPER_ADMIN];
const CLOSED_STATUSES = [INCIDENT_STATUS.RESOLVED, INCIDENT_STATUS.CLOSED];

// Admins get a "Duplicate Cluster" alert when this many reports are merged
const DUPLICATE_CLUSTER_ALERT_AT = 3;

const isAdmin = (user) => ADMIN_ROLES.includes(user.role);

function addStatus(incident, status, userId, note) {
  incident.status = status;
  incident.statusHistory.push({ status, changedBy: userId || undefined, note });
}

function broadcastIncident(incident, event = EVENTS.INCIDENT_UPDATED) {
  const payload = incident.toJSON();
  emitToAdmins(event, payload);
  emitToIncident(incident._id.toString(), event, payload);
}

const mapFiles = (files = []) =>
  files.map((f) => ({
    url: `/uploads/${f.filename}`,
    mediaType: f.mimetype.split('/')[0],
  }));

// Retries if the random reference ID ever collides
async function createIncidentWithUniqueRef(data) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await Incident.create({ ...data, referenceId: generateReferenceId() });
    } catch (err) {
      if (err.code === 11000 && err.keyPattern && err.keyPattern.referenceId) continue;
      throw err;
    }
  }
  throw new ApiError(500, 'Could not generate a unique reference ID');
}

// Runs AI analysis after the response is sent, so the citizen gets an instant reply
function runAnalysisInBackground(incidentId, actorId = null) {
  setImmediate(() => {
    analyzeIncident(incidentId, actorId).catch((err) => {
      console.error(`Background analysis failed for ${incidentId}:`, err.message);
    });
  });
}

// Warns admins when a required responder type has nobody available nearby
async function checkResourceAvailability(incident) {
  try {
    const { missingResources } = await matcher.getRecommendations(incident, { limit: 1 });
    if (missingResources.length) {
      notificationService.notifyAdmins({
        title: 'Resource Unavailable',
        message: `No available ${missingResources.join(', ')} near incident ${incident.referenceId}`,
        type: 'RESOURCE_UNAVAILABLE',
        data: { incidentId: incident._id, missingResources },
      });
    }
  } catch (err) {
    console.error('Resource availability check failed:', err.message);
  }
}

async function createReport(user, body, files = [], { isDemo = false } = {}) {
  const location = toPoint(body.latitude, body.longitude);
  const media = mapFiles(files);

  const duplicate = await findDuplicateIncident({
    category: body.category,
    location,
    description: body.description,
    isDemo,
  });

  // Same event already reported: link this report as evidence
  if (duplicate) {
    const report = await IncidentReport.create({
      incident: duplicate.incident._id,
      user: user._id,
      category: body.category,
      description: body.description,
      media,
      location,
      address: body.address,
      isDuplicate: true,
      isDemo,
    });

    const incident = await Incident.findOneAndUpdate(
      { _id: duplicate.incident._id },
      { $inc: { reportCount: 1 } },
      { new: true }
    );

    notificationService.notifyUser(user._id, {
      title: 'Report Received',
      message: `Your report was linked to incident ${incident.referenceId}`,
      type: 'REPORT_RECEIVED',
      data: { incidentId: incident._id, referenceId: incident.referenceId },
    });

    if (incident.reportCount === DUPLICATE_CLUSTER_ALERT_AT) {
      notificationService.notifyAdmins({
        title: 'Duplicate Cluster',
        message: `${incident.reportCount} reports merged into incident ${incident.referenceId}`,
        type: 'DUPLICATE_CLUSTER',
        data: { incidentId: incident._id },
      });
    }

    runAnalysisInBackground(incident._id);

    return {
      merged: true,
      incident,
      report,
      duplicateInfo: {
        distanceM: duplicate.distanceM,
        textSimilarity: duplicate.textSimilarity,
        matchScore: duplicate.matchScore,
      },
    };
  }

  const incident = await createIncidentWithUniqueRef({
    category: body.category,
    description: body.description,
    location,
    address: body.address,
    createdBy: user._id,
    isDemo,
    status: INCIDENT_STATUS.REPORTED,
    statusHistory: [
      { status: INCIDENT_STATUS.REPORTED, changedBy: user._id, note: 'Report submitted' },
    ],
  });

  const report = await IncidentReport.create({
    incident: incident._id,
    user: user._id,
    category: body.category,
    description: body.description,
    media,
    location,
    address: body.address,
    isDemo,
  });

  notificationService.notifyUser(user._id, {
    title: 'Report Received',
    message: `Your emergency report ${incident.referenceId} has been received`,
    type: 'REPORT_RECEIVED',
    data: { incidentId: incident._id, referenceId: incident.referenceId },
  });

  broadcastIncident(incident, EVENTS.INCIDENT_CREATED);
  runAnalysisInBackground(incident._id);

  return { merged: false, incident, report };
}

async function analyzeIncident(incidentId, actorId = null) {
  const incident = await Incident.findById(incidentId);
  if (!incident) throw new ApiError(404, 'Incident not found');
  if (CLOSED_STATUSES.includes(incident.status)) return incident;

  const previousSeverity = incident.severity;

  if (incident.status === INCIDENT_STATUS.REPORTED) {
    addStatus(incident, INCIDENT_STATUS.AI_ANALYSIS, actorId, 'AI analysis started');
    await incident.save();
    broadcastIncident(incident);
  }

  const isFirstAnalysis = incident.status === INCIDENT_STATUS.AI_ANALYSIS;

  // Combine all linked reports so the AI sees the full picture
  const reports = await IncidentReport.find({ incident: incident._id }).select('description');
  const text = reports.map((r) => r.description).filter(Boolean).join('. ');
  const reportCount = Math.max(incident.reportCount, reports.length);

  const result = await aiService.analyzeIncidentText({
    category: incident.category,
    text,
    reportCount,
  });

  incident.aiAnalysis = {
    category: result.category,
    severity: result.severity,
    confidence: result.confidence,
    requiredResources: result.requiredResources,
    factors: result.factors,
    scoreBreakdown: result.scoreBreakdown,
    reason: result.reason,
    source: result.source,
    analyzedAt: new Date(),
  };

  // Never overwrite a manual admin override
  if (!incident.verification || !incident.verification.overridden) {
    incident.category = result.category;
    incident.severity = result.severity;
    incident.severityScore = result.severityScore;
  }

  const adminVerified = Boolean(incident.verification && incident.verification.verifiedAt);
  incident.needsReview =
    !adminVerified && (incident.severity === SEVERITY.CRITICAL || result.confidence < 0.6);

  if (isFirstAnalysis) {
    addStatus(incident, INCIDENT_STATUS.VERIFIED, actorId, 'Prioritized automatically by AI analysis');
  }

  await incident.save();
  broadcastIncident(incident);

  if (isFirstAnalysis) {
    notificationService.notifyIncidentReporters(incident._id, {
      title: 'Analysis Complete',
      message: `Your emergency has been prioritized as ${incident.severity}`,
      type: 'ANALYSIS_COMPLETE',
      data: { incidentId: incident._id, severity: incident.severity },
    });
    checkResourceAvailability(incident);
  }

  if (incident.severity === SEVERITY.CRITICAL && previousSeverity !== SEVERITY.CRITICAL) {
    notificationService.notifyAdmins({
      title: 'Critical Incident',
      message: `${incident.category} at ${incident.address || 'reported location'} (${incident.referenceId})`,
      type: 'CRITICAL_INCIDENT',
      data: { incidentId: incident._id },
    });
  }

  return incident;
}

async function getIncidentById(user, incidentId) {
  await assertCanView(user, incidentId);

  const admin = isAdmin(user);
  let incidentQuery = Incident.findById(incidentId);
  if (admin) incidentQuery = incidentQuery.populate('createdBy', 'name phone');

  const incident = await incidentQuery;
  if (!incident) throw new ApiError(404, 'Incident not found');

  // Citizens only see their own reports; staff see all
  const reportFilter = user.role === ROLES.CITIZEN
    ? { incident: incidentId, user: user._id }
    : { incident: incidentId };

  let reportQuery = IncidentReport.find(reportFilter).sort({ createdAt: 1 });
  reportQuery = admin ? reportQuery.populate('user', 'name phone') : reportQuery.select('-user');

  const [reports, assignments] = await Promise.all([
    reportQuery,
    Assignment.find({ incident: incidentId })
      .sort({ assignedAt: -1 })
      .populate({
        path: 'responder',
        select: 'type location availability',
        populate: { path: 'user', select: 'name phone' },
      }),
  ]);

  // Replace stored file paths with temporary signed links
  const reportsData = reports.map((report) => {
    const json = report.toJSON();
    json.media = (json.media || []).map((m) => ({ ...m, url: signMediaUrl(m.url) }));
    return json;
  });

  const data = incident.toJSON();
  if (!admin) delete data.createdBy;

    // Citizens see who is coming, but not the responder's personal phone number
  const assignmentsData = assignments.map((assignment) => {
    const json = assignment.toJSON();
    if (user.role === ROLES.CITIZEN && json.responder && json.responder.user) {
      delete json.responder.user.phone;
    }
    return json;
  });

  return { incident: data, reports: reportsData, assignments: assignmentsData };
}
// Returns 404 instead of 403 so incident IDs cannot be probed
async function assertCanView(user, incidentId) {
  if (isAdmin(user)) return;

  if (user.role === ROLES.CITIZEN) {
    const ok = await IncidentReport.exists({ incident: incidentId, user: user._id });
    if (ok) return;
  }

  if (user.role === ROLES.RESPONDER) {
    const responder = await Responder.findOne({ user: user._id }).select('_id');
    if (responder) {
      const ok = await Assignment.exists({ incident: incidentId, responder: responder._id });
      if (ok) return;
    }
  }

  throw new ApiError(404, 'Incident not found');
}

const parseList = (value, allowed) =>
  String(value)
    .split(',')
    .map((v) => v.trim().toUpperCase())
    .filter((v) => allowed.includes(v));

async function listIncidents(user, query) {
  const filter = {};

  if (!isAdmin(user)) {
    let ids = [];
    if (user.role === ROLES.CITIZEN) ids = await getCitizenIncidentIds(user._id);
    if (user.role === ROLES.RESPONDER) ids = await getResponderIncidentIds(user._id);
    filter._id = { $in: ids };
  }

  if (query.status) filter.status = { $in: parseList(query.status, Object.values(INCIDENT_STATUS)) };
  if (query.severity) filter.severity = { $in: parseList(query.severity, Object.values(SEVERITY)) };
  if (query.category) filter.category = { $in: parseList(query.category, INCIDENT_CATEGORIES) };
  if (query.active) filter.status = { ...(filter.status || {}), $nin: CLOSED_STATUSES };
  if (typeof query.isDemo === 'boolean') filter.isDemo = query.isDemo;

  const sort = query.sort === 'priority'
    ? { severityScore: -1, createdAt: -1 }
    : { createdAt: -1 };

  const { page, limit } = query;
  let findQuery = Incident.find(filter)
    .sort(sort)
    .skip((page - 1) * limit)
    .limit(limit)
    .select('-statusHistory');

  if (isAdmin(user)) findQuery = findQuery.populate('createdBy', 'name');

  const [items, total] = await Promise.all([findQuery, Incident.countDocuments(filter)]);

  return {
    items,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

async function getIncidentById(user, incidentId) {
  await assertCanView(user, incidentId);

  const admin = isAdmin(user);
  let incidentQuery = Incident.findById(incidentId);
  if (admin) incidentQuery = incidentQuery.populate('createdBy', 'name phone');

  const incident = await incidentQuery;
  if (!incident) throw new ApiError(404, 'Incident not found');

  // Citizens only see their own reports; staff see all
  const reportFilter = user.role === ROLES.CITIZEN
    ? { incident: incidentId, user: user._id }
    : { incident: incidentId };

  let reportQuery = IncidentReport.find(reportFilter).sort({ createdAt: 1 });
  reportQuery = admin ? reportQuery.populate('user', 'name phone') : reportQuery.select('-user');

  const [reports, assignments] = await Promise.all([
    reportQuery,
    Assignment.find({ incident: incidentId })
      .sort({ assignedAt: -1 })
      .populate({
        path: 'responder',
        select: 'type location availability',
        populate: { path: 'user', select: 'name phone' },
      }),
  ]);

  const data = incident.toJSON();
  if (!admin) delete data.createdBy;

  return { incident: data, reports, assignments };
}

async function trackByReference(user, referenceId) {
  const incident = await Incident.findOne({ referenceId: referenceId.toUpperCase() }).select('_id');
  if (!incident) throw new ApiError(404, 'Incident not found');
  return getIncidentById(user, incident._id);
}

async function verifyIncident(adminUser, incidentId, body) {
  const incident = await Incident.findById(incidentId);
  if (!incident) throw new ApiError(404, 'Incident not found');

  const changes = {};
  if (body.category && body.category !== incident.category) {
    changes.category = { from: incident.category, to: body.category };
    incident.category = body.category;
  }
  if (body.severity && body.severity !== incident.severity) {
    changes.severity = { from: incident.severity, to: body.severity };
    incident.severity = body.severity;
  }

  const wasOverridden = Boolean(incident.verification && incident.verification.overridden);
  incident.verification = {
    verifiedBy: adminUser._id,
    verifiedAt: new Date(),
    overridden: wasOverridden || Object.keys(changes).length > 0,
  };
  incident.needsReview = false;

  if ([INCIDENT_STATUS.REPORTED, INCIDENT_STATUS.AI_ANALYSIS].includes(incident.status)) {
    addStatus(incident, INCIDENT_STATUS.VERIFIED, adminUser._id, body.note || 'Verified by admin');
  }

  await incident.save();

  await logAction({
    userId: adminUser._id,
    action: 'INCIDENT_VERIFIED',
    entity: 'Incident',
    entityId: incident._id,
    meta: { changes, note: body.note },
  });

  broadcastIncident(incident);
  return incident;
}

async function reanalyzeIncident(adminUser, incidentId) {
  const incident = await analyzeIncident(incidentId, adminUser._id);
  await logAction({
    userId: adminUser._id,
    action: 'INCIDENT_REANALYZED',
    entity: 'Incident',
    entityId: incident._id,
  });
  return incident;
}

module.exports = {
  createReport,
  analyzeIncident,
  listIncidents,
  getIncidentById,
  trackByReference,
  verifyIncident,
  reanalyzeIncident,
  assertCanView,
  addStatus,
  broadcastIncident,
  isAdmin,
};