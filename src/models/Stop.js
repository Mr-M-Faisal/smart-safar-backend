const mongoose = require('mongoose');

const stopSchema = new mongoose.Schema(
  {
    route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true },
    stopName: { type: String, required: true, trim: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    stopOrder: { type: Number, required: true }, // position along the route
  },
  { timestamps: true }
);

stopSchema.index({ route: 1, stopOrder: 1 });

module.exports = mongoose.model('Stop', stopSchema);