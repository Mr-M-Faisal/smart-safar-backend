const mongoose = require('mongoose');

const routeSchema = new mongoose.Schema(
  {
    routeName: { type: String, required: true, trim: true, maxlength: 100 },
    startPoint: { type: String, required: true, trim: true, maxlength: 100 },
    endPoint: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Route', routeSchema);
