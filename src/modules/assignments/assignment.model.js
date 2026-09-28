const mongoose = require('mongoose');
const { ASSIGNMENT_STATUS } = require('../../utils/constants');

const assignmentSchema = new mongoose.Schema(
  {
    incident: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', required: true },
    responder: { type: mongoose.Schema.Types.ObjectId, ref: 'Responder', required: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: {
      type: String,
      enum: Object.values(ASSIGNMENT_STATUS),
      default: ASSIGNMENT_STATUS.ASSIGNED,
    },
    matchScore: { type: Number },
    distanceKm: { type: Number },
    etaMinutes: { type: Number },
    // Prevents sending the "Responder Nearby" notification more than once
    nearbyNotified: { type: Boolean, default: false },
    assignedAt: { type: Date, default: Date.now },
    acceptedAt: { type: Date },
    declinedAt: { type: Date },
    onTheWayAt: { type: Date },
    arrivedAt: { type: Date },
    handlingAt: { type: Date },
    completedAt: { type: Date },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);

assignmentSchema.index({ incident: 1 });
assignmentSchema.index({ responder: 1, status: 1 });

assignmentSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Assignment', assignmentSchema);