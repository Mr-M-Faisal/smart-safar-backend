const mongoose = require("mongoose");

const busSchema = new mongoose.Schema(
  {
    busNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    route: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Route",
      required: true,
    },
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    capacity: {
      type: Number,
      required: true,
    },
    availableSeats: {
      type: Number,
      required: true,
    },
    currentLocation: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },
    lastLocationUpdate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "idle", "maintenance"],
      default: "idle",
    },
    trustScore: {
      score: { type: Number, default: 0 },
      totalRatings: { type: Number, default: 0 },
    },
    // --- ETA calculation support ---
    // Index into that route's stops (sorted by stopOrder) of the last
    // stop this bus is considered to have reached. The "next stop" is
    // always the one right after this index.
    currentStopIndex: {
      type: Number,
      default: 0,
    },
    direction: {
      type: String,
      enum: ["outbound", "return"],
      default: "outbound",
    },
    // Last 5 speed readings (km/h) reported by the driver's device,
    // used as a moving average to smooth out GPS noise.
    recentSpeeds: {
      type: [Number],
      default: [],
    },
  },
  { timestamps: true },
);

busSchema.index({ route: 1 });

module.exports = mongoose.model("Bus", busSchema);
