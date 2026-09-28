// Usage: node scripts/socket-test.js <accessToken> [incidentId]
const { io } = require('socket.io-client');

const [token, incidentId] = process.argv.slice(2);
if (!token) {
  console.error('Usage: node scripts/socket-test.js <accessToken> [incidentId]');
  process.exit(1);
}

const socket = io(`http://localhost:${process.env.PORT || 5000}`, { auth: { token } });

// Shows only the useful fields of incident payloads
function summarize(payload) {
  if (payload && payload.referenceId) {
    return {
      referenceId: payload.referenceId,
      status: payload.status,
      severity: payload.severity,
      severityScore: payload.severityScore,
      aiSource: payload.aiAnalysis && payload.aiAnalysis.source,
    };
  }
  return payload;
}

socket.on('connect', () => {
  console.log(`Connected (socket id: ${socket.id}). Waiting for events...`);
  if (incidentId) {
    socket.emit('incident:join', incidentId, (res) => console.log('Join incident:', res));
  }
});

socket.on('connect_error', (err) => {
  console.error('Connection failed:', err.message);
});

socket.onAny((event, payload) => {
  console.log(`\n[${new Date().toLocaleTimeString()}] ${event}`);
  console.log(JSON.stringify(summarize(payload), null, 2));
});

//eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2YWI4Y2JjODZiMzczM2QzNzZkZWRiZDAiLCJyb2xlIjoiQURNSU4iLCJpYXQiOjE3OTA1MTM2MTgsImV4cCI6MTc5MDYwMDAxOH0.-MiA0rCaxSmSVthFcmGwgq58eZlquFx48ouuFR88Ci//