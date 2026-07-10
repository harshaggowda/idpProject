/**
 * geocodeService.js
 * ─────────────────────────────────────────────────────────────────
 * Server-side reverse geocoding for the AI Civic Report Generator.
 *
 * Turns hotspot latitude/longitude into short, human-readable
 * addresses (e.g. "Hosur Road, BTM Layout, Bengaluru") so the
 * generated report references real places instead of raw coordinates.
 *
 * Uses OpenStreetMap Nominatim (free, no API key). We respect its
 * usage policy (https://operations.osmfoundation.org/policies/nominatim/):
 *   • Max 1 request/second  → requests are serialised through a queue.
 *   • Identify the app      → a descriptive User-Agent is sent.
 *   • No bulk usage         → every result is cached in-process, and
 *                             only the handful of hotspots that appear
 *                             in a report are ever looked up.
 *
 * All failures degrade gracefully to `null` so report generation
 * never breaks if the geocoder is unavailable.
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const MIN_INTERVAL_MS = 1100;   // a little over 1s to stay within policy
const REQUEST_TIMEOUT_MS = 8000;
const USER_AGENT = 'SmartRoad-RoadMonitor/1.0 (civic report generator)';

// In-process cache: "lat4,lng4" -> address string (or null if unresolved)
const cache = new Map();

const cacheKey = (lat, lng) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

// ── Serialise requests so we never exceed 1 req/sec ───────────────
let chain = Promise.resolve();
let lastRequestAt = 0;

/**
 * Build a short, human-friendly address from a Nominatim response.
 * Mirrors the frontend formatter for consistency.
 */
function formatAddress(data) {
  const a = data.address || {};
  const parts = [
    a.road || a.pedestrian || a.neighbourhood || a.suburb,
    a.suburb && a.suburb !== a.road ? a.suburb : a.village || a.town,
    a.city || a.town || a.county,
  ].filter(Boolean);

  const seen = new Set();
  const unique = parts.filter((p) => (seen.has(p) ? false : seen.add(p)));

  return unique.slice(0, 3).join(', ') || data.display_name || null;
}

/**
 * One throttled Nominatim request, appended to the serial queue.
 */
function throttledFetch(lat, lng) {
  const run = async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const url =
        `${ENDPOINT}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  };

  const result = chain.then(run, run);
  chain = result.catch(() => {}); // keep the chain alive after a failure
  return result;
}

/**
 * Reverse-geocode a single coordinate to a short address.
 * Returns the cached value when available, else fetches it.
 * Resolves to `null` (never throws) on any failure.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<string|null>}
 */
async function reverseGeocode(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  const key = cacheKey(lat, lng);
  if (cache.has(key)) return cache.get(key);

  try {
    const data = await throttledFetch(lat, lng);
    const address = formatAddress(data);
    cache.set(key, address); // cache null too, so we don't refetch dead coords
    return address;
  } catch (err) {
    console.warn(`[geocode] Reverse lookup failed for ${key}: ${err.message}`);
    cache.set(key, null);
    return null;
  }
}

/**
 * Reverse-geocode many points, returning a map of "lat4,lng4" -> address.
 * De-duplicates by grid cell so each unique location is fetched once.
 *
 * @param {Array<{latitude:number, longitude:number}>} points
 * @returns {Promise<Map<string, string|null>>}
 */
async function reverseGeocodeMany(points) {
  const out = new Map();
  const unique = new Map(); // key -> {lat,lng}

  for (const p of points || []) {
    if (typeof p?.latitude === 'number' && typeof p?.longitude === 'number') {
      unique.set(cacheKey(p.latitude, p.longitude), p);
    }
  }

  for (const [key, p] of unique) {
    out.set(key, await reverseGeocode(p.latitude, p.longitude));
  }
  return out;
}

module.exports = {
  reverseGeocode,
  reverseGeocodeMany,
  cacheKey,
};
