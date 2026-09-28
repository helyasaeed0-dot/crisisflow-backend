const express = require('express');
const controller = require('./dashboard.controller');
const schemas = require('./dashboard.validation');
const validate = require('../../middlewares/validate.middleware');
const { protect } = require('../../middlewares/auth.middleware');
const { authorize } = require('../../middlewares/role.middleware');
const { ROLES } = require('../../utils/constants');

const router = express.Router();

router.use(protect, authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN));

router.get('/statistics', controller.statistics);
router.get('/analytics', validate(schemas.analytics, 'query'), controller.analytics);
router.get('/hotspots', validate(schemas.hotspots, 'query'), controller.hotspots);
router.get('/live-map', controller.liveMap);
router.get('/ai-insights', validate(schemas.analytics, 'query'), controller.aiInsights);

module.exports = router;