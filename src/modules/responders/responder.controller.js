const responderService = require('./responder.service');
const asyncHandler = require('../../utils/asyncHandler');

const me = asyncHandler(async (req, res) => {
  const data = await responderService.getMyProfile(req.user);
  res.json({ success: true, data });
});

const myAssignments = asyncHandler(async (req, res) => {
  const data = await responderService.getMyAssignments(req.user, req.query);
  res.json({ success: true, data });
});

const updateStatus = asyncHandler(async (req, res) => {
  const data = await responderService.updateMyStatus(req.user, req.body);
  res.json({ success: true, message: 'Status updated', data });
});

const list = asyncHandler(async (req, res) => {
  const data = await responderService.listResponders(req.query);
  res.json({ success: true, data });
});

const nearby = asyncHandler(async (req, res) => {
  const data = await responderService.findNearby(req.query);
  res.json({ success: true, data });
});

const verify = asyncHandler(async (req, res) => {
  const data = await responderService.verifyResponder(req.user, req.params.id, req.body);
  res.json({ success: true, message: 'Responder verification updated', data });
});

module.exports = { me, myAssignments, updateStatus, list, nearby, verify };