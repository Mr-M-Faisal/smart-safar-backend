const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema(
  {
    driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    bus: { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', required: true },
    route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true },
    startedAt: { type: Date, default: Date.now, required: true },
    endedAt: { type: Date, default: null },
    status: { type: String, enum: ['active', 'completed'], default: 'active', required: true },
    startDirection: { type: String, enum: ['outbound', 'return'], required: true },
  },
  { timestamps: true }
);

shiftSchema.index({ driver: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
shiftSchema.index({ bus: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
shiftSchema.index({ driver: 1, startedAt: -1 });

module.exports = mongoose.model('Shift', shiftSchema);
