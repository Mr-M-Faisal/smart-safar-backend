const mongoose = require('mongoose');

const routeAlertSchema = new mongoose.Schema(
  {
    route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true },
    message: { type: String, required: true },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

routeAlertSchema.index({ route: 1, createdAt: -1 });

module.exports = mongoose.model('RouteAlert', routeAlertSchema);