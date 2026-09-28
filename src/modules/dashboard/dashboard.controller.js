const dashboardService = require('./dashboard.service');
const asyncHandler = require('../../utils/asyncHandler');

const statistics = asyncHandler(async (req, res) => {
  const data = await dashboardService.getStatistics();
  res.json({ success: true, data });
});

const analytics = asyncHandler(async (req, res) => {
  const data = await dashboardService.getAnalytics(req.query);
  res.json({ success: true, data });
});

const hotspots = asyncHandler(async (req, res) => {
  const data = await dashboardService.getHotspots(req.query);
  res.json({ success: true, data });
});

const liveMap = asyncHandler(async (req, res) => {
  const data = await dashboardService.getLiveMap();
  res.json({ success: true, data });
});

const aiInsights = asyncHandler(async (req, res) => {
  const data = await dashboardService.getAiInsights(req.query);
  res.json({ success: true, data });
});

module.exports = { statistics, analytics, hotspots, liveMap, aiInsights };