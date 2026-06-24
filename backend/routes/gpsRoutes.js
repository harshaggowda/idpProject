/**
 * gpsRoutes.js
 * ─────────────────────────────────────────────────────────────────
 * Express router for the /gps namespace.
 *
 * Ported from the Flask Blueprint (routes/gps.py) in the original
 * GPS module.  Routes are intentionally thin – all logic delegates
 * to controllers/gpsController.js.
 *
 *   POST /gps/update   – Receive GPS update from phone
 *   GET  /gps/latest   – Get most recent GPS position
 *   GET  /gps/history  – Get GPS history (limited)
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { updateGps, getLatestGps, getGpsHistory } = require('../controllers/gpsController');

/**
 * POST /gps/update
 * Receive a GPS update from the phone's Geolocation API.
 */
router.post('/update', updateGps);

/**
 * GET /gps/latest
 * Retrieve the most recent GPS position.
 */
router.get('/latest', getLatestGps);

/**
 * GET /gps/history
 * Retrieve recent GPS history (with optional ?limit=N query param).
 */
router.get('/history', getGpsHistory);

module.exports = router;
