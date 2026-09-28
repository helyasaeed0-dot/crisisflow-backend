const assignmentService = require('./assignment.service');
const asyncHandler = require('../../utils/asyncHandler');

const recommendations = asyncHandler(async (req, res) => {
  const data = await assignmentService.getRecommendations(req.params.id, req.query);
  res.json({ success: true, data });
});

const assign = asyncHandler(async (req, res) => {
  const data = await assignmentService.assignResponders(req.user, req.params.id, req.body.responderIds);
  res.status(201).json({ success: true, message: 'Responders assigned', data });
});

const accept = asyncHandler(async (req, res) => {
  const data = await assignmentService.respondToAssignment(req.user, req.params.id, 'accept');
  res.json({ success: true, message: 'Assignment accepted', data });
});

const decline = asyncHandler(async (req, res) => {
  const data = await assignmentService.respondToAssignment(req.user, req.params.id, 'decline');
  res.json({ success: true, message: 'Assignment declined', data });
});

const updateStatus = asyncHandler(async (req, res) => {
  const data = await assignmentService.updateIncidentStatus(req.user, req.params.id, req.body);
  res.json({ success: true, message: `Status updated to ${req.body.status}`, data });
});

module.exports = { recommendations, assign, accept, decline, updateStatus };