const mongoose = require('mongoose');

const routeSchema = new mongoose.Schema(
  {
    routeName: { type: String, required: true, trim: true },
    startPoint: { type: String, required: true },
    endPoint: { type: String, required: true },
    description: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Route', routeSchema);