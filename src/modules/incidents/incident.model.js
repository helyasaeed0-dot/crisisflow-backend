const mongoose = require('mongoose');
const { pointSchema } = require('../../utils/pointSchema');
const {
  INCIDENT_CATEGORIES,
  SEVERITY,
  INCIDENT_STATUS,
  RESPONDER_TYPES,
} = require('../../utils/constants');

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, enum: Object.values(INCIDENT_STATUS), required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, trim: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const scoreItemSchema = new mongoose.Schema(
  {
    factor: { type: String },
    label: { type: String },
    points: { type: Number },
  },
  { _id: false }
);

const incidentSchema = new mongoose.Schema(
  {
    referenceId: { type: String, required: true, unique: true },
    category: { type: String, enum: INCIDENT_CATEGORIES, required: true },
    description: { type: String, trim: true, maxlength: 2000 },
    severity: { type: String, enum: Object.values(SEVERITY), default: SEVERITY.LOW },
    severityScore: { type: Number, min: 0, max: 100, default: 0 },
    status: {
      type: String,
      enum: Object.values(INCIDENT_STATUS),
      default: INCIDENT_STATUS.REPORTED,
    },
    location: { type: pointSchema, required: true },
    address: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reportCount: { type: Number, default: 1 },

    aiAnalysis: {
      category: { type: String, enum: INCIDENT_CATEGORIES },
      severity: { type: String, enum: Object.values(SEVERITY) },
      confidence: { type: Number, min: 0, max: 1 },
      requiredResources: [{ type: String, enum: RESPONDER_TYPES }],
      factors: [{ type: String }],
      scoreBreakdown: [scoreItemSchema],
      reason: { type: String },
      source: { type: String },
      analyzedAt: { type: Date },
    },

    // Flag for the command center: critical or low-confidence incidents
    needsReview: { type: Boolean, default: false },

    verification: {
      verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      verifiedAt: { type: Date },
      overridden: { type: Boolean, default: false },
    },

    statusHistory: [statusHistorySchema],
    isDemo: { type: Boolean, default: false },
    resolvedAt: { type: Date },
    closedAt: { type: Date },
  },
  { timestamps: true }
);

incidentSchema.index({ location: '2dsphere' });
incidentSchema.index({ status: 1, severity: 1 });
incidentSchema.index({ createdAt: -1 });

incidentSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Incident', incidentSchema);