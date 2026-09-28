const simulator = require('./demo.simulator');
const asyncHandler = require('../../utils/asyncHandler');

const generate = asyncHandler(async (req, res) => {
  const data = await simulator.generateEmergency(req.body);
  res.status(201).json({ success: true, message: 'Simulated emergency created', data });
});

const run = asyncHandler(async (req, res) => {
  const data = await simulator.runFullDemo(req.user, req.body);
  res.status(202).json({ success: true, message: data.message, data });
});

const simulate = asyncHandler(async (req, res) => {
  const data = await simulator.simulateResponse(req.params.id, req.body);
  res.status(202).json({ success: true, message: 'Simulated response started', data });
});

const stop = asyncHandler(async (req, res) => {
  const data = simulator.stopSimulation(req.params.id);
  res.json({ success: true, message: 'Simulation stopped', data });
});

const reset = asyncHandler(async (req, res) => {
  const data = await simulator.resetDemo(req.user, req.body);
  res.json({ success: true, message: 'Demo data reset', data });
});

const status = asyncHandler(async (req, res) => {
  const data = await simulator.getStatus();
  res.json({ success: true, data });
});

module.exports = { generate, run, simulate, stop, reset, status };