const apiBase = (process.env.SMART_SAFAR_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const email = process.env.SIMULATOR_DRIVER_EMAIL;
const password = process.env.SIMULATOR_DRIVER_PASSWORD;
const busId = process.env.SIMULATOR_BUS_ID;

if (!email || !password || !busId) {
  console.error('Set SIMULATOR_DRIVER_EMAIL, SIMULATOR_DRIVER_PASSWORD, and SIMULATOR_BUS_ID before running this script.');
  process.exit(1);
}

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${apiBase}/api${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${payload?.message || 'request failed'}`);
  return payload;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const identity = await request('/auth/login', { method: 'POST', body: { email, password } });
  if (identity.role !== 'driver') throw new Error('The simulator account must have the driver role.');
  const bus = await request(`/buses/${encodeURIComponent(busId)}`);
  const routeId = bus.route?._id || bus.route;
  if (!routeId) throw new Error('The selected bus has no route assigned.');
  const stops = await request(`/stops/route/${encodeURIComponent(routeId)}`);
  const orderedStops = [...stops].filter((stop) => Number.isFinite(Number(stop.latitude)) && Number.isFinite(Number(stop.longitude))).sort((left, right) => left.stopOrder - right.stopOrder);
  if (orderedStops.length < 2) throw new Error('At least two route stops with coordinates are required.');
  const profile = await request('/auth/profile', { token: identity.token });
  if (!profile.activeShift || String(profile.activeShift.bus?._id || profile.activeShift.bus) !== String(busId)) {
    throw new Error('Start a shift for this bus in the driver workspace before running the simulator.');
  }

  console.log(`Sending simulated GPS for ${bus.busNumber || busId} on ${profile.activeShift.route?.routeName || 'the assigned route'} every five seconds. Press Ctrl+C to stop.`);
  let index = 0;
  while (true) {
    const start = orderedStops[index % orderedStops.length];
    const end = orderedStops[(index + 1) % orderedStops.length];
    for (let step = 0; step < 12; step += 1) {
      const fraction = step / 12;
      const latitude = Number(start.latitude) + (Number(end.latitude) - Number(start.latitude)) * fraction;
      const longitude = Number(start.longitude) + (Number(end.longitude) - Number(start.longitude)) * fraction;
      const update = await request(`/buses/${encodeURIComponent(busId)}/location`, {
        method: 'PATCH',
        token: identity.token,
        body: { latitude, longitude, speed: 20, timestamp: new Date().toISOString() },
      });
      console.log(`${new Date().toLocaleTimeString()} · ${latitude.toFixed(5)}, ${longitude.toFixed(5)} · next ${update.nextStop?.stopName || 'terminal'} · ETA ${update.etaMinutes ?? '—'} min`);
      await wait(5000);
    }
    index = (index + 1) % orderedStops.length;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
