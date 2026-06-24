/**
 * sensorRoutes.js
 * ─────────────────────────────────────────────────────────────────
 * Express router for the /sensor namespace.
 *
 * Routes are intentionally thin – all logic delegates to
 * controllers/sensorController.js.
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { ingestWindow } = require('../controllers/sensorController');

/**
 * POST /sensor/window
 * Receive a 40-sample AZ window from the ESP8266, run the Signal
 * Processing Engine, store detected anomalies, and return the result.
 */
router.post('/window', ingestWindow);

module.exports = router;
