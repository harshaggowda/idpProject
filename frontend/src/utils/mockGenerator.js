/**
 * mockGenerator.js
 * ─────────────────────────────────────────────────────────────────
 * Test utilities for the SmartRoad frontend.
 *
 * Two generators are exported:
 *   • generateMockData()        – legacy: posts directly to /events
 *   • generateSensorWindows()   – new: posts synthetic MPU6050 windows
 *                                 to /sensor/window to exercise the
 *                                 full Signal Processing Engine pipeline.
 * ─────────────────────────────────────────────────────────────────
 */

import api from './api';

// ── Bangalore hotspot coordinates ─────────────────────────────────
const MOCK_LOCATIONS = [
  { lat: 12.9716, lng: 77.5946 }, // Bangalore Centre
  { lat: 12.9352, lng: 77.6245 }, // Koramangala
  { lat: 12.9250, lng: 77.5938 }, // Jayanagar
  { lat: 12.9784, lng: 77.6408 }, // Indiranagar
];

// ─────────────────────────────────────────────────────────────────
// Legacy mock data generator (posts directly to /events)
// Kept for backwards compatibility with existing AdminPanel button.
// ─────────────────────────────────────────────────────────────────
export const generateMockData = async () => {
  try {
    for (let i = 0; i < 10; i++) {
      const baseLoc    = MOCK_LOCATIONS[Math.floor(Math.random() * MOCK_LOCATIONS.length)];
      const latOffset  = (Math.random() - 0.5) * 0.01;
      const lngOffset  = (Math.random() - 0.5) * 0.01;
      const type       = Math.random() > 0.5 ? 'pothole' : 'hump';
      const severity   = ['low', 'medium', 'high'][Math.floor(Math.random() * 3)];

      await api.post('/events', {
        latitude:  baseLoc.lat + latOffset,
        longitude: baseLoc.lng + lngOffset,
        type,
        severity,
      });

      // Occasionally generate a nearby duplicate to test clustering
      if (Math.random() > 0.7) {
        await api.post('/events', {
          latitude:  baseLoc.lat + latOffset + 0.00005,
          longitude: baseLoc.lng + lngOffset + 0.00005,
          type,
          severity,
        });
      }
    }
    console.log('Mock data generated successfully.');
  } catch (error) {
    console.error('Failed to generate mock data:', error);
  }
};

// ─────────────────────────────────────────────────────────────────
// Signal Processing Engine mock: generates synthetic AZ windows
// and posts them to POST /sensor/window.
//
// Each window simulates a realistic MPU6050 trace:
//   • Steady baseline (≈ 9.81 m/s²)
//   • Injected anomaly pattern (pothole or hump)
//   • Gaussian noise on every sample
// ─────────────────────────────────────────────────────────────────

/**
 * Add Gaussian noise using the Box-Muller transform.
 * @param {number} mean
 * @param {number} std
 * @returns {number}
 */
function _gaussianNoise(mean = 0, std = 0.3) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * std;
}

/**
 * Build a synthetic 40-sample AZ window for a POTHOLE.
 *
 * Physics signature:
 *   Wheel hits the edge of the hole → sudden downward jerk (negative AZ spike),
 *   then the suspension rebounds upward (positive AZ spike).
 *   Pattern: negative peak BEFORE positive peak.
 *
 * @param {number} baseline  ~9.81 m/s²
 * @returns {number[]}
 */
function _buildPotholeWindow(baseline = 9.81) {
  const w = Array.from({ length: 40 }, () => baseline + _gaussianNoise(0, 0.2));

  // Inject anomaly at index 10 (well past IGNORE_LEADING_SAMPLES=3)
  const hitIdx = 10;
  w[hitIdx]     = baseline - 7.5 + _gaussianNoise(0, 0.5);  // drop-in (negative)
  w[hitIdx + 1] = baseline - 6.0 + _gaussianNoise(0, 0.5);
  w[hitIdx + 2] = baseline - 3.0 + _gaussianNoise(0, 0.3);
  w[hitIdx + 4] = baseline + 5.5 + _gaussianNoise(0, 0.5);  // rebound (positive)
  w[hitIdx + 5] = baseline + 4.0 + _gaussianNoise(0, 0.4);
  w[hitIdx + 6] = baseline + 2.0 + _gaussianNoise(0, 0.3);

  return w;
}

/**
 * Build a synthetic 40-sample AZ window for a HUMP (speed breaker).
 *
 * Physics signature:
 *   Wheel rides up onto the hump → upward compression (positive AZ spike),
 *   then drops off the other side (negative AZ spike).
 *   Pattern: positive peak BEFORE negative peak.
 *
 * @param {number} baseline
 * @returns {number[]}
 */
function _buildHumpWindow(baseline = 9.81) {
  const w = Array.from({ length: 40 }, () => baseline + _gaussianNoise(0, 0.2));

  const hitIdx = 10;
  w[hitIdx]     = baseline + 7.0 + _gaussianNoise(0, 0.5);  // ride-up (positive)
  w[hitIdx + 1] = baseline + 5.5 + _gaussianNoise(0, 0.4);
  w[hitIdx + 2] = baseline + 3.0 + _gaussianNoise(0, 0.3);
  w[hitIdx + 4] = baseline - 5.0 + _gaussianNoise(0, 0.5);  // drop-off (negative)
  w[hitIdx + 5] = baseline - 3.5 + _gaussianNoise(0, 0.4);
  w[hitIdx + 6] = baseline - 1.5 + _gaussianNoise(0, 0.3);

  return w;
}

/**
 * Build a synthetic 40-sample AZ window for a SMOOTH road.
 * Only low-amplitude noise; no anomaly injection.
 *
 * @param {number} baseline
 * @returns {number[]}
 */
function _buildSmoothWindow(baseline = 9.81) {
  return Array.from({ length: 40 }, () => baseline + _gaussianNoise(0, 0.15));
}

/**
 * generateSensorWindows
 * Posts `count` synthetic sensor windows through the full
 * Signal Processing Engine pipeline (POST /sensor/window).
 *
 * @param {number} count  Number of windows to submit (default 5)
 * @returns {Promise<object[]>} Array of API responses
 */
export const generateSensorWindows = async (count = 5) => {
  const results = [];

  for (let i = 0; i < count; i++) {
    // Randomly pick an anomaly type (weighted: 40% pothole, 40% hump, 20% smooth)
    const roll = Math.random();
    let window;
    if (roll < 0.4)       window = _buildPotholeWindow();
    else if (roll < 0.8)  window = _buildHumpWindow();
    else                  window = _buildSmoothWindow();

    // New payload: ESP8266 sends ONLY deviceId + window.
    // GPS coordinates are resolved server-side via timestamp matching.
    const payload = {
      deviceId: 'mock-device-001',
      window,
    };

    try {
      const res = await api.post('/sensor/window', payload);
      results.push(res.data);
      console.log(`[MockSensor] Window ${i + 1}/${count}:`, res.data);
    } catch (err) {
      console.error(`[MockSensor] Window ${i + 1} failed:`, err.message);
      results.push({ error: err.message });
    }
  }

  return results;
};
