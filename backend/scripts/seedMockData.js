/**
 * scripts/seedMockData.js
 * ─────────────────────────────────────────────────────────────────
 * Seed realistic mock road-anomaly data into MongoDB so the
 * AI Civic Report Generator (and the Dashboard / Map) have enough
 * data to produce a meaningful report.
 *
 * What it inserts:
 *   • Events spread across well-known Bangalore road locations.
 *   • Pothole events are clustered into Tickets (matching the live
 *     10 m / 4-decimal-grid clustering logic) with number_of_reports.
 *   • Timestamps are spread across the last 30 days, weighted so the
 *     24h / 7d / 30d report ranges all contain data.
 *
 * Usage (from the backend/ folder):
 *   node scripts/seedMockData.js            # append mock data
 *   node scripts/seedMockData.js --reset    # wipe Events+Tickets first
 *
 * Requires MONGO_URI in backend/.env (the same persistent database the
 * server uses). It will refuse to run against the ephemeral in-memory
 * DB, because a separate process cannot share that.
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const Event  = require('../models/Event');
const Ticket = require('../models/Ticket');

// ── Bangalore road locations (real landmarks) ─────────────────────
// Each location seeds one hotspot cluster. `potholes` / `humps` set
// how many events of each type are generated there; `sev` biases the
// severity mix so some areas read as higher-risk than others.
const LOCATIONS = [
  { name: 'Silk Board Junction',      lat: 12.9177, lng: 77.6238, potholes: 14, humps: 3, sev: 'high'   },
  { name: 'Marathahalli Bridge',      lat: 12.9568, lng: 77.7011, potholes: 11, humps: 4, sev: 'high'   },
  { name: 'Hebbal Flyover',           lat: 13.0358, lng: 77.5970, potholes: 9,  humps: 2, sev: 'high'   },
  { name: 'KR Puram Hanging Bridge',  lat: 13.0070, lng: 77.6960, potholes: 10, humps: 2, sev: 'medium' },
  { name: 'Outer Ring Road (Bellandur)', lat: 12.9259, lng: 77.6790, potholes: 8, humps: 5, sev: 'medium' },
  { name: 'Koramangala 80 Ft Road',   lat: 12.9352, lng: 77.6245, potholes: 7,  humps: 4, sev: 'medium' },
  { name: 'Indiranagar 100 Ft Road',  lat: 12.9719, lng: 77.6412, potholes: 5,  humps: 6, sev: 'low'    },
  { name: 'MG Road',                  lat: 12.9756, lng: 77.6068, potholes: 4,  humps: 3, sev: 'low'    },
  { name: 'Jayanagar 4th Block',      lat: 12.9250, lng: 77.5938, potholes: 6,  humps: 3, sev: 'medium' },
  { name: 'Bannerghatta Road (BTM)',  lat: 12.9165, lng: 77.6101, potholes: 8,  humps: 4, sev: 'high'   },
  { name: 'Whitefield (ITPL Road)',   lat: 12.9856, lng: 77.7367, potholes: 6,  humps: 2, sev: 'medium' },
  { name: 'Electronic City Phase 1',  lat: 12.8452, lng: 77.6602, potholes: 7,  humps: 3, sev: 'medium' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Small random helpers ──────────────────────────────────────────
const rand   = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick   = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * Pick a severity, biased toward the location's profile.
 * @param {'high'|'medium'|'low'} bias
 */
function biasedSeverity(bias) {
  const tables = {
    high:   ['high', 'high', 'high', 'medium', 'medium', 'low'],
    medium: ['high', 'medium', 'medium', 'medium', 'low', 'low'],
    low:    ['high', 'medium', 'low', 'low', 'low', 'low'],
  };
  return pick(tables[bias] || tables.medium);
}

/**
 * Confidence biased by severity (more severe → higher confidence).
 */
function biasedConfidence(severity) {
  if (severity === 'high')   return Math.round(rand(82, 97));
  if (severity === 'medium') return Math.round(rand(68, 88));
  return Math.round(rand(55, 75));
}

/**
 * A timestamp within the last 30 days, weighted so recent windows are
 * well-populated: ~35% in last 24h, ~35% in last 7d, ~30% in 30d.
 */
function weightedTimestamp() {
  const roll = Math.random();
  let ageMs;
  if (roll < 0.35)      ageMs = rand(0, 1)  * DAY_MS;        // last 24h
  else if (roll < 0.70) ageMs = rand(1, 7)  * DAY_MS;        // 1–7 days
  else                  ageMs = rand(7, 30) * DAY_MS;        // 7–30 days
  return new Date(Date.now() - ageMs);
}

/**
 * Small coordinate jitter that keeps pothole events within the same
 * ~10 m cluster / 4-decimal grid cell as the location centre.
 */
function jitter() {
  // ±0.00004° ≈ ±4.5 m
  return (Math.random() - 0.5) * 0.00008;
}

async function seed() {
  const reset = process.argv.includes('--reset');

  if (!process.env.MONGO_URI) {
    console.error(
      '✗ MONGO_URI is not set in backend/.env.\n' +
      '  This seeder writes to a persistent database. The server\'s\n' +
      '  in-memory fallback cannot be shared with a separate process.\n' +
      '  Set MONGO_URI (MongoDB Atlas) and try again.'
    );
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('✓ Connected to MongoDB (persistent).');

  if (reset) {
    const e = await Event.deleteMany({});
    const t = await Ticket.deleteMany({});
    console.log(`✓ Reset: removed ${e.deletedCount} events, ${t.deletedCount} tickets.`);
  }

  const eventDocs = [];
  let ticketCount  = 0;
  let potholeCount = 0;
  let humpCount    = 0;

  for (const loc of LOCATIONS) {
    // ── Create a Ticket cluster for this location's potholes ──────
    const ticket = await Ticket.create({
      location_center: { latitude: loc.lat, longitude: loc.lng },
      issue_type: 'pothole',
      number_of_reports: loc.potholes,
      status: pick(['pending', 'pending', 'in_progress', 'resolved']),
      created_at: new Date(Date.now() - rand(7, 30) * DAY_MS),
      updated_at: new Date(),
    });
    ticketCount++;

    // ── Pothole events (linked to the ticket cluster) ─────────────
    for (let i = 0; i < loc.potholes; i++) {
      const severity = biasedSeverity(loc.sev);
      eventDocs.push({
        latitude:  loc.lat + jitter(),
        longitude: loc.lng + jitter(),
        type: 'pothole',
        severity,
        cluster_id: ticket._id,
        deviceId: 'SEED_BIKE_01',
        receivedAt: weightedTimestamp(),
        confidence: biasedConfidence(severity),
        timestamp: weightedTimestamp(),
      });
      potholeCount++;
    }

    // ── Hump events (informational, no ticket) ────────────────────
    for (let i = 0; i < loc.humps; i++) {
      const severity = biasedSeverity('low');
      eventDocs.push({
        latitude:  loc.lat + jitter() * 2,
        longitude: loc.lng + jitter() * 2,
        type: 'hump',
        severity,
        cluster_id: null,
        deviceId: 'SEED_BIKE_01',
        receivedAt: weightedTimestamp(),
        confidence: biasedConfidence(severity),
        timestamp: weightedTimestamp(),
      });
      humpCount++;
    }
  }

  await Event.insertMany(eventDocs);

  console.log('─────────────────────────────────────────────');
  console.log(`✓ Seeded ${eventDocs.length} events across ${LOCATIONS.length} Bangalore locations:`);
  console.log(`    • ${potholeCount} potholes`);
  console.log(`    • ${humpCount} speed breakers`);
  console.log(`    • ${ticketCount} pothole tickets (clusters)`);
  console.log('─────────────────────────────────────────────');
  console.log('Tip: open the AI Report page and Generate for 24h / 7d / 30d.');

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error('✗ Seeding failed:', err);
  process.exit(1);
});
