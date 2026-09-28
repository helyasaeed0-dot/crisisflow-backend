const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('./incident.controller');
const assignmentController = require('../assignments/assignment.controller');
const schemas = require('./incident.validation');
const validate = require('../../middlewares/validate.middleware');
const { protect } = require('../../middlewares/auth.middleware');
const { authorize } = require('../../middlewares/role.middleware');
const { uploadMedia } = require('../../middlewares/upload.middleware');
const { ROLES } = require('../../utils/constants');

const router = express.Router();
const STAFF = [ROLES.ADMIN, ROLES.SUPER_ADMIN];

// Limits report spam from a single client
const reportLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many reports, please try again later' },
});

const withId = validate(schemas.idParam, 'params');

router.use(protect);

// Reporting and viewing
router.post(
  '/',
  authorize(ROLES.CITIZEN, ...STAFF),
  reportLimiter,
  uploadMedia,
  validate(schemas.create),
  controller.create
);
router.get('/', validate(schemas.list, 'query'), controller.list);
router.get('/track/:referenceId', validate(schemas.referenceParam, 'params'), controller.track);
router.get('/:id', withId, controller.getById);

// AI and verification (admin)
router.post('/:id/analyze', authorize(...STAFF), withId, controller.analyze);
router.patch('/:id/verify', authorize(...STAFF), withId, validate(schemas.verify), controller.verify);

// Matching and assignment (admin)
router.get(
  '/:id/recommendations',
  authorize(...STAFF),
  withId,
  validate(schemas.recommendations, 'query'),
  assignmentController.recommendations
);
router.post(
  '/:id/assign',
  authorize(...STAFF),
  withId,
  validate(schemas.assign),
  assignmentController.assign
);

// Responder actions
router.post('/:id/accept', authorize(ROLES.RESPONDER), withId, assignmentController.accept);
router.post('/:id/decline', authorize(ROLES.RESPONDER), withId, assignmentController.decline);

// Lifecycle status (responder steps, admin resolve/close)
router.patch(
  '/:id/status',
  authorize(ROLES.RESPONDER, ...STAFF),
  withId,
  validate(schemas.status),
  assignmentController.updateStatus
);

module.exports = router;