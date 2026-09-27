// test-socket.js
// A throwaway script that pretends to be a commuter's app.
// It connects to your server, "watches" one bus, and logs any
// location updates it receives in real time.
//
// Usage: node test-socket.js <busId>

const { io } = require('socket.io-client');

const busId = process.argv[2];

if (!busId) {
  console.log('Usage: node test-socket.js <busId>');
  process.exit(1);
}

const socket = io('http://localhost:5000');

socket.on('connect', () => {
  console.log('Connected to server. Socket id:', socket.id);
  console.log(`Watching bus: ${busId}`);
  socket.emit('watchBus', busId);
});

socket.on('locationUpdate', (data) => {
  console.log('LOCATION UPDATE RECEIVED:');
  console.log(data);
});

socket.on('disconnect', () => {
  console.log('Disconnected from server.');
});