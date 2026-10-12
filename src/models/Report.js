const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    bus: { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', required: true },
    reportType: { type: String, enum: ['condition', 'safety'], required: true },
    description: { type: String, required: true },
    status: { type: String, enum: ['open', 'reviewed', 'resolved'], default: 'open' },
  },
  { timestamps: true }
);

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);