// Browser-side Nominatim lookup with a per-session success cache and serialized
// requests (public Nominatim asks consumers to stay at or below 1 request/sec).
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const cache = new Map<string, GeocodedLocation>();
const PERSISTENT_CACHE_PREFIX = 'coldchain:geocode:v1:';
const PERSISTENT_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
let lastNominatimRequest = 0;
let nominatimQueue: Promise<void> = Promise.resolve();

export interface GeocodedLocation {
  latitude: number;
  longitude: number;
  displayName: string;
  query: string;
  approximate: boolean;
}

export class GeocodingError extends Error {
  constructor(message: string, readonly status?: number, readonly details?: unknown) {
    super(message);
    this.name = 'GeocodingError';
  }
}

function waitForNominatimSlot(): Promise<void> {
  const next = nominatimQueue.then(async () => {
    const delayMs = Math.max(0, 1100 - (Date.now() - lastNominatimRequest));
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    lastNominatimRequest = Date.now();
  });
  nominatimQueue = next.catch(() => undefined);
  return next;
}

function normalizeGeocodeResult(value: any, query: string, approximate: boolean): GeocodedLocation | null {
  const latitude = Number(value?.lat ?? value?.latitude);
  const longitude = Number(value?.lon ?? value?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return {
    latitude,
    longitude,
    displayName: typeof value.display_name === 'string'
      ? value.display_name
      : typeof value.displayName === 'string' ? value.displayName : query,
    query,
    approximate,
  };
}

function getCachedLocation(key: string): GeocodedLocation | null {
  const memory = cache.get(key);
  if (memory) return memory;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PERSISTENT_CACHE_PREFIX + encodeURIComponent(key));
    if (!raw) return null;
    const stored = JSON.parse(raw);
    const resolved = normalizeGeocodeResult(stored.location, String(stored.location?.query || ''), Boolean(stored.location?.approximate));
    if (!resolved || !Number.isFinite(Number(stored.savedAt)) || Date.now() - Number(stored.savedAt) > PERSISTENT_CACHE_TTL_MS) {
      window.localStorage.removeItem(PERSISTENT_CACHE_PREFIX + encodeURIComponent(key));
      return null;
    }
    cache.set(key, resolved);
    return resolved;
  } catch {
    return null;
  }
}

function saveCachedLocation(key: string, location: GeocodedLocation): void {
  cache.set(key, location);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PERSISTENT_CACHE_PREFIX + encodeURIComponent(key), JSON.stringify({ location, savedAt: Date.now() }));
  } catch {
    // Storage can be disabled/full; the in-memory cache still avoids duplicate lookups in this session.
  }
}

/** Build progressively broader search strings without inventing coordinates. */
function fallbackQueries(address: string): string[] {
  const queries: string[] = [];
  const normalized = address
    .replace(/\b(logistics|cold[- ]?chain|cold|hub|warehouse|distribution|facility|terminal)\b/gi, ' ')
    .replace(/\b(?:no\.?\s*)?\d+\b/gi, ' ')
    .replace(/[,:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/mumbai/i.test(normalized) && /port/i.test(normalized)) {
    queries.push('Mumbai Port Trust, Mumbai, Maharashtra, India');
  }

  const direction = normalized.match(/\b(north(?:ern)?|south(?:ern)?|east(?:ern)?|west(?:ern)?)\b/i)?.[1];
  if (/delhi/i.test(normalized) && direction) {
    const cardinal = direction.toLowerCase().replace(/ern$/, '').replace(/ern$/, '');
    const title = cardinal[0].toUpperCase() + cardinal.slice(1);
    queries.push(`${title} Delhi, Delhi, India`);
  }

  if (normalized && !queries.includes(`${normalized}, India`)) queries.push(`${normalized}, India`);
  return queries.filter((query, index) => queries.indexOf(query) === index);
}

async function queryNominatim(query: string): Promise<any[]> {
  await waitForNominatimSlot();
  const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=5`;
  let response: Response;
  try {
    // The browser controls User-Agent. Its normal User-Agent and Referer identify
    // the client; Nominatim forbids scripted browser clients from overriding UA.
    response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  } catch (error) {
    throw new GeocodingError(`Nominatim network/timeout error for "${query}"`, undefined, error);
  }
  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new GeocodingError(`Nominatim returned HTTP ${response.status} for "${query}"`, response.status, details);
  }
  const data = await response.json().catch((error) => {
    throw new GeocodingError(`Nominatim returned invalid JSON for "${query}"`, response.status, error);
  });
  if (!Array.isArray(data)) throw new GeocodingError(`Nominatim response was not a result list for "${query}"`, response.status, data);
  return data;
}

/** Resolve a facility/address, retrying with geographic context when a custom POI is not indexed. */
export async function geocodeAddress(address: string): Promise<GeocodedLocation> {
  const key = address.trim().toLocaleLowerCase();
  if (!key) throw new GeocodingError('Cannot geocode an empty address');
  const cached = getCachedLocation(key);
  if (cached) return cached;

  const candidates = [address.trim(), ...fallbackQueries(address.trim())];
  for (let index = 0; index < candidates.length; index += 1) {
    const query = candidates[index];
    const results = await queryNominatim(query);
    const approximate = index > 0;
    const normalized = results
      .map((result) => normalizeGeocodeResult(result, query, approximate))
      .filter((result): result is GeocodedLocation => result !== null);
    if (!normalized.length) continue;

    // Prefer results whose mapped name reflects the intended location, rather
    // than an unrelated facility containing only one shared word.
    const cleanedWords = query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
    normalized.sort((a, b) => {
      const score = (item: GeocodedLocation) => {
        const name = item.displayName.toLowerCase();
        return cleanedWords.reduce((sum, word) => sum + (name.includes(word) ? 1 : 0), 0);
      };
      return score(b) - score(a);
    });

    const resolved = normalized[0];
    saveCachedLocation(key, resolved); // Cache successful resolutions only.
    if (process.env.NODE_ENV === 'development') {
      console.info('[tracking:geocode] resolved', {
        address, query, latitude: resolved.latitude, longitude: resolved.longitude,
        displayName: resolved.displayName, approximate,
      });
    }
    return resolved;
  }

  throw new GeocodingError(`Nominatim found no mapped location for "${address}"`, undefined, { candidates });
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const url = `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lng}&format=jsonv2`;
  try {
    await waitForNominatimSlot();
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) {
      if (process.env.NODE_ENV === 'development') console.warn('[tracking:geocode] reverse lookup HTTP failure', response.status, await response.text().catch(() => ''));
      return null;
    }
    const data = await response.json();
    return typeof data.display_name === 'string' ? data.display_name : null;
  } catch (error) {
    if (process.env.NODE_ENV === 'development') console.warn('[tracking:geocode] reverse lookup failed', error);
    return null;
  }
}
