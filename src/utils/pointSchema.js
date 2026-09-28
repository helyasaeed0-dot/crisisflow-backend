const { Schema } = require('mongoose');

// Reusable GeoJSON Point schema. Coordinates order: [longitude, latitude]
const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (v) =>
          Array.isArray(v) &&
          v.length === 2 &&
          v[0] >= -180 && v[0] <= 180 &&
          v[1] >= -90 && v[1] <= 90,
        message: 'Coordinates must be [longitude, latitude]',
      },
    },
  },
  { _id: false }
);

// Helper to build a point from latitude/longitude
const toPoint = (latitude, longitude) => ({
  type: 'Point',
  coordinates: [Number(longitude), Number(latitude)],
});

module.exports = { pointSchema, toPoint };