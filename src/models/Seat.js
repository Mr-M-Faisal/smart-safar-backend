const mongoose = require('mongoose');
const seatSchema = new mongoose.Schema({
  bus: { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', required: true },
  shift: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift', required: true },
  seatNumber: { type: String, required: true, trim: true },
  status: { type: String, enum: ['available', 'reserved', 'occupied'], default: 'available', required: true },
  booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
}, { timestamps: true });
seatSchema.index({ shift: 1, seatNumber: 1 }, { unique: true });
seatSchema.index({ bus: 1, shift: 1, status: 1 });
module.exports = mongoose.model('Seat', seatSchema);
