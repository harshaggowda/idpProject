/**
 * Event.js
 * ─────────────────────────────────────────────────────────────────
 * Mongoose schema for road anomaly events.
 *
 * Extended from the original schema to also store sensor-derived
 * fields when an event is created by the Signal Processing Engine.
 * Legacy fields (type, severity, cluster_id) are preserved so the
 * existing /events REST API and frontend remain fully functional.
 * ─────────────────────────────────────────────────────────────────
 */

const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  // ── Location (from GPS timestamp matching) ─────────────────────
  // These are resolved by the backend via gpsService, NOT sent by
  // the ESP8266.  They may be null if no GPS data was available
  // at the time the sensor window arrived.
  latitude:  { type: Number, default: null },
  longitude: { type: Number, default: null },

  // ── Classification ─────────────────────────────────────────────
  /** 'pothole' | 'hump'  – lowercase, matches existing frontend */
  type: {
    type: String,
    enum: ['pothole', 'hump'],
    required: true,
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium',
  },

  // ── Ticket Cluster (existing relationship) ─────────────────────
  cluster_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ticket',
    default: null,
  },

  // ── Sensor / Signal Processing Fields (new, all optional) ──────
  /** The device that sent the window (e.g. "RVCE_BIKE_01") */
  deviceId: { type: String, default: null },

  /** Server-side timestamp when the sensor window was received.
   *  Used for GPS timestamp matching. */
  receivedAt: { type: Date, default: null },

  /** Detection confidence score 0-100 */
  confidence: { type: Number, default: null },

  /** Extracted signal features from the analysis window */
  features: { type: mongoose.Schema.Types.Mixed, default: null },

  /** Raw 40-sample AZ window – stored for debugging / future ML */
  rawWindow: { type: [Number], default: undefined },

  // ── Record Timestamps ──────────────────────────────────────────
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Event', eventSchema);
