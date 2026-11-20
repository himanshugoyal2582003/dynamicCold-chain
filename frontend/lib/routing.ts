// Routing abstraction — currently backed by OSRM
// Replace OSRM_BASE_URL env var to switch providers
// Note: OSRM public demo server is for development only.
// Set NEXT_PUBLIC_OSRM_URL to a self-hosted OSRM instance for production.

const OSRM_BASE =
  process.env.NEXT_PUBLIC_OSRM_URL || 'https://router.project-osrm.org';

export interface RouteResult {
  coordinates: [number, number][]; // [lat, lng] pairs for Leaflet
  distanceKm: number;
  durationSec: number;
  durationText: string;
}

/**
 * Format seconds into a human-readable string (e.g. "1 hr 23 min").
 */
function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0 && mins > 0) return `${hrs} hr ${mins} min`;
  if (hrs > 0) return `${hrs} hr`;
  return `${mins} min`;
}

/**
 * Get a driving route between two [lat, lng] points using OSRM.
 *
 * IMPORTANT: OSRM returns coordinates as [longitude, latitude].
 * This function converts them to Leaflet's expected [latitude, longitude] order.
 *
 * Returns null on any error — callers should handle gracefully.
 */
export async function getRoute(
  origin: [number, number],
  destination: [number, number]
): Promise<RouteResult | null> {
  const [originLat, originLng] = origin;
  const [destLat, destLng] = destination;

  const url =
    `${OSRM_BASE}/route/v1/driving/` +
    `${originLng},${originLat};${destLng},${destLat}` +
    `?overview=full&geometries=geojson`;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();

    if (
      !data.routes ||
      data.routes.length === 0 ||
      data.code !== 'Ok'
    ) {
      return null;
    }

    const route = data.routes[0];
    const geoJsonCoords: [number, number][] =
      route.geometry?.coordinates ?? [];

    // OSRM returns [lng, lat] — convert to Leaflet [lat, lng]
    const coordinates: [number, number][] = geoJsonCoords.map(
      ([lng, lat]) => [lat, lng]
    );

    const distanceKm = route.distance / 1000;
    const durationSec: number = route.duration;
    const durationText = formatDuration(durationSec);

    return { coordinates, distanceKm, durationSec, durationText };
  } catch {
    // Return null on network or parse errors — callers handle gracefully
    return null;
  }
}
