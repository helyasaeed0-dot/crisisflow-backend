const jwt = require('jsonwebtoken');
const config = require('../config/env');
const User = require('../modules/users/user.model');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { USER_STATUS } = require('../utils/constants');

// Requires a valid "Authorization: Bearer <accessToken>" header
const protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new ApiError(401, 'Authentication required');
  }

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.accessSecret);
  } catch {
    throw new ApiError(401, 'Invalid or expired access token');
  }

  const user = await User.findById(payload.sub);
  if (!user) {
    throw new ApiError(401, 'User no longer exists');
  }
  if (user.status !== USER_STATUS.ACTIVE) {
    throw new ApiError(403, 'Account is suspended');
  }

  req.user = user;
  next();
});

module.exports = { protect };