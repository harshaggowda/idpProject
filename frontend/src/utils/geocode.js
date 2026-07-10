// Reverse geocoding via OpenStreetMap Nominatim (free, no API key required).
//
// Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/):
//   - Max 1 request per second  -> we serialize requests through a throttled queue.
//   - No heavy/bulk usage       -> we cache every result in localStorage so a given
//                                  coordinate is only ever fetched once.
//   - Identify your app         -> we send a descriptive Referer via the browser.

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const CACHE_PREFIX = 'revgeo:';
const MIN_INTERVAL_MS = 1100; // a little over 1s to stay within the rate limit

// Round coordinates so nearby points share a cache entry (~11m at 4 decimals).
const cacheKey = (lat, lng) => `${CACHE_PREFIX}${lat.toFixed(4)},${lng.toFixed(4)}`;

const readCache = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeCache = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage full or unavailable — ignore, we just won't cache */
  }
};

// Build a short, human-friendly address from a Nominatim response.
const formatAddress = (data) => {
  const a = data.address || {};
  const parts = [
    a.road || a.pedestrian || a.neighbourhood || a.suburb,
    a.suburb && a.suburb !== a.road ? a.suburb : a.village || a.town,
    a.city || a.town || a.county,
  ].filter(Boolean);

  // De-duplicate while preserving order.
  const seen = new Set();
  const unique = parts.filter((p) => (seen.has(p) ? false : seen.add(p)));

  return unique.slice(0, 3).join(', ') || data.display_name || null;
};

// Serialize network requests so we never exceed Nominatim's 1 req/sec limit.
let chain = Promise.resolve();
let lastRequestAt = 0;

const throttledFetch = (lat, lng) => {
  const run = async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();

    const url = `${ENDPOINT}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    return res.json();
  };

  // Append to the chain so requests fire one after another.
  const result = chain.then(run, run);
  chain = result.catch(() => {}); // keep the chain alive even if one request fails
  return result;
};

/**
 * Reverse-geocode a coordinate to a short address string.
 * Returns the cached value instantly when available, otherwise fetches it.
 * Resolves to `null` if the lookup fails.
 */
export async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null;

  const key = cacheKey(lat, lng);
  const cached = readCache(key);
  if (cached !== null) return cached;

  try {
    const data = await throttledFetch(lat, lng);
    const address = formatAddress(data);
    if (address) writeCache(key, address);
    return address;
  } catch (err) {
    console.error('Reverse geocoding failed:', err);
    return null;
  }
}

export default reverseGeocode;
