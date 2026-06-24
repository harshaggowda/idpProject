/**
 * GpsRecord.js
 * ─────────────────────────────────────────────────────────────────
 * Mongoose schema for GPS location records received from the phone.
 *
 * Each document represents a single GPS update captured by the
 * browser's Geolocation API (watchPosition) and streamed to the
 * backend.  The collection is kept lean — only the most recent
 * ~40 records are retained; older ones are pruned automatically
 * by the GPS service after each insert.
 *
 * The `receivedAt` field records the server-side timestamp on
 * ingestion.  This is the key used for future timestamp-based
 * matching when sensor events arrive from the ESP8266.
 * ─────────────────────────────────────────────────────────────────
 */

const mongoose = require('mongoose');

const gpsRecordSchema = new mongoose.Schema({
  // ── Coordinates ──────────────────────────────────────────────
  latitude:  { type: Number, required: true },
  longitude: { type: Number, required: true },

  // ── Metadata from browser Geolocation API ────────────────────
  accuracy:  { type: Number, default: null },

  // ── Timestamps ───────────────────────────────────────────────
  /** ISO timestamp from the phone (Geolocation API position.timestamp) */
  timestamp: { type: String, required: true },

  /** Server-side timestamp — set on ingestion for sync matching */
  receivedAt: { type: Date, default: Date.now },
});

// Index on receivedAt for efficient "find nearest" queries
gpsRecordSchema.index({ receivedAt: -1 });

module.exports = mongoose.model('GpsRecord', gpsRecordSchema);
