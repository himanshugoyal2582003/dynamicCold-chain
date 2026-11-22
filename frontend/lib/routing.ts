// OSRM routing abstraction. Set NEXT_PUBLIC_OSRM_URL to a production router;
// the public demo endpoint is rate limited and intended for light use only.
const OSRM_BASE = (process.env.NEXT_PUBLIC_OSRM_URL || 'https://router.project-osrm.org').replace(/\/$/, '');

export interface RouteResult {
  coordinates: [number, number][]; // Leaflet [latitude, longitude]
  distanceKm: number;
  durationSec: number;
  durationText: string;
}

export class RoutingError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string, readonly details?: unknown) {
    super(message);
    this.name = 'RoutingError';
  }
}

const routeCache = new Map<string, { result: RouteResult; createdAt: number }>();
const ROUTE_CACHE_TTL_MS = 60_000;
const ROUTE_CACHE_MAX = 80;

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0 && mins > 0) return `${hrs} hr ${mins} min`;
  if (hrs > 0) return `${hrs} hr`;
  return `${mins} min`;
}

function validPoint([lat, lng]: [number, number]): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** Get a driving route between Leaflet [lat,lng] points; OSRM receives [lng,lat]. */
export async function getRoute(
  origin: [number, number],
  destination: [number, number],
): Promise<RouteResult> {
  if (!validPoint(origin) || !validPoint(destination)) {
    throw new RoutingError('Routing coordinates are outside valid latitude/longitude ranges', undefined, 'InvalidCoordinates', { origin, destination });
  }

  const cacheKey = `${origin[0].toFixed(5)},${origin[1].toFixed(5)};${destination[0].toFixed(5)},${destination[1].toFixed(5)}`;
  const cached = routeCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < ROUTE_CACHE_TTL_MS) return cached.result;

  // OSRM order is longitude,latitude. Keep URL logging adjacent to construction
  // so development diagnostics show the exact request sent to the service.
  const url = `${OSRM_BASE}/route/v1/driving/${origin[1]},${origin[0]};${destination[1]},${destination[0]}?overview=full&geometries=geojson`;
  if (process.env.NODE_ENV === 'development') console.info('[tracking:osrm] request', { origin, destination, url });

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch (error) {
    const message = error instanceof Error && error.name === 'TimeoutError'
      ? 'Routing service timed out; try again shortly'
      : 'Routing service is unreachable; try again shortly';
    const failure = new RoutingError(message, undefined, 'NetworkError', error);
    if (process.env.NODE_ENV === 'development') console.error('[tracking:osrm] request failed', { url, error });
    throw failure;
  }

  const bodyText = await response.text();
  let data: any;
  try { data = bodyText ? JSON.parse(bodyText) : null; }
  catch (error) {
    const failure = new RoutingError(`OSRM returned invalid JSON (HTTP ${response.status})`, response.status, 'InvalidResponse', bodyText);
    if (process.env.NODE_ENV === 'development') console.error('[tracking:osrm] invalid response', { url, status: response.status, body: bodyText, error });
    throw failure;
  }

  if (process.env.NODE_ENV === 'development') {
    console.info('[tracking:osrm] response', { url, httpStatus: response.status, code: data?.code });
  }
  if (!response.ok) {
    const code = typeof data?.code === 'string' ? data.code : `HTTP${response.status}`;
    const message = response.status === 429
      ? 'Routing service is busy (rate limited); try again shortly'
      : response.status >= 500
        ? 'Routing service is temporarily unavailable'
        : `Routing request rejected (HTTP ${response.status})`;
    const failure = new RoutingError(message, response.status, code, data ?? bodyText);
    if (process.env.NODE_ENV === 'development') console.error('[tracking:osrm] HTTP failure', { url, status: response.status, code, details: data ?? bodyText });
    throw failure;
  }
  if (data?.code !== 'Ok') {
    const code = typeof data?.code === 'string' ? data.code : 'InvalidResponse';
    const message = code === 'NoRoute'
      ? 'No drivable road route was found between these locations'
      : code === 'InvalidUrl' || code === 'InvalidValue'
        ? 'Routing service rejected the coordinates'
        : `Routing service returned ${code}`;
    const failure = new RoutingError(message, response.status, code, data);
    if (process.env.NODE_ENV === 'development') console.error('[tracking:osrm] routing error', { url, status: response.status, code, details: data });
    throw failure;
  }

  const route = data.routes?.[0];
  const geometry = route?.geometry;
  if (!route || geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)) {
    throw new RoutingError('OSRM response did not contain a GeoJSON LineString route', response.status, 'MissingGeometry', data);
  }
  const coordinates: [number, number][] = geometry.coordinates
    .filter((point: unknown) => Array.isArray(point) && point.length >= 2 &&
      Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
      point[0] >= -180 && point[0] <= 180 && point[1] >= -90 && point[1] <= 90)
    .map(([lng, lat]: [number, number]) => [lat, lng]);
  const distanceKm = Number(route.distance) / 1000;
  const durationSec = Number(route.duration);
  if (coordinates.length < 2 || !Number.isFinite(distanceKm) || distanceKm < 0 || !Number.isFinite(durationSec) || durationSec < 0) {
    throw new RoutingError('OSRM route geometry, distance, or duration was invalid', response.status, 'InvalidRouteData', route);
  }

  const result = { coordinates, distanceKm, durationSec, durationText: formatDuration(durationSec) };
  if (routeCache.size >= ROUTE_CACHE_MAX) routeCache.delete(routeCache.keys().next().value!);
  routeCache.set(cacheKey, { result, createdAt: Date.now() });
  return result;
}
