/**
 * reportGenerator.js
 * ─────────────────────────────────────────────────────────────────
 * Analytics Engine for the AI Civic Report Generator.
 *
 * This is the ONLY component that touches raw MongoDB documents for
 * reporting. It distills thousands of Event records into a small,
 * privacy-clean *summary JSON* that can safely be sent to an LLM.
 *
 *   MongoDB  →  Analytics Engine (this file)  →  Summary JSON
 *
 * The summary NEVER contains:
 *   • raw MPU6050 windows
 *   • raw acceleration values
 *   • raw Mongoose documents
 *
 * It contains only aggregated, derived statistics.
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const Event  = require('../models/Event');
const Ticket = require('../models/Ticket');
const { reverseGeocodeMany, cacheKey } = require('./geocodeService');

// ── Supported reporting ranges ────────────────────────────────────
const RANGES = {
  '24h': { label: 'Last 24 Hours', ms: 24 * 60 * 60 * 1000 },
  '7d':  { label: 'Last 7 Days',   ms: 7  * 24 * 60 * 60 * 1000 },
  '30d': { label: 'Last 30 Days',  ms: 30 * 24 * 60 * 60 * 1000 },
};

const DEFAULT_RANGE = '24h';

// ── Severity weighting used for risk scoring ──────────────────────
const SEVERITY_WEIGHT = { high: 3, medium: 2, low: 1 };

// ── Hotspot tuning ────────────────────────────────────────────────
// Grid precision for collapsing nearby detections into one hotspot.
//   3 decimals ≈ 110 m  → one cell per physical location (avoids the
//                         GPS jitter splitting a road into many cells).
//   4 decimals ≈ 11 m   → much finer, but fragments locations.
const HOTSPOT_GRID_DECIMALS = 3;

// How many hotspots to surface in the report's ranked lists.
const TOP_HOTSPOTS = 10;

/**
 * Normalise an incoming range key to a supported one.
 * @param {string} range
 * @returns {string} a valid key from RANGES
 */
function normaliseRange(range) {
  return Object.prototype.hasOwnProperty.call(RANGES, range) ? range : DEFAULT_RANGE;
}

/**
 * Round a coordinate to a grid cell so nearby detections collapse into a
 * single hotspot. Precision is controlled by HOTSPOT_GRID_DECIMALS.
 * @param {number} lat
 * @param {number} lon
 * @returns {string}
 */
function _gridKey(lat, lon) {
  return `${lat.toFixed(HOTSPOT_GRID_DECIMALS)},${lon.toFixed(HOTSPOT_GRID_DECIMALS)}`;
}

/**
 * Determine the dominant (most frequent) severity in a tally.
 * @param {{high:number, medium:number, low:number}} sev
 * @returns {'high'|'medium'|'low'}
 */
function _dominantSeverity(sev) {
  return ['high', 'medium', 'low'].reduce((best, key) =>
    sev[key] > sev[best] ? key : best
  , 'low');
}

/**
 * Build the analytics summary for the requested time range.
 *
 * @param {string} rangeKey '24h' | '7d' | '30d'
 * @returns {Promise<object>} summary JSON (safe to send to the LLM)
 */
async function buildAnalytics(rangeKey) {
  const key   = normaliseRange(rangeKey);
  const range = RANGES[key];
  const since = new Date(Date.now() - range.ms);

  // ── 1. Pull only the lightweight fields we actually need ────────
  // We deliberately exclude rawWindow / features so heavy sensor
  // payloads never enter the analytics layer.
  const events = await Event.find(
    { timestamp: { $gte: since } },
    { type: 1, severity: 1, confidence: 1, latitude: 1, longitude: 1, timestamp: 1 }
  ).lean();

  // ── 2. Headline counters ───────────────────────────────────────
  const statistics = {
    totalEvents:    events.length,
    potholes:       0,
    speedBreakers:  0,
    highSeverity:   0,
    mediumSeverity: 0,
    lowSeverity:    0,
    averageConfidence: 0,
  };

  let confidenceSum   = 0;
  let confidenceCount = 0;

  // hotspot grid: gridKey -> aggregate cell
  const grid = new Map();

  for (const ev of events) {
    // type tallies
    if (ev.type === 'pothole')   statistics.potholes++;
    else if (ev.type === 'hump') statistics.speedBreakers++;

    // severity tallies
    if (ev.severity === 'high')        statistics.highSeverity++;
    else if (ev.severity === 'medium') statistics.mediumSeverity++;
    else if (ev.severity === 'low')    statistics.lowSeverity++;

    // confidence average (ignore nulls)
    if (typeof ev.confidence === 'number') {
      confidenceSum += ev.confidence;
      confidenceCount++;
    }

    // hotspot grouping (requires resolved GPS)
    if (typeof ev.latitude === 'number' && typeof ev.longitude === 'number') {
      const gk = _gridKey(ev.latitude, ev.longitude);
      if (!grid.has(gk)) {
        grid.set(gk, {
          latitude:  ev.latitude,
          longitude: ev.longitude,
          eventCount: 0,
          potholes: 0,
          speedBreakers: 0,
          severity: { high: 0, medium: 0, low: 0 },
        });
      }
      const cell = grid.get(gk);
      cell.eventCount++;
      if (ev.type === 'pothole')   cell.potholes++;
      else if (ev.type === 'hump') cell.speedBreakers++;
      if (cell.severity[ev.severity] !== undefined) cell.severity[ev.severity]++;
    }
  }

  statistics.averageConfidence = confidenceCount
    ? Math.round((confidenceSum / confidenceCount) * 10) / 10
    : 0;

  // ── 3. Rank hotspots by a weighted risk score ───────────────────
  const hotspots = Array.from(grid.values()).map((cell) => {
    const riskScore =
      cell.severity.high   * SEVERITY_WEIGHT.high +
      cell.severity.medium * SEVERITY_WEIGHT.medium +
      cell.severity.low    * SEVERITY_WEIGHT.low;
    return {
      latitude:  Math.round(cell.latitude  * 1e6) / 1e6,
      longitude: Math.round(cell.longitude * 1e6) / 1e6,
      eventCount: cell.eventCount,
      potholes: cell.potholes,
      speedBreakers: cell.speedBreakers,
      dominantSeverity: _dominantSeverity(cell.severity),
      riskScore,
    };
  });

  // Most active roads → by raw event count.
  const mostActive = [...hotspots]
    .sort((a, b) => b.eventCount - a.eventCount)
    .slice(0, TOP_HOTSPOTS);

  // Highest risk areas → by weighted risk score.
  const highestRisk = [...hotspots]
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, TOP_HOTSPOTS);

  // ── 3b. Reverse-geocode the hotspots that appear in the report ──
  // Only the locations surfaced in the top lists are looked up, so we
  // stay well within Nominatim's rate limit. Failures resolve to null
  // and the address simply falls back to coordinates downstream.
  const addressMap = await reverseGeocodeMany([...mostActive, ...highestRisk]);
  const attachAddress = (h) => ({
    ...h,
    address: addressMap.get(cacheKey(h.latitude, h.longitude)) || null,
  });
  for (let i = 0; i < mostActive.length; i++)  mostActive[i]  = attachAddress(mostActive[i]);
  for (let i = 0; i < highestRisk.length; i++) highestRisk[i] = attachAddress(highestRisk[i]);

  // ── 4. Ticket / cluster context (unique potholes & workload) ────
  const [uniquePotholes, activeTickets, resolvedTickets] = await Promise.all([
    Ticket.countDocuments({ issue_type: 'pothole' }),
    Ticket.countDocuments({ status: { $ne: 'resolved' } }),
    Ticket.countDocuments({ status: 'resolved' }),
  ]);

  // ── 5. Event density (avg events per active location) ───────────
  const distinctLocations = grid.size;
  const eventDensity = distinctLocations
    ? Math.round((events.length / distinctLocations) * 10) / 10
    : 0;

  // ── 6. Assemble the clean summary object ────────────────────────
  return {
    generatedAt: new Date().toISOString(),
    timeRange: range.label,
    rangeKey: key,
    statistics,
    severityDistribution: {
      high:   statistics.highSeverity,
      medium: statistics.mediumSeverity,
      low:    statistics.lowSeverity,
    },
    tickets: {
      uniquePotholes,
      activeTickets,
      resolvedTickets,
    },
    coverage: {
      distinctLocations,
      eventDensity,            // avg detections per location
      locatedEvents: hotspots.reduce((s, h) => s + h.eventCount, 0),
      unlocatedEvents: events.length - hotspots.reduce((s, h) => s + h.eventCount, 0),
    },
    mostActiveRoads: mostActive,
    highestRiskAreas: highestRisk,
    hotspots: highestRisk, // alias kept for convenience / prompt clarity
    hasSufficientData: events.length > 0,
  };
}

module.exports = {
  buildAnalytics,
  normaliseRange,
  RANGES,
  DEFAULT_RANGE,
};
