const ApiError = require('../utils/ApiError');

// Usage: authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN)
const authorize = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return next(new ApiError(401, 'Authentication required'));
  }
  if (!allowedRoles.includes(req.user.role)) {
    return next(new ApiError(403, 'You do not have permission to perform this action'));
  }
  return next();
};

module.exports = { authorize };