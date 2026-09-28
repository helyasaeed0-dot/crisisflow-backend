const Joi = require('joi');
const {
  RESPONDER_TYPES,
  RESPONDER_AVAILABILITY,
  VERIFICATION_STATUS,
} = require('../../utils/constants');

const updateStatus = Joi.object({
  // BUSY is set automatically by the system during assignments
  availability: Joi.string().valid(RESPONDER_AVAILABILITY.AVAILABLE, RESPONDER_AVAILABILITY.OFFLINE),
  latitude: Joi.number().min(-90).max(90),
  longitude: Joi.number().min(-180).max(180),
})
  .and('latitude', 'longitude')
  .or('availability', 'latitude');

const list = Joi.object({
  type: Joi.string().valid(...RESPONDER_TYPES),
  availability: Joi.string().valid(...Object.values(RESPONDER_AVAILABILITY)),
  verificationStatus: Joi.string().valid(...Object.values(VERIFICATION_STATUS)),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
});

const nearby = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  radiusKm: Joi.number().min(0.1).max(100).default(10),
  type: Joi.string().valid(...RESPONDER_TYPES),
  availableOnly: Joi.boolean().default(true),
});

const myAssignments = Joi.object({
  active: Joi.boolean().default(true),
});

const idParam = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

const verify = Joi.object({
  verificationStatus: Joi.string()
    .valid(VERIFICATION_STATUS.VERIFIED, VERIFICATION_STATUS.REJECTED)
    .required(),
});

module.exports = { updateStatus, list, nearby, myAssignments, idParam, verify };