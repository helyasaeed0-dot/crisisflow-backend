const Responder = require('./responder.model');
const Assignment = require('../assignments/assignment.model');
const config = require('../../config/env');
const { haversineKm, estimateEtaMinutes, fromPoint } = require('../../utils/geo');
const { SEVERITY_RANK } = require('../ai/severity.engine');
const {
  RESPONDER_AVAILABILITY,
  VERIFICATION_STATUS,
  ASSIGNMENT_STATUS,
} = require('../../utils/constants');

const DEFAULT_RESOURCES = ['RESCUE_TEAM'];
const LOCATION_FRESH_MINUTES = 15;

const ACTIVE_ASSIGNMENT_STATUSES = [
  ASSIGNMENT_STATUS.ASSIGNED,
  ASSIGNMENT_STATUS.ACCEPTED,
  ASSIGNMENT_STATUS.ON_THE_WAY,
  ASSIGNMENT_STATUS.ARRIVED,
  ASSIGNMENT_STATUS.HANDLING,
];

function getRequiredTypes(incident) {
  const list = incident.aiAnalysis && incident.aiAnalysis.requiredResources;
  return list && list.length ? list : DEFAULT_RESOURCES;
}

/**
 * Responder Score = priority-weighted distance + availability + specialization
 */
function scoreResponder(responder, incident, { maxDistanceKm = 25 } = {}) {
  const inc = fromPoint(incident.location);
  const pos = fromPoint(responder.location);
  const distanceKm = haversineKm(inc.latitude, inc.longitude, pos.latitude, pos.longitude);
  const etaMinutes = estimateEtaMinutes(distanceKm);
  const required = getRequiredTypes(incident);
  const rank = SEVERITY_RANK[incident.severity] || 1;

  // Higher severity makes distance count more (35 to 50 points)
  const distanceWeight = 30 + rank * 5;
  const distancePoints = Math.max(0, 1 - distanceKm / maxDistanceKm) * distanceWeight;

  const minutesSinceUpdate = responder.lastLocationAt
    ? (Date.now() - new Date(responder.lastLocationAt).getTime()) / 60000
    : Infinity;
  let availabilityPoints = 0;
  if (responder.availability === RESPONDER_AVAILABILITY.AVAILABLE) {
    availabilityPoints = minutesSinceUpdate <= LOCATION_FRESH_MINUTES ? 20 : 12;
  }

  const typeIndex = required.indexOf(responder.type);
  let specializationPoints = 0;
  if (typeIndex === 0) specializationPoints = 30;
  else if (typeIndex > 0) specializationPoints = 22;

  const score = Math.round(distancePoints + availabilityPoints + specializationPoints);

  return {
    distanceKm: Number(distanceKm.toFixed(2)),
    etaMinutes,
    score,
    matchesRequirement: typeIndex >= 0,
    breakdown: [
      { factor: 'DISTANCE', label: `Distance ${distanceKm.toFixed(1)} km (weighted by ${incident.severity} priority)`, points: Math.round(distancePoints) },
      { factor: 'AVAILABILITY', label: 'Available with recent location', points: availabilityPoints },
      { factor: 'SPECIALIZATION', label: typeIndex >= 0 ? `${responder.type} is required` : `${responder.type} not required`, points: specializationPoints },
    ],
  };
}

async function getRecommendations(incident, { limit = 5, maxDistanceKm = 25 } = {}) {
  const [declined, alreadyActive] = await Promise.all([
    Assignment.distinct('responder', { incident: incident._id, status: ASSIGNMENT_STATUS.DECLINED }),
    Assignment.distinct('responder', { incident: incident._id, status: { $in: ACTIVE_ASSIGNMENT_STATUSES } }),
  ]);

  const filter = {
    _id: { $nin: [...declined, ...alreadyActive] },
    availability: RESPONDER_AVAILABILITY.AVAILABLE,
    verificationStatus: VERIFICATION_STATUS.VERIFIED,
    location: {
      $near: { $geometry: incident.location, $maxDistance: maxDistanceKm * 1000 },
    },
  };

  // Outside demo mode, simulated responders are never used for real incidents
  if (!config.demoMode) filter.isDemo = false;

  const candidates = await Responder.find(filter).limit(50).populate('user', 'name phone');

  const ranked = candidates
    .map((responder) => ({ responder, ...scoreResponder(responder, incident, { maxDistanceKm }) }))
    .sort((a, b) => b.score - a.score);

  const required = getRequiredTypes(incident);

  // Best available responder for each required resource type
  const suggestedTeam = required
    .map((type) => ranked.find((c) => c.responder.type === type))
    .filter(Boolean);

  const missingResources = required.filter((type) => !ranked.some((c) => c.responder.type === type));

  return {
    requiredResources: required,
    suggestedTeam,
    recommendations: ranked.slice(0, limit),
    missingResources,
  };
}

module.exports = {
  getRecommendations,
  scoreResponder,
  getRequiredTypes,
  ACTIVE_ASSIGNMENT_STATUSES,
};