const Joi = require('joi');

const analytics = Joi.object({
  days: Joi.number().integer().min(1).max(90).default(7),
});

const hotspots = Joi.object({
  days: Joi.number().integer().min(1).max(365).default(30),
});

module.exports = { analytics, hotspots };