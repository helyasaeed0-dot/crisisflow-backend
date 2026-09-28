const Joi = require('joi');
const { INCIDENT_CATEGORIES, SEVERITY } = require('../../utils/constants');

const objectId = Joi.string().hex().length(24);

const create = Joi.object({
  category: Joi.string().valid(...INCIDENT_CATEGORIES).required(),
  description: Joi.string().trim().max(2000).allow(''),
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  address: Joi.string().trim().max(300).allow(''),
});

const list = Joi.object({
  status: Joi.string(),
  severity: Joi.string(),
  category: Joi.string(),
  active: Joi.boolean(),
  isDemo: Joi.boolean(),
  sort: Joi.string().valid('recent', 'priority').default('recent'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const idParam = Joi.object({
  id: objectId.required(),
});

const referenceParam = Joi.object({
  referenceId: Joi.string().trim().uppercase().pattern(/^CF-\d{6}-[A-F0-9]{6}$/i).required(),
});

const verify = Joi.object({
  category: Joi.string().valid(...INCIDENT_CATEGORIES),
  severity: Joi.string().valid(...Object.values(SEVERITY)),
  note: Joi.string().trim().max(500).allow(''),
});

const recommendations = Joi.object({
  limit: Joi.number().integer().min(1).max(20).default(5),
  maxDistanceKm: Joi.number().min(1).max(100).default(25),
});

const assign = Joi.object({
  responderIds: Joi.array().items(objectId).min(1).max(5).unique().required(),
});

const status = Joi.object({
  status: Joi.string()
    .valid('ON_THE_WAY', 'ARRIVED', 'HANDLING', 'RESOLVED', 'CLOSED')
    .required(),
  note: Joi.string().trim().max(500).allow(''),
});

module.exports = {
  create,
  list,
  idParam,
  referenceParam,
  verify,
  recommendations,
  assign,
  status,
};