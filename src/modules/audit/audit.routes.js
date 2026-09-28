const express = require('express');
const Joi = require('joi');
const { listAuditLogs } = require('./audit.service');
const validate = require('../../middlewares/validate.middleware');
const asyncHandler = require('../../utils/asyncHandler');
const { protect } = require('../../middlewares/auth.middleware');
const { authorize } = require('../../middlewares/role.middleware');
const { ROLES } = require('../../utils/constants');

const router = express.Router();

const listSchema = Joi.object({
  entity: Joi.string().trim().max(50),
  action: Joi.string().trim().max(100),
  userId: Joi.string().hex().length(24),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
});

router.use(protect, authorize(ROLES.SUPER_ADMIN));

router.get(
  '/',
  validate(listSchema, 'query'),
  asyncHandler(async (req, res) => {
    const data = await listAuditLogs(req.query);
    res.json({ success: true, data });
  })
);

module.exports = router;