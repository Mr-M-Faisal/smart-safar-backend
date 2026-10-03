const mongoose = require('mongoose');

const stopSchema = new mongoose.Schema(
  {
    route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true },
    stopName: { type: String, required: true, trim: true, maxlength: 120 },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    stopOrder: { type: Number, required: true, min: 1, validate: Number.isInteger },
  },
  { timestamps: true }
);

stopSchema.index({ route: 1, stopOrder: 1 });

module.exports = mongoose.model('Stop', stopSchema);
