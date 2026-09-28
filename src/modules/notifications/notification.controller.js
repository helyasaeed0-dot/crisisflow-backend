const notificationService = require('./notification.service');
const asyncHandler = require('../../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const data = await notificationService.listForUser(req.user._id, req.query);
  res.json({ success: true, data });
});

const unreadCount = asyncHandler(async (req, res) => {
  const data = await notificationService.countUnread(req.user._id);
  res.json({ success: true, data });
});

const markRead = asyncHandler(async (req, res) => {
  const data = await notificationService.markRead(req.user._id, req.params.id);
  res.json({ success: true, data });
});

const markAllRead = asyncHandler(async (req, res) => {
  const data = await notificationService.markAllRead(req.user._id);
  res.json({ success: true, message: 'All notifications marked as read', data });
});

module.exports = { list, unreadCount, markRead, markAllRead };