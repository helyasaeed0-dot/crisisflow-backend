const Incident = require('../incidents/incident.model');
const Assignment = require('../assignments/assignment.model');
const Responder = require('../responders/responder.model');
const config = require('../../config/env');
const { fromPoint } = require('../../utils/geo');
const { startOfDay } = require('../../utils/time');
const {
  INCIDENT_STATUS,
  INCIDENT_CATEGORIES,
  SEVERITY,
  RESPONDER_AVAILABILITY,
  VERIFICATION_STATUS,
} = require('../../utils/constants');

const CLOSED_STATUSES = [INCIDENT_STATUS.RESOLVED, INCIDENT_STATUS.CLOSED];
const MS_PER_MINUTE = 60 * 1000;
const RECENTLY_RESOLVED_HOURS = 6;

const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const round1 = (n) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);

// Response time = report created -> first responder arrived
async function averageResponseMinutes(since) {
  const [row] = await Assignment.aggregate([
    { $match: { arrivedAt: { $gte: since } } },
    { $group: { _id: '$incident', firstArrival: { $min: '$arrivedAt' } } },
    { $lookup: { from: 'incidents', localField: '_id', foreignField: '_id', as: 'incident' } },
    { $unwind: '$incident' },
    {
      $project: {
        minutes: { $divide: [{ $subtract: ['$firstArrival', '$incident.createdAt'] }, MS_PER_MINUTE] },
      },
    },
    { $group: { _id: null, avg: { $avg: '$minutes' }, count: { $sum: 1 } } },
  ]);
  return row ? { avg: round1(row.avg), count: row.count } : { avg: null, count: 0 };
}

// Resolution time = report created -> incident resolved
async function averageResolutionMinutes(since) {
  const [row] = await Incident.aggregate([
    { $match: { resolvedAt: { $gte: since } } },
    {
      $project: {
        minutes: { $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, MS_PER_MINUTE] },
      },
    },
    { $group: { _id: null, avg: { $avg: '$minutes' }, count: { $sum: 1 } } },
  ]);
  return row ? { avg: round1(row.avg), count: row.count } : { avg: null, count: 0 };
}

// KPI cards for the top of the command center
async function getStatistics() {
  const today = startOfDay(config.timezone);
  const week = daysAgo(7);
  const active = { status: { $nin: CLOSED_STATUSES } };

  const [
    activeEmergencies,
    critical,
    needsReview,
    reportedToday,
    resolvedToday,
    respondersOnline,
    respondersAvailable,
    respondersBusy,
    responseTime,
    resolutionTime,
  ] = await Promise.all([
    Incident.countDocuments(active),
    Incident.countDocuments({ ...active, severity: SEVERITY.CRITICAL }),
    Incident.countDocuments({ ...active, needsReview: true }),
    Incident.countDocuments({ createdAt: { $gte: today } }),
    Incident.countDocuments({ resolvedAt: { $gte: today } }),
    Responder.countDocuments({
      verificationStatus: VERIFICATION_STATUS.VERIFIED,
      availability: { $in: [RESPONDER_AVAILABILITY.AVAILABLE, RESPONDER_AVAILABILITY.BUSY] },
    }),
    Responder.countDocuments({
      verificationStatus: VERIFICATION_STATUS.VERIFIED,
      availability: RESPONDER_AVAILABILITY.AVAILABLE,
    }),
    Responder.countDocuments({
      verificationStatus: VERIFICATION_STATUS.VERIFIED,
      availability: RESPONDER_AVAILABILITY.BUSY,
    }),
    averageResponseMinutes(week),
    averageResolutionMinutes(week),
  ]);

  return {
    activeEmergencies,
    critical,
    needsReview,
    reportedToday,
    resolvedToday,
    responders: {
      online: respondersOnline,
      available: respondersAvailable,
      busy: respondersBusy,
    },
    averageResponseTimeMinutes: responseTime.avg,
    averageResolutionTimeMinutes: resolutionTime.avg,
    basedOn: {
      windowDays: 7,
      responseSamples: responseTime.count,
      resolutionSamples: resolutionTime.count,
    },
    generatedAt: new Date(),
  };
}

// Makes sure every key appears in the result, even with a count of 0
function toCounts(rows, keys) {
  const map = new Map(rows.map((r) => [r._id, r.count]));
  return keys.map((key) => ({ key, count: map.get(key) || 0 }));
}

async function getAnalytics({ days }) {
  const since = daysAgo(days);
  const match = { createdAt: { $gte: since } };
  const tz = config.timezone;

  const [byCategory, bySeverity, byStatus, daily, total, resolved, responseTime] = await Promise.all([
    Incident.aggregate([{ $match: match }, { $group: { _id: '$category', count: { $sum: 1 } } }]),
    Incident.aggregate([{ $match: match }, { $group: { _id: '$severity', count: { $sum: 1 } } }]),
    Incident.aggregate([
      { $match: { status: { $nin: CLOSED_STATUSES } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Incident.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: tz } },
          count: { $sum: 1 },
          critical: { $sum: { $cond: [{ $eq: ['$severity', SEVERITY.CRITICAL] }, 1, 0] } },
        },
      },
    ]),
    Incident.countDocuments(match),
    Incident.countDocuments({ ...match, resolvedAt: { $exists: true } }),
    averageResponseMinutes(since),
  ]);

  // Fill in days with no incidents so charts have no gaps
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dailyMap = new Map(daily.map((d) => [d._id, d]));
  const trend = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = formatter.format(daysAgo(i));
    const row = dailyMap.get(date);
    trend.push({ date, total: row ? row.count : 0, critical: row ? row.critical : 0 });
  }

  return {
    windowDays: days,
    totalIncidents: total,
    resolvedIncidents: resolved,
    resolutionRate: total ? round1((resolved / total) * 100) : null,
    averageResponseTimeMinutes: responseTime.avg,
    byCategory: toCounts(byCategory, INCIDENT_CATEGORIES).sort((a, b) => b.count - a.count),
    bySeverity: toCounts(bySeverity, Object.values(SEVERITY)),
    activeByStatus: toCounts(byStatus, Object.values(INCIDENT_STATUS).filter((s) => !CLOSED_STATUSES.includes(s))),
    dailyTrend: trend,
  };
}

// Groups past incidents into ~1 km grid cells to find busy areas
async function getHotspots({ days }) {
  const since = daysAgo(days);

  const cells = await Incident.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $project: {
        category: 1,
        severity: 1,
        lng: { $arrayElemAt: ['$location.coordinates', 0] },
        lat: { $arrayElemAt: ['$location.coordinates', 1] },
      },
    },
    {
      $group: {
        _id: { lat: { $round: ['$lat', 2] }, lng: { $round: ['$lng', 2] } },
        count: { $sum: 1 },
        critical: { $sum: { $cond: [{ $eq: ['$severity', SEVERITY.CRITICAL] }, 1, 0] } },
        categories: { $push: '$category' },
        centerLat: { $avg: '$lat' },
        centerLng: { $avg: '$lng' },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ]);

  const maxCount = cells.length ? cells[0].count : 0;

  const hotspots = cells.map((cell) => {
    const tally = {};
    cell.categories.forEach((c) => { tally[c] = (tally[c] || 0) + 1; });
    const topCategory = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
    const intensity = maxCount ? cell.count / maxCount : 0;

    let level = 'LOW';
    if (intensity >= 0.66) level = 'HIGH';
    else if (intensity >= 0.33) level = 'MEDIUM';

    return {
      position: { latitude: cell.centerLat, longitude: cell.centerLng },
      count: cell.count,
      critical: cell.critical,
      topCategory,
      intensity: Number(intensity.toFixed(2)),
      level,
    };
  });

  return {
    windowDays: days,
    note: 'Based on historical reports. This is an insight, not a prediction.',
    hotspots,
  };
}

// Everything the live map needs in one call
async function getLiveMap() {
  const recentlyResolvedSince = new Date(Date.now() - RECENTLY_RESOLVED_HOURS * 60 * 60 * 1000);

  const [incidents, responders] = await Promise.all([
    Incident.find({
      $or: [
        { status: { $nin: CLOSED_STATUSES } },
        { resolvedAt: { $gte: recentlyResolvedSince } },
      ],
    })
      .select('referenceId category severity severityScore status location address reportCount needsReview createdAt resolvedAt isDemo')
      .sort({ severityScore: -1 })
      .limit(500),
    Responder.find({
      verificationStatus: VERIFICATION_STATUS.VERIFIED,
      availability: { $ne: RESPONDER_AVAILABILITY.OFFLINE },
      location: { $exists: true },
    })
      .select('type availability location lastLocationAt')
      .populate('user', 'name'),
  ]);

  return {
    incidents: incidents.map((i) => ({ ...i.toJSON(), position: fromPoint(i.location) })),
    responders: responders.map((r) => ({
      _id: r._id,
      name: r.user ? r.user.name : null,
      type: r.type,
      availability: r.availability,
      lastLocationAt: r.lastLocationAt,
      position: fromPoint(r.location),
    })),
  };
}

// Plain-language insights generated from historical data
async function getAiInsights({ days }) {
  const since = daysAgo(days);

  const [analytics, hotspotData, [aiStats]] = await Promise.all([
    getAnalytics({ days }),
    getHotspots({ days }),
    Incident.aggregate([
      { $match: { createdAt: { $gte: since }, 'aiAnalysis.analyzedAt': { $exists: true } } },
      {
        $group: {
          _id: null,
          analyzed: { $sum: 1 },
          avgConfidence: { $avg: '$aiAnalysis.confidence' },
          overridden: { $sum: { $cond: [{ $eq: ['$verification.overridden', true] }, 1, 0] } },
          llmAnalyzed: { $sum: { $cond: [{ $ne: ['$aiAnalysis.source', 'rules'] }, 1, 0] } },
          mergedIncidents: { $sum: { $cond: [{ $gt: ['$reportCount', 1] }, 1, 0] } },
          extraReports: { $sum: { $subtract: ['$reportCount', 1] } },
        },
      },
    ]),
  ]);

  const insights = [];
  const total = analytics.totalIncidents;

  if (total === 0) {
    insights.push({ type: 'INFO', message: `No incidents were reported in the last ${days} days.` });
    return { windowDays: days, insights, metrics: null };
  }

  const top = analytics.byCategory[0];
  insights.push({
    type: 'CATEGORY',
    message: `${top.key} is the most reported emergency type (${Math.round((top.count / total) * 100)}% of ${total} reports).`,
  });

  const critical = analytics.bySeverity.find((s) => s.key === SEVERITY.CRITICAL);
  if (critical && critical.count) {
    insights.push({
      type: 'SEVERITY',
      message: `${critical.count} incident(s) were rated CRITICAL (${Math.round((critical.count / total) * 100)}%).`,
    });
  }

  if (hotspotData.hotspots.length) {
    const h = hotspotData.hotspots[0];
    insights.push({
      type: 'HOTSPOT',
      message: `The busiest area had ${h.count} report(s), mostly ${h.topCategory}, around (${h.position.latitude.toFixed(4)}, ${h.position.longitude.toFixed(4)}).`,
    });
  }

  if (analytics.averageResponseTimeMinutes !== null) {
    insights.push({
      type: 'RESPONSE',
      message: `Average time from report to responder arrival was ${analytics.averageResponseTimeMinutes} minutes.`,
    });
  }

  if (aiStats) {
    if (aiStats.extraReports > 0) {
      insights.push({
        type: 'DUPLICATES',
        message: `Duplicate detection merged ${aiStats.extraReports} extra report(s) into ${aiStats.mergedIncidents} incident(s).`,
      });
    }
    const overrideRate = Math.round((aiStats.overridden / aiStats.analyzed) * 100);
    insights.push({
      type: 'AI',
      message: `AI analyzed ${aiStats.analyzed} incident(s) with ${Math.round(aiStats.avgConfidence * 100)}% average confidence; admins overrode ${aiStats.overridden} (${overrideRate}%).`,
    });
  }

  return {
    windowDays: days,
    note: 'Insights are based on historical data and may change as more reports arrive.',
    insights,
    metrics: aiStats
      ? {
        analyzed: aiStats.analyzed,
        averageConfidence: round1(aiStats.avgConfidence * 100),
        overridden: aiStats.overridden,
        llmAnalyzed: aiStats.llmAnalyzed,
        mergedIncidents: aiStats.mergedIncidents,
        extraReports: aiStats.extraReports,
      }
      : null,
  };
}

module.exports = { getStatistics, getAnalytics, getHotspots, getLiveMap, getAiInsights };