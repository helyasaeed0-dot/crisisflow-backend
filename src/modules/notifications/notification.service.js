const Notification = require('./notification.model');
const User = require('../users/user.model');
const IncidentReport = require('../incidents/incidentReport.model');
const ApiError = require('../../utils/ApiError');
const { ROLES, USER_STATUS } = require('../../utils/constants');
const EVENTS = require('../../websocket/events');
const { emitToUser } = require('../../websocket/emitter');

// Saves a notification and pushes it live. Never throws.
async function notifyUser(userId, { title, message, type, data }) {
  try {
    const notification = await Notification.create({ user: userId, title, message, type, data });
    emitToUser(userId.toString(), EVENTS.NOTIFICATION_NEW, notification.toJSON());
    return notification;
  } catch (err) {
    console.error('Failed to create notification:', err.message);
    return null;
  }
}

async function notifyUsers(userIds, payload) {
  const unique = [...new Set(userIds.map(String))];
  return Promise.all(unique.map((id) => notifyUser(id, payload)));
}

// Notifies every citizen who reported this incident
async function notifyIncidentReporters(incidentId, payload) {
  try {
    const userIds = await IncidentReport.distinct('user', { incident: incidentId });
    return notifyUsers(userIds, payload);
  } catch (err) {
    console.error('Failed to notify reporters:', err.message);
    return [];
  }
}

async function notifyAdmins(payload) {
  try {
    const admins = await User.find({
      role: { $in: [ROLES.ADMIN, ROLES.SUPER_ADMIN] },
      status: USER_STATUS.ACTIVE,
    }).select('_id');
    return notifyUsers(admins.map((a) => a._id), payload);
  } catch (err) {
    console.error('Failed to notify admins:', err.message);
    return [];
  }
}

// ----- API functions for the logged-in user -----

async function listForUser(userId, { page, limit, unreadOnly }) {
  const filter = { user: userId };
  if (unreadOnly) filter.read = false;

  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: userId, read: false }),
  ]);

  return {
    items,
    unreadCount,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

async function countUnread(userId) {
  const unreadCount = await Notification.countDocuments({ user: userId, read: false });
  return { unreadCount };
}

async function markRead(userId, notificationId) {
  // Filtering by user ensures nobody can mark someone else's notification
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, user: userId },
    { read: true },
    { new: true }
  );
  if (!notification) throw new ApiError(404, 'Notification not found');
  return notification;
}

async function markAllRead(userId) {
  const result = await Notification.updateMany({ user: userId, read: false }, { read: true });
  return { updated: result.modifiedCount };
}

module.exports = {
  notifyUser,
  notifyUsers,
  notifyIncidentReporters,
  notifyAdmins,
  listForUser,
  countUnread,
  markRead,
  markAllRead,
};