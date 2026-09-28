const Incident = require('../modules/incidents/incident.model');
const Assignment = require('../modules/assignments/assignment.model');
const Responder = require('../modules/responders/responder.model');
const { analyzeIncident } = require('../modules/incidents/incident.service');
const { ACTIVE_ASSIGNMENT_STATUSES } = require('../modules/responders/responder.matcher');
const { INCIDENT_STATUS, RESPONDER_AVAILABILITY } = require('../utils/constants');

// Incidents whose background analysis was interrupted by a crash or restart
async function recoverStuckIncidents() {
  const stuck = await Incident.find({
    status: { $in: [INCIDENT_STATUS.REPORTED, INCIDENT_STATUS.AI_ANALYSIS] },
  }).select('_id referenceId');

  let recovered = 0;
  for (const incident of stuck) {
    try {
      await analyzeIncident(incident._id);
      recovered += 1;
      console.log(`Recovered analysis for incident ${incident.referenceId}`);
    } catch (err) {
      console.error(`Recovery failed for ${incident.referenceId}:`, err.message);
    }
  }
  return recovered;
}

// Responders marked BUSY without any active assignment
async function releaseOrphanedResponders() {
  const busy = await Responder.find({ availability: RESPONDER_AVAILABILITY.BUSY }).select('_id');

  let released = 0;
  for (const responder of busy) {
    const hasActive = await Assignment.exists({
      responder: responder._id,
      status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
    });
    if (!hasActive) {
      await Responder.updateOne({ _id: responder._id }, { availability: RESPONDER_AVAILABILITY.AVAILABLE });
      released += 1;
    }
  }
  return released;
}

async function runStartupRecovery() {
  try {
    const recovered = await recoverStuckIncidents();
    const released = await releaseOrphanedResponders();
    if (recovered || released) {
      console.log(`Startup recovery: ${recovered} incident(s) re-analyzed, ${released} responder(s) released`);
    }
  } catch (err) {
    console.error('Startup recovery failed:', err.message);
  }
}

module.exports = { runStartupRecovery };