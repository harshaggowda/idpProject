/**
 * gpsController.js
 * ─────────────────────────────────────────────────────────────────
 * Business logic for GPS endpoints.
 *
 * Thin controller layer — all domain logic delegates to
 * services/gpsService.js.  Mirrors the route handlers from the
 * original Flask module (routes/gps.py):
 *   POST /update  → updateGps
 *   GET  /latest  → getLatestGps
 *   GET  /history → getGpsHistory
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const gpsService = require('../services/gpsService');

/**
 * POST /gps/update
 *
 * Receive a GPS update from the phone.
 * Expected JSON payload:
 * {
 *   "latitude":  12.9716,
 *   "longitude": 77.5946,
 *   "accuracy":  10,
 *   "timestamp": "2026-06-23T23:00:00.000Z"
 * }
 */
async function updateGps(req, res) {
  try {
    // 1. Validate
    const error = gpsService.validateGpsData(req.body);
    if (error) {
      return res.status(400).json({ success: false, error });
    }

    // 2. Store
    await gpsService.storeGpsUpdate(req.body);

    // 3. Respond (mirrors original Flask success_response format)
    return res.json({ success: true, message: 'GPS updated' });

  } catch (err) {
    console.error('[GpsController] Error storing GPS update:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: err.message,
    });
  }
}

/**
 * GET /gps/latest
 *
 * Retrieve the most recent GPS position.
 * Mirrors the original Flask GET /api/gps/latest endpoint.
 */
async function getLatestGps(req, res) {
  try {
    const location = await gpsService.getLatestPosition();

    if (location) {
      return res.json(location);
    } else {
      return res.status(404).json({
        success: false,
        error: 'No GPS data available yet',
      });
    }
  } catch (err) {
    console.error('[GpsController] Error fetching latest GPS:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}

/**
 * GET /gps/history?limit=40
 *
 * Retrieve recent GPS history.
 */
async function getGpsHistory(req, res) {
  try {
    const limit = Math.min(
      parseInt(req.query.limit, 10) || gpsService.MAX_RECORDS,
      gpsService.MAX_RECORDS
    );

    const records = await gpsService.getHistory(limit);
    return res.json(records);
  } catch (err) {
    console.error('[GpsController] Error fetching GPS history:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}

module.exports = { updateGps, getLatestGps, getGpsHistory };
