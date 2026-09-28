const express = require('express');
const controller = require('./responder.controller');
const schemas = require('./responder.validation');
const validate = require('../../middlewares/validate.middleware');
const { protect } = require('../../middlewares/auth.middleware');
const { authorize } = require('../../middlewares/role.middleware');
const { ROLES } = require('../../utils/constants');

const router = express.Router();
const STAFF = [ROLES.ADMIN, ROLES.SUPER_ADMIN];

router.use(protect);

// Responder app
router.get('/me', authorize(ROLES.RESPONDER), controller.me);
router.get(
  '/me/assignments',
  authorize(ROLES.RESPONDER),
  validate(schemas.myAssignments, 'query'),
  controller.myAssignments
);
router.patch(
  '/status',
  authorize(ROLES.RESPONDER),
  validate(schemas.updateStatus),
  controller.updateStatus
);

// Command center
router.get('/nearby', authorize(...STAFF), validate(schemas.nearby, 'query'), controller.nearby);
router.get('/', authorize(...STAFF), validate(schemas.list, 'query'), controller.list);
router.patch(
  '/:id/verify',
  authorize(...STAFF),
  validate(schemas.idParam, 'params'),
  validate(schemas.verify),
  controller.verify
);

module.exports = router;