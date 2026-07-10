/**
 * routes/reports.js
 * ─────────────────────────────────────────────────────────────────
 * REST surface for the AI Civic Report Generator.
 *
 *   GET /reports/generate?range=24h|7d|30d
 *
 * Pipeline:
 *   buildAnalytics()  →  generateReport()  →  { generatedAt, summary, markdown }
 *
 * The analytics summary is always produced and returned. The AI
 * markdown is best-effort: if Gemini is unavailable the endpoint still
 * responds 200 with the summary and a null markdown + error message,
 * so the dashboard can degrade gracefully and never crash.
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const express = require('express');
const router  = express.Router();

const { buildAnalytics, normaliseRange } = require('../services/reportGenerator');
const { generateReport } = require('../services/aiService');

/**
 * GET /reports/generate
 * Optional query: ?range=24h | 7d | 30d  (defaults to 24h)
 */
router.get('/generate', async (req, res) => {
  try {
    const range = normaliseRange(req.query.range);

    // 1. Analytics first — cheap, local, never sends raw data anywhere.
    const summary = await buildAnalytics(range);

    // 2. Best-effort AI report. Failure here must NOT fail the request.
    const ai = await generateReport(summary);

    return res.json({
      generatedAt: summary.generatedAt,
      range,
      summary,
      markdown: ai.ok ? ai.markdown : null,
      aiAvailable: ai.ok,
      message: ai.ok ? null : 'AI report generation unavailable.',
      error: ai.ok ? null : ai.error,
    });
  } catch (err) {
    console.error('[Reports] Failed to generate report:', err);
    return res.status(500).json({
      error: 'Failed to generate report',
      details: err.message,
    });
  }
});

module.exports = router;
