const express = require('express');
const controller = require('./user.controller');
const schemas = require('./user.validation');
const validate = require('../../middlewares/validate.middleware');
const { protect } = require('../../middlewares/auth.middleware');
const { authorize } = require('../../middlewares/role.middleware');
const { ROLES } = require('../../utils/constants');

const router = express.Router();

router.use(protect);

// Admins can view users; only super admins can change them
router.get('/', authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN), validate(schemas.list, 'query'), controller.list);
router.patch(
  '/:id',
  authorize(ROLES.SUPER_ADMIN),
  validate(schemas.idParam, 'params'),
  validate(schemas.update),
  controller.update
);

module.exports = router;