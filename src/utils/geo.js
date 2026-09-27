// Calculates the straight-line (great-circle) distance between two
// lat/lng points on Earth, using the Haversine formula.
// Returns the distance in kilometers.
//
// Why we need this: MongoDB stores stops and buses as plain latitude/
// longitude numbers, not as points on a route polyline. This gives us
// a reasonable approximation of "how far is the bus from this stop"
// without needing full route-shape data.

const toRadians = (degrees) => (degrees * Math.PI) / 180;

const haversineDistanceKm = (lat1, lon1, lat2, lon2) => {
  const EARTH_RADIUS_KM = 6371;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
};

module.exports = { haversineDistanceKm };