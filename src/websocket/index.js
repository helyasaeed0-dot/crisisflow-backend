const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const User = require('../modules/users/user.model');
const { ROLES, USER_STATUS } = require('../utils/constants');

const ADMIN_ROLES = [ROLES.ADMIN, ROLES.SUPER_ADMIN];

let io;

// Accepts the token from auth payload, Authorization header or query string
function extractToken(socket) {
  const { auth = {}, headers = {}, query = {} } = socket.handshake;
  if (auth.token) return String(auth.token).replace(/^Bearer\s+/i, '');
  if (headers.authorization) return headers.authorization.replace(/^Bearer\s+/i, '');
  if (query.token) return String(query.token);
  return null;
}

// Runs once per connection: rejects sockets without a valid access token
async function authenticate(socket, next) {
  try {
    const token = extractToken(socket);
    if (!token) return next(new Error('Authentication required'));

    const payload = jwt.verify(token, config.jwt.accessSecret);
    const user = await User.findById(payload.sub).select('name role status');
    if (!user || user.status !== USER_STATUS.ACTIVE) {
      return next(new Error('Account is not active'));
    }

    socket.data.user = { id: user._id.toString(), name: user.name, role: user.role };
    return next();
  } catch {
    return next(new Error('Invalid or expired token'));
  }
}

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: config.clientUrl, credentials: true },
  });

  io.use(authenticate);

  io.on('connection', (socket) => {
    const { user } = socket.data;

    // Private room for this user's notifications and assignments
    socket.join(`user:${user.id}`);

    // Admins automatically receive every command-center update
    if (ADMIN_ROLES.includes(user.role)) {
      socket.join('admins');
    }

    console.log(`Socket connected: ${user.name} (${user.role})`);

    // Follow one incident live, only if the user is allowed to view it
    socket.on('incident:join', async (incidentId, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (!/^[a-f0-9]{24}$/i.test(String(incidentId))) {
          return reply({ ok: false, message: 'Invalid incident id' });
        }

        // Lazy require avoids a circular dependency with the incident service
        const { assertCanView } = require('../modules/incidents/incident.service');
        await assertCanView({ _id: user.id, role: user.role }, incidentId);

        socket.join(`incident:${incidentId}`);
        return reply({ ok: true });
      } catch (err) {
        return reply({ ok: false, message: err.message || 'Access denied' });
      }
    });

    socket.on('incident:leave', (incidentId) => {
      socket.leave(`incident:${incidentId}`);
    });

    socket.on('disconnect', (reason) => {
      console.log(`Socket disconnected: ${user.name} (${reason})`);
    });
  });

  return io;
}

// Use this inside services to emit events
function getIO() {
  if (!io) {
    throw new Error('Socket.IO has not been initialized');
  }
  return io;
}

module.exports = { initSocket, getIO };