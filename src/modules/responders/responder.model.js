const mongoose = require('mongoose');
const { pointSchema } = require('../../utils/pointSchema');
const {
  RESPONDER_TYPES,
  RESPONDER_AVAILABILITY,
  VERIFICATION_STATUS,
} = require('../../utils/constants');

const responderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    type: { type: String, enum: RESPONDER_TYPES, required: true },
    location: { type: pointSchema },
    lastLocationAt: { type: Date },
    availability: {
      type: String,
      enum: Object.values(RESPONDER_AVAILABILITY),
      default: RESPONDER_AVAILABILITY.OFFLINE,
    },
    verificationStatus: {
      type: String,
      enum: Object.values(VERIFICATION_STATUS),
      default: VERIFICATION_STATUS.PENDING,
    },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Enables "find nearby responders" queries
responderSchema.index({ location: '2dsphere' });
responderSchema.index({ availability: 1, verificationStatus: 1, type: 1 });

responderSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Responder', responderSchema);