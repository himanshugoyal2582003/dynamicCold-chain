// Geocoding abstraction — currently backed by Nominatim
// Replace geocodeAddress/reverseGeocode implementations to switch providers
//
// IMPORTANT: Nominatim usage policy
//   - Max 1 request/second
//   - No bulk/automated requests without permission
//   - Must set a descriptive User-Agent
//   - Cache results to avoid redundant requests
//
// See: https://operations.osmfoundation.org/policies/nominatim/

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'ColdChainFleetPlatform/1.0';

// Simple in-memory cache (browser only — resets on page load)
const cache = new Map<string, GeocodedLocation | null>();
const reverseCache = new Map<string, string | null>();

export interface GeocodedLocation {
  latitude: number;
  longitude: number;
  displayName: string;
}

/**
 * Convert an address string to [lat, lng] coordinates via Nominatim.
 *
 * Results are cached by lowercase-trimmed address key.
 * Returns null on empty results or any error.
 */
export async function geocodeAddress(
  address: string
): Promise<GeocodedLocation | null> {
  const cacheKey = address.toLowerCase().trim();

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) ?? null;
  }

  try {
    const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
    });

    if (!response.ok) {
      cache.set(cacheKey, null);
      return null;
    }

    const results = await response.json();

    if (!Array.isArray(results) || results.length === 0) {
      cache.set(cacheKey, null);
      return null;
    }

    const result = results[0];
    const location: GeocodedLocation = {
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
      displayName: result.display_name ?? address,
    };

    cache.set(cacheKey, location);
    return location;
  } catch {
    cache.set(cacheKey, null);
    return null;
  }
}

/**
 * Convert [lat, lng] coordinates to a human-readable address string via Nominatim.
 *
 * Results are cached by "lat,lng" key rounded to 4 decimal places
 * for cache efficiency (≈11 m precision).
 * Returns the display_name string, or null on error.
 */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<string | null> {
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;

  if (reverseCache.has(cacheKey)) {
    return reverseCache.get(cacheKey) ?? null;
  }

  try {
    const url = `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lng}&format=json`;
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
    });

    if (!response.ok) {
      reverseCache.set(cacheKey, null);
      return null;
    }

    const data = await response.json();
    const displayName: string | null = data.display_name ?? null;

    reverseCache.set(cacheKey, displayName);
    return displayName;
  } catch {
    reverseCache.set(cacheKey, null);
    return null;
  }
}
