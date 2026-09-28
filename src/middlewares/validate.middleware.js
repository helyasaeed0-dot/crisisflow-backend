const ApiError = require('../utils/ApiError');

// Validates req.body / req.query / req.params against a Joi schema
const validate = (schema, property = 'body') => (req, res, next) => {
  const { error, value } = schema.validate(req[property] || {}, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const message = error.details.map((d) => d.message).join(', ');
    return next(new ApiError(400, message));
  }

  // Express 5 makes req.query a getter, so redefine it instead of assigning
  Object.defineProperty(req, property, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });

  return next();
};

module.exports = validate;