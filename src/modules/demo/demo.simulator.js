const User = require('../users/user.model');
const Incident = require('../incidents/incident.model');
const IncidentReport = require('../incidents/incidentReport.model');
const Assignment = require('../assignments/assignment.model');
const Responder = require('../responders/responder.model');
const Notification = require('../notifications/notification.model');
const incidentService = require('../incidents/incident.service');
const assignmentService = require('../assignments/assignment.service');
const { broadcastResponderLocation } = require('../responders/responder.service');
const { logAction } = require('../audit/audit.service');
const config = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const { toPoint } = require('../../utils/pointSchema');
const { fromPoint } = require('../../utils/geo');
const {
  ROLES,
  INCIDENT_STATUS,
  ASSIGNMENT_STATUS,
  RESPONDER_AVAILABILITY,
} = require('../../utils/constants');
const EVENTS = require('../../websocket/events');
const { emitToAdmins } = require('../../websocket/emitter');

// Demo scenarios in English and Roman Urdu. All data is clearly simulated.
const SCENARIOS = [
  {
    key: 'accident',
    category: 'ACCIDENT',
    description: 'Car and motorcycle collision near the signal, two people injured and bleeding, road blocked',
    address: 'Main Boulevard (simulated)',
    followUps: [
      'Accident at the signal, injured people lying on the road',
      'Bike aur car ki takkar hui hai, log zakhmi hain, rasta band hai',
    ],
  },
  {
    key: 'fire',
    category: 'FIRE',
    description: 'Market ki ek dukaan mein aag lag gayi hai, dhuan bohat hai aur andar log phanse hue hain',
    address: 'Central Market (simulated)',
    followUps: [
      'Fire in a shop in the market, heavy smoke, people trapped inside',
      'Market mein aag, dhuan hi dhuan hai',
    ],
  },
  {
    key: 'medical',
    category: 'MEDICAL',
    description: 'Elderly man collapsed on the street, unconscious and not breathing properly',
    address: 'Park Road (simulated)',
    followUps: [
      'Old man fainted near the park gate, he looks unconscious',
      'Buzurg aadmi behosh ho gaye hain, saans theek nahi aa rahi',
    ],
  },
  {
    key: 'building',
    category: 'BUILDING_EMERGENCY',
    description: 'Purani building ki deewar gir gayi hai, mulba road par hai aur kuch log zakhmi hain',
    address: 'Old City (simulated)',
    followUps: [
      'Wall of an old building collapsed, people injured',
      'Building ki deewar giri, log mulbe ke neeche phanse ho sakte hain',
    ],
  },
  {
    key: 'electrical',
    category: 'ELECTRICAL_HAZARD',
    description: 'Live wire fallen on the road after the storm, sparks visible near a school',
    address: 'School Road (simulated)',
    followUps: [
      'Electric wire on the road with sparks near the school gate',
      'Bijli ki taar sarak par giri hui hai, sparks nikal rahe hain',
    ],
  },
];

const SCENARIO_KEYS = SCENARIOS.map((s) => s.key);

// Timing presets for the simulated response
const SPEEDS = {
  fast: { stepMs: 800, pauseMs: 1500, steps: 6 },
  normal: { stepMs: 1500, pauseMs: 3000, steps: 8 },
  slow: { stepMs: 2500, pauseMs: 4500, steps: 10 },
};

const ANALYSIS_TIMEOUT_MS = 20000;

// incidentId -> { stopped }
const simulations = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomOffset = (km) => (Math.random() - 0.5) * 2 * (km / 111);

async function getDemoUser(email, name) {
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      name,
      email,
      password: config.demo.password,
      role: ROLES.CITIZEN,
      isDemo: true,
    });
  }
  return user;
}

// Extra witnesses report the same event a few seconds apart
function scheduleDuplicateReports(scenario, latitude, longitude) {
  scenario.followUps.forEach((description, index) => {
    setTimeout(async () => {
      try {
        const witness = await getDemoUser(
          `witness${index + 1}@crisisflow.demo`,
          `Demo Witness ${index + 1}`
        );
        await incidentService.createReport(
          witness,
          {
            category: scenario.category,
            description,
            // About 20-40 m away from the first report
            latitude: latitude + randomOffset(0.04),
            longitude: longitude + randomOffset(0.04),
            address: scenario.address,
          },
          [],
          { isDemo: true }
        );
      } catch (err) {
        console.error('Demo duplicate report failed:', err.message);
      }
    }, (index + 1) * 3000);
  });
}

async function generateEmergency({ scenario, withDuplicates = false } = {}) {
  const chosen = SCENARIOS.find((s) => s.key === scenario)
    || SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];

  const citizen = await getDemoUser('citizen@crisisflow.demo', 'Demo Citizen');
  const latitude = config.demo.centerLat + randomOffset(3);
  const longitude = config.demo.centerLng + randomOffset(3);

  const result = await incidentService.createReport(
    citizen,
    {
      category: chosen.category,
      description: chosen.description,
      latitude,
      longitude,
      address: chosen.address,
    },
    [],
    { isDemo: true }
  );

  if (withDuplicates) scheduleDuplicateReports(chosen, latitude, longitude);

  return {
    scenario: chosen.key,
    incidentId: result.incident._id,
    referenceId: result.incident.referenceId,
    merged: result.merged,
    withDuplicates,
  };
}

async function waitForAnalysis(incidentId) {
  const deadline = Date.now() + ANALYSIS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const incident = await Incident.findById(incidentId).select('status');
    if (!incident) throw new ApiError(404, 'Incident not found');
    if (![INCIDENT_STATUS.REPORTED, INCIDENT_STATUS.AI_ANALYSIS].includes(incident.status)) {
      return incident;
    }
    await sleep(500);
  }
  throw new ApiError(504, 'AI analysis took too long');
}

// Runs a lifecycle step and ignores "already done" errors from parallel responders
async function tryStep(fn, label) {
  try {
    await fn();
  } catch (err) {
    if (err.statusCode === 400 || err.statusCode === 404) {
      console.warn(`Demo step skipped (${label}): ${err.message}`);
      return;
    }
    throw err;
  }
}

async function runSimulation(incidentId, actors, state, timing) {
  const stopped = () => state.stopped;

  // 1. Every assigned responder accepts
  for (const actor of actors) {
    if (stopped()) return;
    await tryStep(
      () => assignmentService.respondToAssignment(actor.user, incidentId, 'accept'),
      `${actor.user.name} accept`
    );
    await sleep(timing.pauseMs / 2);
  }

  // 2. Departure
  for (const actor of actors) {
    if (stopped()) return;
    await tryStep(
      () => assignmentService.updateIncidentStatus(actor.user, incidentId, {
        status: 'ON_THE_WAY',
        note: 'Simulated: responder departed',
      }),
      `${actor.user.name} on the way`
    );
  }

  // 3. Live movement toward the incident
  const incident = await Incident.findById(incidentId).select('location');
  const target = fromPoint(incident.location);
  const starts = actors.map((a) => fromPoint(a.responder.location));

  for (let step = 1; step <= timing.steps; step += 1) {
    if (stopped()) return;
    const fraction = step / timing.steps;

    for (let i = 0; i < actors.length; i += 1) {
      const start = starts[i];
      if (!start) continue;

      const responder = await Responder.findById(actors[i].responder._id);
      if (!responder) continue;

      responder.location = toPoint(
        start.latitude + (target.latitude - start.latitude) * fraction,
        start.longitude + (target.longitude - start.longitude) * fraction
      );
      responder.lastLocationAt = new Date();
      await responder.save();
      await broadcastResponderLocation(responder, actors[i].user.name);
    }

    await sleep(timing.stepMs);
  }

  // 4. Arrival, handling and resolution
  for (const status of ['ARRIVED', 'HANDLING']) {
    for (const actor of actors) {
      if (stopped()) return;
      await tryStep(
        () => assignmentService.updateIncidentStatus(actor.user, incidentId, {
          status,
          note: `Simulated: ${status.toLowerCase().replace('_', ' ')}`,
        }),
        `${actor.user.name} ${status}`
      );
    }
    await sleep(status === 'HANDLING' ? timing.pauseMs * 1.5 : timing.pauseMs);
  }

  if (stopped()) return;
  // The lead responder resolves; this completes every other assignment too
  await tryStep(
    () => assignmentService.updateIncidentStatus(actors[0].user, incidentId, {
      status: 'RESOLVED',
      note: 'Simulated: emergency resolved',
    }),
    `${actors[0].user.name} resolve`
  );
}

async function simulateResponse(incidentId, { speed = 'normal' } = {}) {
  const key = String(incidentId);
  if (simulations.has(key)) {
    throw new ApiError(409, 'A simulation is already running for this incident');
  }

  const assignments = await Assignment.find({
    incident: incidentId,
    status: { $in: [ASSIGNMENT_STATUS.ASSIGNED, ASSIGNMENT_STATUS.ACCEPTED, ASSIGNMENT_STATUS.ON_THE_WAY] },
  }).populate({ path: 'responder', populate: { path: 'user' } });

  const actors = assignments
    .filter((a) => a.responder && a.responder.user)
    .map((a) => ({ responder: a.responder, user: a.responder.user }));

  if (!actors.length) {
    throw new ApiError(400, 'Assign at least one responder before starting the simulation');
  }

  const state = { stopped: false };
  simulations.set(key, state);

  runSimulation(incidentId, actors, state, SPEEDS[speed] || SPEEDS.normal)
    .catch((err) => console.error(`Demo simulation failed for ${key}:`, err.message))
    .finally(() => simulations.delete(key));

  return { started: true, incidentId, responders: actors.map((a) => a.user.name), speed };
}

function stopSimulation(incidentId) {
  const state = simulations.get(String(incidentId));
  if (!state) throw new ApiError(404, 'No running simulation for this incident');
  state.stopped = true;
  return { stopped: true, incidentId };
}

// One click: generate -> AI -> recommend -> assign -> simulate -> resolve
async function runFullDemo(adminUser, { scenario, speed = 'normal', withDuplicates = false } = {}) {
  const created = await generateEmergency({ scenario, withDuplicates });

  setImmediate(async () => {
    try {
      await waitForAnalysis(created.incidentId);
      await sleep(2000); // Give the audience a moment to see the AI result

      const rec = await assignmentService.getRecommendations(created.incidentId, {
        limit: 5,
        maxDistanceKm: 25,
      });
      const team = rec.suggestedTeam.slice(0, 2).map((c) => c.responder._id.toString());
      if (!team.length) {
        console.warn('Demo: no available responders to assign. Run "npm run seed" or reset the demo.');
        return;
      }

      await assignmentService.assignResponders(adminUser, created.incidentId, team);
      await sleep(2000);
      await simulateResponse(created.incidentId, { speed });
    } catch (err) {
      console.error('Full demo run failed:', err.message);
    }
  });

  return { ...created, message: 'Full demo started. Watch the command center.' };
}

async function resetDemo(adminUser, { all = false } = {}) {
  for (const state of simulations.values()) state.stopped = true;
  simulations.clear();

  const incidentFilter = all ? {} : { isDemo: true };
  const incidentIds = await Incident.distinct('_id', incidentFilter);

  const [notifications, assignments, reports, incidents] = await Promise.all([
    Notification.deleteMany({ 'data.incidentId': { $in: incidentIds } }),
    Assignment.deleteMany({ incident: { $in: incidentIds } }),
    IncidentReport.deleteMany({ incident: { $in: incidentIds } }),
    Incident.deleteMany({ _id: { $in: incidentIds } }),
  ]);

  // Put demo responders back at random positions, ready for the next run
  const responders = await Responder.find({ isDemo: true }).select('_id');
  if (responders.length) {
    await Responder.bulkWrite(
      responders.map((r) => ({
        updateOne: {
          filter: { _id: r._id },
          update: {
            $set: {
              availability: RESPONDER_AVAILABILITY.AVAILABLE,
              lastLocationAt: new Date(),
              location: toPoint(
                config.demo.centerLat + randomOffset(5),
                config.demo.centerLng + randomOffset(5)
              ),
            },
          },
        },
      }))
    );
  }

  const summary = {
    incidents: incidents.deletedCount,
    reports: reports.deletedCount,
    assignments: assignments.deletedCount,
    notifications: notifications.deletedCount,
    respondersReset: responders.length,
    scope: all ? 'ALL_INCIDENTS' : 'DEMO_ONLY',
  };

  await logAction({ userId: adminUser._id, action: 'DEMO_RESET', entity: 'Demo', meta: summary });
  emitToAdmins(EVENTS.DEMO_RESET, summary);

  return summary;
}

async function getStatus() {
  const [demoIncidents, demoResponders] = await Promise.all([
    Incident.countDocuments({ isDemo: true }),
    Responder.countDocuments({ isDemo: true }),
  ]);

  return {
    demoMode: config.demoMode,
    scenarios: SCENARIO_KEYS,
    speeds: Object.keys(SPEEDS),
    runningSimulations: [...simulations.keys()],
    demoIncidents,
    demoResponders,
  };
}

module.exports = {
  SCENARIO_KEYS,
  SPEEDS,
  generateEmergency,
  simulateResponse,
  stopSimulation,
  runFullDemo,
  resetDemo,
  getStatus,
};