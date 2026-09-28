const { getIO } = require('./index');

// Emits safely: a socket failure must never break an API request
function safeEmit(room, event, payload) {
  try {
    getIO().to(room).emit(event, payload);
  } catch (err) {
    console.error(`Socket emit failed (${event}):`, err.message);
  }
}

const emitToAdmins = (event, payload) => safeEmit('admins', event, payload);
const emitToIncident = (incidentId, event, payload) => safeEmit(`incident:${incidentId}`, event, payload);
const emitToUser = (userId, event, payload) => safeEmit(`user:${userId}`, event, payload);

module.exports = { emitToAdmins, emitToIncident, emitToUser };