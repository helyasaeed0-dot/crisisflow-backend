const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

const DB_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

// Health check: reports 503 if the database is not connected
router.get('/health', (req, res) => {
  const database = DB_STATES[mongoose.connection.readyState] || 'unknown';
  const healthy = database === 'connected';

  res.status(healthy ? 200 : 503).json({
    success: healthy,
    status: healthy ? 'ok' : 'degraded',
    database,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date(),
  });
});

router.use('/auth', require('../modules/auth/auth.routes'));
router.use('/incidents', require('../modules/incidents/incident.routes'));
router.use('/responders', require('../modules/responders/responder.routes'));
router.use('/notifications', require('../modules/notifications/notification.routes'));
router.use('/dashboard', require('../modules/dashboard/dashboard.routes'));
router.use('/demo', require('../modules/demo/demo.routes'));
router.use('/users', require('../modules/users/user.routes'));
router.use('/audit-logs', require('../modules/audit/audit.routes'));
router.use('/media', require('../modules/media/media.routes'));

module.exports = router;