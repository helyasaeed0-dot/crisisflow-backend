const mongoose = require('mongoose');
const { pointSchema } = require('../../utils/pointSchema');
const { INCIDENT_CATEGORIES } = require('../../utils/constants');

// Every citizen report is kept as evidence, even when merged into one incident
const incidentReportSchema = new mongoose.Schema(
  {
    incident: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    category: { type: String, enum: INCIDENT_CATEGORIES, required: true },
    description: { type: String, trim: true, maxlength: 2000 },
    media: [
      {
        url: { type: String, required: true },
        mediaType: { type: String, enum: ['image', 'video', 'audio'], required: true },
        _id: false,
      },
    ],
    location: { type: pointSchema, required: true },
    address: { type: String, trim: true },
    isDuplicate: { type: Boolean, default: false },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);

incidentReportSchema.index({ incident: 1 });
incidentReportSchema.index({ location: '2dsphere' });

incidentReportSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('IncidentReport', incidentReportSchema);