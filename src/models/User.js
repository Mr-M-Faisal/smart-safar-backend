const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
    {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: function requirePassword() { return !this.googleId; }, minlength: 6 },
    googleId: { type: String, default: undefined, select: false },
    phone: { type: String, trim: true },
    role: { type: String, enum: ['commuter', 'driver', 'admin'], default: 'commuter' },
    isActive: { type: Boolean, default: true },
    assignedBus: { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', default: null },
  },
  { timestamps: true }
);

userSchema.index({ role: 1 });
userSchema.index({ assignedBus: 1 }, { sparse: true });
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
