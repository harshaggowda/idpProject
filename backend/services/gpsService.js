/**
 * gpsService.js
 * ─────────────────────────────────────────────────────────────────
 * Service layer for GPS location data.
 *
 * Ported from the original Python GPSService class
 * (services/gps_service.py in the GPS module repo) and extended
 * with MongoDB persistence and automatic record pruning.
 *
 * Responsibilities:
 *   1. Validate incoming GPS payloads.
 *   2. Store every GPS update to MongoDB.
 *   3. Prune old records — keep only the latest MAX_RECORDS.
 *   4. Retrieve the most recent GPS position.
 *   5. Retrieve GPS history (limited).
 *   6. Find the GPS record closest to a given timestamp
 *      (for future sensor → GPS matching).
 *
 * This service is intentionally independent from the sensor /
 * signal-processing pipeline.
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const GpsRecord = require('../models/GpsRecord');

// ── Configuration ────────────────────────────────────────────────
const MAX_RECORDS = 40; // Only keep the most recent N GPS records

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * Validate the incoming GPS payload.
 * Mirrors the validation in the original Flask route (routes/gps.py).
 *
 * @param {object} data  – req.body
 * @returns {string|null} Error message or null if valid.
 */
function validateGpsData(data) {
  if (!data) return 'Invalid JSON payload';

  const { latitude, longitude, timestamp } = data;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return 'latitude and longitude must be numbers';
  }
  if (latitude < -90 || latitude > 90) {
    return 'latitude must be between -90 and 90';
  }
  if (longitude < -180 || longitude > 180) {
    return 'longitude must be between -180 and 180';
  }
  if (!timestamp) {
    return 'timestamp is required';
  }

  return null;
}

/**
 * Store a new GPS record and prune old entries.
 *
 * Mirrors GPSService.update_location() from the original Python
 * module, but persists to MongoDB instead of in-memory dict.
 *
 * @param {object} data  – { latitude, longitude, accuracy, timestamp }
 * @returns {Promise<object>} The saved GpsRecord document.
 */
async function storeGpsUpdate(data) {
  const record = new GpsRecord({
    latitude:  data.latitude,
    longitude: data.longitude,
    accuracy:  data.accuracy ?? null,
    timestamp: data.timestamp,
    receivedAt: new Date(),
  });

  const saved = await record.save();

  console.log(
    `📍 GPS Update: Lat ${saved.latitude.toFixed(5)}, ` +
    `Lng ${saved.longitude.toFixed(5)} ` +
    `(Accuracy: ${saved.accuracy ?? '?'}m)`
  );

  // ── Prune: keep only the latest MAX_RECORDS ───────────────────
  await _pruneOldRecords();

  return saved;
}

/**
 * Retrieve the most recent GPS position.
 * Mirrors GPSService.get_latest_location() from the original module.
 *
 * @returns {Promise<object|null>}
 */
async function getLatestPosition() {
  return GpsRecord.findOne().sort({ receivedAt: -1 }).lean();
}

/**
 * Retrieve recent GPS history.
 *
 * @param {number} limit  – Max records to return (default 40)
 * @returns {Promise<object[]>}
 */
async function getHistory(limit = MAX_RECORDS) {
  return GpsRecord.find()
    .sort({ receivedAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Find the GPS record whose receivedAt timestamp is closest to
 * the given target timestamp.
 *
 * This is the core method for future sensor → GPS matching:
 *   1. A sensor event arrives with a backend timestamp.
 *   2. We search GPS history for the closest match.
 *   3. Attach that GPS location to the detected anomaly.
 *
 * Strategy: find one record just before and one just after the
 * target, then return whichever is closer.
 *
 * @param {Date|string} targetTimestamp
 * @returns {Promise<object|null>}
 */
async function findNearestToTimestamp(targetTimestamp) {
  const target = new Date(targetTimestamp);

  // Record just before (or at) the target
  const before = await GpsRecord.findOne({ receivedAt: { $lte: target } })
    .sort({ receivedAt: -1 })
    .lean();

  // Record just after the target
  const after = await GpsRecord.findOne({ receivedAt: { $gt: target } })
    .sort({ receivedAt: 1 })
    .lean();

  if (!before && !after) return null;
  if (!before) return after;
  if (!after) return before;

  const diffBefore = Math.abs(target - new Date(before.receivedAt));
  const diffAfter  = Math.abs(new Date(after.receivedAt) - target);

  return diffBefore <= diffAfter ? before : after;
}

// ─────────────────────────────────────────────────────────────────
// Private Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Remove oldest records when the collection exceeds MAX_RECORDS.
 * Keeps the database lean — only the most recent ~40 entries survive.
 */
async function _pruneOldRecords() {
  const count = await GpsRecord.countDocuments();
  if (count > MAX_RECORDS) {
    // Find the receivedAt of the record at position MAX_RECORDS
    const cutoffRecord = await GpsRecord.findOne()
      .sort({ receivedAt: -1 })
      .skip(MAX_RECORDS - 1)
      .select('receivedAt')
      .lean();

    if (cutoffRecord) {
      await GpsRecord.deleteMany({ receivedAt: { $lt: cutoffRecord.receivedAt } });
    }
  }
}

// ─────────────────────────────────────────────────────────────────
module.exports = {
  validateGpsData,
  storeGpsUpdate,
  getLatestPosition,
  getHistory,
  findNearestToTimestamp,
  MAX_RECORDS,
};
