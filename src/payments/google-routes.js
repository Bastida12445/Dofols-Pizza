const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

function validCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

async function getDrivingRoute(origin, destination) {
  const apiKey = process.env.GOOGLE_MAPS_ROUTES_API_KEY;
  if (!apiKey) {
    const error = new Error('Driving-distance delivery is not configured yet.');
    error.status = 503;
    throw error;
  }
  const address = typeof destination?.address === 'string' ? destination.address.trim() : '';
  const hasCoordinates = validCoordinate(destination?.latitude, -90, 90)
    && validCoordinate(destination?.longitude, -180, 180);
  if (!validCoordinate(origin.latitude, -90, 90) || !validCoordinate(origin.longitude, -180, 180)
      || (address.length < 8 && !hasCoordinates)) {
    const error = new Error('Enter a valid shop pin and complete delivery address.');
    error.status = 400;
    throw error;
  }

  const response = await fetch(ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.legs.endLocation.latLng'
    },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: Number(origin.latitude), longitude: Number(origin.longitude) } } },
      destination: address.length >= 8
        ? { address }
        : { location: { latLng: { latitude: Number(destination.latitude), longitude: Number(destination.longitude) } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE'
    })
  });
  const result = await response.json().catch(() => ({}));
  const route = result?.routes?.[0];
  const destinationLatLng = route?.legs?.at(-1)?.endLocation?.latLng;
  if (!response.ok || !Number.isFinite(Number(route?.distanceMeters))
      || !validCoordinate(destinationLatLng?.latitude, -90, 90)
      || !validCoordinate(destinationLatLng?.longitude, -180, 180)) {
    console.error('Google Routes request failed:', response.status, result?.error?.status || 'route unavailable');
    const error = new Error('Could not find a driving route for that location. Check the delivery pin and try again.');
    error.status = 502;
    throw error;
  }
  return {
    distanceMeters: Number(route.distanceMeters),
    destination: { latitude: Number(destinationLatLng.latitude), longitude: Number(destinationLatLng.longitude) }
  };
}

module.exports = { getDrivingRoute };
