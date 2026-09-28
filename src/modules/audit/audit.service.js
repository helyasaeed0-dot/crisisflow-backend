const AuditLog = require('./auditLog.model');

// Records privileged actions. Never throws, so it cannot break the main request.
async function logAction({ userId, action, entity, entityId, meta }) {
  try {
    await AuditLog.create({ user: userId, action, entity, entityId, meta });
  } catch (err) {
    console.error('Failed to write audit log:', err.message);
  }
}

async function listAuditLogs({ entity, action, userId, page, limit }) {
  const filter = {};
  if (entity) filter.entity = entity;
  if (action) filter.action = action;
  if (userId) filter.user = userId;

  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('user', 'name email role'),
    AuditLog.countDocuments(filter),
  ]);

  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

module.exports = { logAction, listAuditLogs };