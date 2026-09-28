const Joi = require('joi');
const { ROLES, RESPONDER_TYPES } = require('../../utils/constants');

// tlds: false allows demo domains like crisisflow.demo
const email = Joi.string().trim().lowercase().email({ tlds: { allow: false } });

const register = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  email: email.required(),
  phone: Joi.string().trim().pattern(/^\+?[0-9\s-]{7,20}$/).allow('', null),
  password: Joi.string().min(8).max(128).required(),
  // Admin accounts can never be self-registered
  role: Joi.string().valid(ROLES.CITIZEN, ROLES.RESPONDER).default(ROLES.CITIZEN),
  responderType: Joi.when('role', {
    is: ROLES.RESPONDER,
    then: Joi.string().valid(...RESPONDER_TYPES).required(),
    otherwise: Joi.forbidden(),
  }),
});

const login = Joi.object({
  email: email.required(),
  password: Joi.string().required(),
});

const refresh = Joi.object({
  refreshToken: Joi.string().required(),
});

module.exports = { register, login, refresh };