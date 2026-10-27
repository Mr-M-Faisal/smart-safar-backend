const mongoose = require('mongoose');

const stopSchema = new mongoose.Schema(
  {
    route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true },
    stopName: { type: String, required: true, trim: true, maxlength: 120 },
    // Stops are only meaningful on the Faisalabad transit network. Keep
    // persisted coordinates inside the same bounds used by the map client.
    latitude: { type: Number, required: true, min: 30.9, max: 32.0 },
    longitude: { type: Number, required: true, min: 72.6, max: 73.7 },
    stopOrder: { type: Number, required: true, min: 1, validate: Number.isInteger },
  },
  { timestamps: true }
);

stopSchema.index({ route: 1, stopOrder: 1 });

module.exports = mongoose.model('Stop', stopSchema);
