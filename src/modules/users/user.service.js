const User = require('./user.model');
const { logAction } = require('../audit/audit.service');
const ApiError = require('../../utils/ApiError');
const { ROLES, USER_STATUS } = require('../../utils/constants');
const { getIO } = require('../../websocket');

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function listUsers({ role, status, search, page, limit }) {
  const filter = {};
  if (role) filter.role = role;
  if (status) filter.status = status;
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }

  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);

  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function updateUser(actor, userId, { role, status }) {
  if (String(actor._id) === String(userId)) {
    throw new ApiError(400, 'You cannot change your own account');
  }

  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, 'User not found');

  const changes = {};

  if (role && role !== user.role) {
    // Responder accounts need a responder profile, so they are managed separately
    if (user.role === ROLES.RESPONDER || role === ROLES.RESPONDER) {
      throw new ApiError(400, 'Responder roles are managed through responder registration');
    }
    changes.role = { from: user.role, to: role };
    user.role = role;
  }

  if (status && status !== user.status) {
    changes.status = { from: user.status, to: status };
    user.status = status;
  }

  await user.save();

  if (status === USER_STATUS.SUSPENDED) {
    // Invalidate refresh token and drop any live socket connections
    await User.updateOne({ _id: user._id }, { $unset: { refreshTokenHash: 1 } });
    try {
      getIO().in(`user:${user._id}`).disconnectSockets(true);
    } catch (err) {
      console.error('Failed to disconnect suspended user sockets:', err.message);
    }
  }

  await logAction({
    userId: actor._id,
    action: 'USER_UPDATED',
    entity: 'User',
    entityId: user._id,
    meta: changes,
  });

  return user;
}

module.exports = { listUsers, updateUser };