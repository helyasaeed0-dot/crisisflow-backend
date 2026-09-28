const EARTH_RADIUS_KM = 6371;

const toRad = (deg) => (deg * Math.PI) / 180;

// Straight-line distance between two coordinates in km
function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

// Simple ETA estimate based on an average city driving speed
function estimateEtaMinutes(distanceKm, avgSpeedKmh = 30) {
  return Math.max(1, Math.round((distanceKm / avgSpeedKmh) * 60));
}

// GeoJSON point -> { latitude, longitude }
function fromPoint(point) {
  if (!point || !Array.isArray(point.coordinates)) return null;
  const [longitude, latitude] = point.coordinates;
  return { latitude, longitude };
}

module.exports = { haversineKm, estimateEtaMinutes, fromPoint };