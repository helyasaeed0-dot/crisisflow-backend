const http = require('http');
const mongoose = require('mongoose');

const config = require('./config/env');
const connectDB = require('./config/db');
const app = require('./app');
const { initSocket } = require('./websocket');
const { runStartupRecovery } = require('./jobs/recovery');

const SHUTDOWN_TIMEOUT_MS = 10000;

let httpServer;
let io;
let shuttingDown = false;

async function startServer() {
  await connectDB();

  httpServer = http.createServer(app);
  io = initSocket(httpServer);

  httpServer.listen(config.port, () => {
    console.log(`Server running on port ${config.port} (${config.nodeEnv})`);
    if (config.demoMode) {
      console.log('Demo Mode is ENABLED - all data is simulated');
    }
    runStartupRecovery();
  });
}

// Stops accepting new work, closes sockets and the database, then exits
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully...`);

  const forceExit = setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    // io.close() also closes the underlying HTTP server
    if (io) {
      await new Promise((resolve) => io.close(() => resolve()));
    } else if (httpServer) {
      await new Promise((resolve) => httpServer.close(() => resolve()));
    }
    await mongoose.disconnect();
    console.log('Shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  shutdown('uncaughtException');
});

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});