const Joi = require('joi');

const list = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  unreadOnly: Joi.boolean().default(false),
});

const idParam = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

module.exports = { list, idParam };