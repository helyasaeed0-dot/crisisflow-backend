const Joi = require('joi');
const { SCENARIO_KEYS, SPEEDS } = require('./demo.simulator');

const speed = Joi.string().valid(...Object.keys(SPEEDS)).default('normal');

const generate = Joi.object({
  scenario: Joi.string().valid(...SCENARIO_KEYS),
  withDuplicates: Joi.boolean().default(false),
});

const run = Joi.object({
  scenario: Joi.string().valid(...SCENARIO_KEYS),
  withDuplicates: Joi.boolean().default(false),
  speed,
});

const simulate = Joi.object({
  speed,
});

const reset = Joi.object({
  all: Joi.boolean().default(false),
});

const idParam = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

module.exports = { generate, run, simulate, reset, idParam };