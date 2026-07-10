/**
 * sensorController.js
 * ─────────────────────────────────────────────────────────────────
 * Business logic for the sensor window ingestion pipeline.
 *
 * Responsibilities:
 *   1. Validate the incoming ESP8266 payload (deviceId + window).
 *   2. Record the server-side receivedAt timestamp immediately.
 *   3. Delegate signal analysis to signalProcessor.
 *   4. If an anomaly is detected:
 *      a. Match the receivedAt timestamp to the nearest GPS record
 *         from the phone GPS service.
 *      b. Persist an Event + update/create the corresponding
 *         Ticket cluster using the matched GPS coordinates.
 *   5. Return a structured classification response.
 *
 * Architecture:
 *   ESP8266 sends ONLY sensor data (deviceId + window).
 *   The phone GPS service is the ONLY GPS provider.
 *   This controller synchronizes sensor events with GPS history
 *   using timestamp matching via gpsService.findNearestToTimestamp().
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const { processWindow } = require('../services/signalProcessor');
const gpsService = require('../services/gpsService');
const Event  = require('../models/Event');
const Ticket = require('../models/Ticket');

// ── Haversine distance (metres) ───────────────────────────────────
function _getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─────────────────────────────────────────────────────────────────
// Controller Methods
// ─────────────────────────────────────────────────────────────────

/**
 * POST /sensor/window
 *
 * Expected request body (from ESP8266):
 * {
 *   "deviceId": "RVCE_BIKE_01",
 *   "window":   [ ...40 AZ values... ]
 * }
 *
 * No latitude, longitude, or timestamp required from the device.
 *
 * Response:
 * {
 *   "type":       "Pothole" | "Hump" | "Smooth",
 *   "severity":   "Low" | "Medium" | "High",
 *   "confidence": 0-100,
 *   "eventId":    "<mongo id>" | null
 * }
 */
async function ingestWindow(req, res) {
  try {
    // ── 0. Record arrival timestamp immediately ────────────────
    const receivedAt = new Date();

    const { deviceId, window: rawWindow } = req.body;

    // ── 1. Input Validation ────────────────────────────────────
    const validationError = _validatePayload(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    // ── 2. Run Signal Processing Engine ───────────────────────
    const result = processWindow(rawWindow);
    const { type, severity, confidence, features } = result;

    // ── 3. If Smooth → return immediately, nothing to store ───
    if (type === 'Smooth') {
      return res.json({ type, severity, confidence, eventId: null });
    }

    // ── 4. Map classification to DB-compatible lowercase type ─
    const dbType     = type.toLowerCase();
    const dbSeverity = severity.toLowerCase();

    // ── 5. GPS Timestamp Matching ─────────────────────────────
    // Find the GPS record closest to this sensor window's arrival
    const gpsPoint = await gpsService.findNearestToTimestamp(receivedAt);

    const latitude  = gpsPoint ? gpsPoint.latitude  : null;
    const longitude = gpsPoint ? gpsPoint.longitude : null;

    if (gpsPoint) {
      console.log(
        `[SensorController] GPS match: Lat ${latitude.toFixed(5)}, ` +
        `Lng ${longitude.toFixed(5)} ` +
        `(Δt = ${Math.abs(receivedAt - new Date(gpsPoint.receivedAt))}ms)`
      );
    } else {
      console.log('[SensorController] No GPS data available for timestamp matching');
    }

    // ── 6. Cluster: find nearby active ticket of the same type ─
    // Humps (speed breakers) are informational only — they are shown on the
    // map as Events but never raise a maintenance ticket. Only potholes are
    // clustered into tickets. Clustering also requires GPS coordinates.
    let ticketId = null;
    if (dbType === 'pothole' && latitude !== null && longitude !== null) {
      const activeTickets = await Ticket.find({
        issue_type: dbType,
        status: { $ne: 'resolved' },
      });

      let matchedTicket = null;
      for (const ticket of activeTickets) {
        const dist = _getDistanceInMeters(
          latitude, longitude,
          ticket.location_center.latitude,
          ticket.location_center.longitude
        );
        if (dist <= 10) { // 10 m radius – matches existing logic
          matchedTicket = ticket;
          break;
        }
      }

      if (matchedTicket) {
        matchedTicket.number_of_reports += 1;
        matchedTicket.updated_at = new Date();
        await matchedTicket.save();
        ticketId = matchedTicket._id;
      } else {
        const newTicket = new Ticket({
          location_center: { latitude, longitude },
          issue_type: dbType,
          number_of_reports: 1,
        });
        await newTicket.save();
        ticketId = newTicket._id;
      }
    }

    // ── 7. Persist the Event ───────────────────────────────────
    const event = new Event({
      latitude,
      longitude,
      type:       dbType,
      severity:   dbSeverity,
      cluster_id: ticketId,
      deviceId:   deviceId || null,
      receivedAt,
      confidence,
      features,
      rawWindow,
    });
    const savedEvent = await event.save();

    // ── 8. Respond ────────────────────────────────────────────
    return res.status(201).json({
      type,
      severity,
      confidence,
      eventId: savedEvent._id,
    });

  } catch (err) {
    console.error('[SensorController] Error processing window:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────
// Private Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Validate the incoming sensor payload.
 * Only requires deviceId and a valid window array.
 *
 * @param {object} body
 * @returns {string|null}  Error message or null if valid.
 */
function _validatePayload(body) {
  const { deviceId, window: rawWindow } = body;

  if (!deviceId || typeof deviceId !== 'string') {
    return 'deviceId is required and must be a string';
  }
  if (!Array.isArray(rawWindow) || rawWindow.length < 40) {
    return 'window must be an array of at least 40 numbers';
  }
  if (rawWindow.some((v) => typeof v !== 'number')) {
    return 'window must contain only numeric values';
  }
  return null;
}

module.exports = { ingestWindow };
