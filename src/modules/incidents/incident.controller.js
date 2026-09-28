const incidentService = require('./incident.service');
const asyncHandler = require('../../utils/asyncHandler');

const create = asyncHandler(async (req, res) => {
  const result = await incidentService.createReport(req.user, req.body, req.files || []);

  res.status(201).json({
    success: true,
    message: result.merged
      ? 'Your report was linked to an existing incident'
      : 'Emergency reported successfully',
    data: {
      referenceId: result.incident.referenceId,
      incidentId: result.incident._id,
      status: result.incident.status,
      merged: result.merged,
      reportId: result.report._id,
      ...(result.duplicateInfo && { duplicateInfo: result.duplicateInfo }),
    },
  });
});

const list = asyncHandler(async (req, res) => {
  const data = await incidentService.listIncidents(req.user, req.query);
  res.json({ success: true, data });
});

const getById = asyncHandler(async (req, res) => {
  const data = await incidentService.getIncidentById(req.user, req.params.id);
  res.json({ success: true, data });
});

const track = asyncHandler(async (req, res) => {
  const data = await incidentService.trackByReference(req.user, req.params.referenceId);
  res.json({ success: true, data });
});

const analyze = asyncHandler(async (req, res) => {
  const data = await incidentService.reanalyzeIncident(req.user, req.params.id);
  res.json({ success: true, message: 'Incident re-analyzed', data });
});

const verify = asyncHandler(async (req, res) => {
  const data = await incidentService.verifyIncident(req.user, req.params.id, req.body);
  res.json({ success: true, message: 'Incident verified', data });
});

module.exports = { create, list, getById, track, analyze, verify };