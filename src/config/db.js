const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, { autoIndex: process.env.NODE_ENV !== 'production' });
    console.log(`MongoDB connected: ${conn.connection.host} | Database: ${conn.connection.name}`);
  } catch (err) {
    console.error(`MongoDB connection error: ${err.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
