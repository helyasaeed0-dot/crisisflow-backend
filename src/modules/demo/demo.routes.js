const express = require('express');
const controller = require('./demo.controller');
const schemas = require('./demo.validation');
const validate = require('../../middlewares/validate.middleware');
const { protect } = require('../../middlewares/auth.middleware');
const { authorize } = require('../../middlewares/role.middleware');
const config = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const { ROLES } = require('../../utils/constants');

const router = express.Router();

// Demo endpoints exist only when DEMO_MODE=true
const requireDemoMode = (req, res, next) => {
  if (!config.demoMode) return next(new ApiError(403, 'Demo Mode is disabled'));
  return next();
};

const withId = validate(schemas.idParam, 'params');

router.use(protect, authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN), requireDemoMode);

router.get('/status', controller.status);
router.post('/emergencies', validate(schemas.generate), controller.generate);
router.post('/run', validate(schemas.run), controller.run);
router.post('/incidents/:id/simulate', withId, validate(schemas.simulate), controller.simulate);
router.post('/incidents/:id/stop', withId, controller.stop);
router.post('/reset', validate(schemas.reset), controller.reset);

module.exports = router;