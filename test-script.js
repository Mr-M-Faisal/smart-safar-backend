const baseUrl = 'http://localhost:5000';

const summary = [];

const rand = Math.random().toString(36).substring(7);
const adminEmail = `admin_${rand}@test.com`;
const driverEmail = `driver_${rand}@test.com`;
const busNumber = `BUS-${Math.floor(Math.random() * 10000)}`;

let adminToken = '';
let driverToken = '';
let routeId = '';
let busId = '';
let stopId = '';
let bookingId = '';
let reportId = '';

async function runTests() {
  console.log("Starting tests...\n");

  // Helper to run step
  async function step(num, desc, fn) {
    console.log(`\n--- Step ${num}: ${desc} ---`);
    try {
      const { passed, actual } = await fn();
      if (passed) {
        console.log(`✅ PASS: ${desc}`);
        console.log("Response:", JSON.stringify(actual, null, 2));
        summary.push({ num, desc, status: 'PASS' });
      } else {
        console.log(`❌ FAIL: ${desc}`);
        console.log("Expected condition not met.");
        console.log("Response:", JSON.stringify(actual, null, 2));
        summary.push({ num, desc, status: 'FAIL' });
      }
    } catch (error) {
      console.log(`❌ FAIL (Error): ${desc}`);
      console.log("Error:", error.message);
      summary.push({ num, desc, status: 'FAIL (Error)' });
    }
  }

  // 1. Register a new admin user
  await step(1, "Register a new admin user", async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin Test', email: adminEmail, password: 'password123', role: 'admin' })
    });
    const data = await res.json();
    return { passed: res.status === 201 && data.token, actual: data };
  });

  // 2. Login as that admin
  await step(2, "Login as that admin", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: 'password123' })
    });
    const data = await res.json();
    if (res.status === 200 && data.token) {
        adminToken = data.token;
    }
    return { passed: res.status === 200 && typeof data.token === 'string', actual: data };
  });

  // 3. Create a route
  await step(3, "Create a route", async () => {
    const res = await fetch(`${baseUrl}/api/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ routeName: `Route ${rand}`, startPoint: 'A', endPoint: 'B' })
    });
    const data = await res.json();
    if (res.status === 201 && data._id) {
        routeId = data._id;
    }
    return { passed: res.status === 201, actual: data };
  });

  // 4. Fetch that route by ID
  await step(4, "Fetch that route by ID", async () => {
    const res = await fetch(`${baseUrl}/api/routes/${routeId}`);
    const data = await res.json();
    return { passed: res.status === 200 && data._id === routeId, actual: data };
  });

  // 5. Create a stop on that route
  await step(5, "Create a stop on that route", async () => {
    const res = await fetch(`${baseUrl}/api/stops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ route: routeId, stopName: 'Stop 1', latitude: 10, longitude: 20, stopOrder: 1 })
    });
    const data = await res.json();
    return { passed: res.status === 201, actual: data };
  });

  // 6. Create a bus on that route
  await step(6, "Create a bus on that route", async () => {
    const res = await fetch(`${baseUrl}/api/buses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ busNumber: busNumber, route: routeId, capacity: 40, availableSeats: 40 })
    });
    const data = await res.json();
    if (res.status === 201 && data._id) {
        busId = data._id;
    }
    return { passed: res.status === 201 && data.availableSeats === data.capacity, actual: data };
  });

  // 7. Register a driver user and log in as them
  await step(7, "Register driver user and log in", async () => {
    const res1 = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Driver Test', email: driverEmail, password: 'password123', role: 'driver', assignedBus: busId })
    });
    const data1 = await res1.json();
    
    const res2 = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: driverEmail, password: 'password123' })
    });
    const data2 = await res2.json();
    if (res2.status === 200 && data2.token) {
        driverToken = data2.token;
    }
    return { passed: res1.status === 201 && res2.status === 200, actual: { register: data1, login: data2 } };
  });

  // 8. Update the bus's location as the driver
  await step(8, "Update bus location as driver", async () => {
    const loc = { latitude: 12.34, longitude: 56.78 };
    const res = await fetch(`${baseUrl}/api/buses/${busId}/location`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${driverToken}` },
      body: JSON.stringify({ latitude: loc.latitude, longitude: loc.longitude })
    });
    const data = await res.json();
    return { passed: res.status === 200 && data.currentLocation && data.currentLocation.latitude === loc.latitude, actual: data };
  });

  // 9. Create a booking on that bus as admin user (check seat)
  await step(9, "Create booking and check available seats", async () => {
    const res1 = await fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ bus: busId, seatNumber: '1', fare: 10 })
    });
    const data1 = await res1.json();
    if (data1._id) {
        bookingId = data1._id;
    }
    
    const res2 = await fetch(`${baseUrl}/api/buses/${busId}`);
    const data2 = await res2.json();
    
    return { passed: res1.status === 201 && data2.availableSeats === 39, actual: { booking: data1, bus: data2 } };
  });

  // 10. Cancel booking and check seats
  await step(10, "Cancel booking and check seats", async () => {
    const res1 = await fetch(`${baseUrl}/api/bookings/${bookingId}/cancel`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` }
    });
    const data1 = await res1.json();
    
    const res2 = await fetch(`${baseUrl}/api/buses/${busId}`);
    const data2 = await res2.json();
    
    return { passed: res1.status === 200 && data2.availableSeats === 40, actual: { cancel: data1, bus: data2 } };
  });

  // 11. File a report on that bus
  await step(11, "File a report on that bus", async () => {
    const res = await fetch(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ bus: busId, reportType: 'condition', description: 'Dirty seats' })
    });
    const data = await res.json();
    return { passed: res.status === 201, actual: data };
  });

  // 12. Fetch admin overview
  await step(12, "Fetch admin overview", async () => {
    const res = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    return { passed: res.status === 200 && data.buses && data.buses.total >= 1, actual: data };
  });

  console.log("\n--- SUMMARY ---");
  console.table(summary);
}

runTests();
