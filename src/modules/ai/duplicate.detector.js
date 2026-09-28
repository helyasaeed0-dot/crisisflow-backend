const Incident = require('../incidents/incident.model');
const { INCIDENT_STATUS } = require('../../utils/constants');
const { jaccardSimilarity } = require('../../utils/text');
const { haversineKm, fromPoint } = require('../../utils/geo');

const DEFAULTS = {
  radiusMeters: 300,
  timeWindowMinutes: 60,
  minTextSimilarity: 0.15,
  alwaysMergeWithinMeters: 100,
};

/**
 * Finds an open incident that the new report most likely describes.
 * Checks: same category, GPS distance, time window and text similarity.
 */
async function findDuplicateIncident({ category, location, description = '', isDemo = false }, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const since = new Date(Date.now() - opts.timeWindowMinutes * 60 * 1000);

  const candidates = await Incident.find({
    category,
    isDemo,
    status: { $nin: [INCIDENT_STATUS.RESOLVED, INCIDENT_STATUS.CLOSED] },
    updatedAt: { $gte: since },
    location: {
      $near: { $geometry: location, $maxDistance: opts.radiusMeters },
    },
  }).limit(5);

  if (!candidates.length) return null;

  const [lng, lat] = location.coordinates;
  let best = null;

  for (const candidate of candidates) {
    const pos = fromPoint(candidate.location);
    const distanceM = haversineKm(lat, lng, pos.latitude, pos.longitude) * 1000;
    const textSimilarity = jaccardSimilarity(description, candidate.description);

    // Very close reports are merged even if worded differently
    const isMatch =
      distanceM <= opts.alwaysMergeWithinMeters ||
      !description ||
      !candidate.description ||
      textSimilarity >= opts.minTextSimilarity;

    if (!isMatch) continue;

    const matchScore = (1 - distanceM / opts.radiusMeters) * 0.6 + textSimilarity * 0.4;
    if (!best || matchScore > best.matchScore) {
      best = {
        incident: candidate,
        distanceM: Math.round(distanceM),
        textSimilarity: Number(textSimilarity.toFixed(2)),
        matchScore: Number(matchScore.toFixed(2)),
      };
    }
  }

  return best;
}

module.exports = { findDuplicateIncident };