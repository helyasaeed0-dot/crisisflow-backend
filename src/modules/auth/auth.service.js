const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../../config/env');
const User = require('../users/user.model');
const Responder = require('../responders/responder.model');
const ApiError = require('../../utils/ApiError');
const { ROLES, USER_STATUS } = require('../../utils/constants');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function signAccessToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpires }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), jti: crypto.randomUUID() },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpires }
  );
}

// Issues a new token pair and stores only the hash of the refresh token
async function issueTokens(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  await User.updateOne({ _id: user._id }, { refreshTokenHash: hashToken(refreshToken) });
  return { accessToken, refreshToken };
}

async function register(data) {
  const exists = await User.exists({ email: data.email });
  if (exists) {
    throw new ApiError(409, 'Email is already registered');
  }

  const user = await User.create({
    name: data.name,
    email: data.email,
    phone: data.phone,
    password: data.password,
    role: data.role,
  });

  let responder = null;
  if (user.role === ROLES.RESPONDER) {
    try {
      // New responders start unverified and offline until an admin verifies them
      responder = await Responder.create({ user: user._id, type: data.responderType });
    } catch (err) {
      await User.deleteOne({ _id: user._id });
      throw err;
    }
  }

  const tokens = await issueTokens(user);
  return { user, responder, ...tokens };
}

async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+password');

  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, 'Invalid email or password');
  }
  if (user.status !== USER_STATUS.ACTIVE) {
    throw new ApiError(403, 'Account is suspended');
  }

  const tokens = await issueTokens(user);
  const responder = user.role === ROLES.RESPONDER
    ? await Responder.findOne({ user: user._id })
    : null;

  return { user, responder, ...tokens };
}

async function refresh(refreshToken) {
  let payload;
  try {
    payload = jwt.verify(refreshToken, config.jwt.refreshSecret);
  } catch {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  const user = await User.findById(payload.sub).select('+refreshTokenHash');
  if (!user || !user.refreshTokenHash || user.refreshTokenHash !== hashToken(refreshToken)) {
    throw new ApiError(401, 'Refresh token is no longer valid');
  }
  if (user.status !== USER_STATUS.ACTIVE) {
    throw new ApiError(403, 'Account is suspended');
  }

  // Rotate: the old refresh token stops working
  return issueTokens(user);
}

async function logout(userId) {
  await User.updateOne({ _id: userId }, { $unset: { refreshTokenHash: 1 } });
}

async function getMe(user) {
  const responder = user.role === ROLES.RESPONDER
    ? await Responder.findOne({ user: user._id })
    : null;
  return { user, responder };
}

module.exports = { register, login, refresh, logout, getMe };