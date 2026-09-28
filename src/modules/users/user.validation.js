const Joi = require('joi');
const { ROLES, USER_STATUS } = require('../../utils/constants');

const list = Joi.object({
  role: Joi.string().valid(...Object.values(ROLES)),
  status: Joi.string().valid(...Object.values(USER_STATUS)),
  search: Joi.string().trim().max(100).allow(''),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const update = Joi.object({
  role: Joi.string().valid(ROLES.CITIZEN, ROLES.ADMIN, ROLES.SUPER_ADMIN),
  status: Joi.string().valid(...Object.values(USER_STATUS)),
}).or('role', 'status');

const idParam = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

module.exports = { list, update, idParam };