/**
 * signalProcessor.js
 * ─────────────────────────────────────────────────────────────────
 * Road Anomaly Detection Engine
 *
 * Implements a deterministic temporal peak-sequence algorithm that
 * classifies a 40-sample AZ (vertical acceleration) window from an
 * MPU6050 as:  Pothole | Hump | Smooth
 *
 * Architecture principle:
 *   All detection logic lives here, NEVER in routes or controllers.
 *   This module is intentionally self-contained so it can be ported
 *   to a MicroPython / C++ firmware layer later with minimal effort.
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

// ─── Configurable Thresholds (tune here, not scattered in code) ──
const CONFIG = {
  /** m/s²  – minimum |relativeAZ| for two consecutive samples to
   *  trigger "event detected" (Step 3). Raise to filter micro-noise. */
  EVENT_THRESHOLD: 2.0,

  /** m/s² – minimum absolute value a peak/valley must reach to be
   *  considered a true peak during feature extraction (Step 5). */
  PEAK_THRESHOLD: 4.0,

  /** Samples – minimum index gap between positive and negative peak
   *  for the result to count as a directional event, not jitter. */
  MIN_PEAK_GAP: 2,

  /** Samples – how many samples to analyse after the event start.
   *  Reducing this focuses on the sharpest part of the impulse. */
  MAX_ANALYSIS_SAMPLES: 15,

  /** Samples – skip the first N samples when searching for an event
   *  start (allows the baseline to "settle"). */
  IGNORE_LEADING_SAMPLES: 3,

  /** Number of leading samples used to calculate the static baseline. */
  BASELINE_SAMPLES: 5,

  // ── Severity score thresholds (inclusive upper bounds) ──
  SEVERITY_LOW_MAX: 30,
  SEVERITY_MEDIUM_MAX: 60,
};

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * processWindow
 * Main entry point.  Accepts a 40-element AZ sample array and returns
 * a structured classification result.
 *
 * @param {number[]} window  – Array of ≥ 40 AZ readings (m/s²)
 * @returns {{ type: string, severity: string, confidence: number, features: object }}
 */
function processWindow(window) {
  // ── Step 1: Calculate Baseline ───────────────────────────────
  const baseline = _calcBaseline(window, CONFIG.BASELINE_SAMPLES);
  console.log(`[SignalProcessor] Baseline: ${baseline.toFixed(4)} m/s²`);

  // ── Step 2: Normalize Signal ─────────────────────────────────
  const relative = window.map((s) => s - baseline);

  // ── Step 3: Detect Event Start ───────────────────────────────
  const eventStart = _findEventStart(relative);
  console.log(`[SignalProcessor] Event start index: ${eventStart}`);

  if (eventStart === -1) {
    console.log('[SignalProcessor] Prediction: SMOOTH (no event detected)');
    return _buildResult('Smooth', 'Low', 0, {});
  }

  // ── Step 4: Slice Analysis Window ────────────────────────────
  const analysisSlice = relative.slice(
    eventStart,
    eventStart + CONFIG.MAX_ANALYSIS_SAMPLES
  );

  // ── Step 5: Extract Features ─────────────────────────────────
  const features = _extractFeatures(analysisSlice, eventStart);
  console.log('[SignalProcessor] Features:', features);

  // ── Step 6: Classify ─────────────────────────────────────────
  const candidate = _classify(features);
  console.log(`[SignalProcessor] Prediction: ${candidate}`);

  if (candidate === 'Smooth') {
    return _buildResult('Smooth', 'Low', 0, features);
  }

  // ── Severity & Confidence ─────────────────────────────────────
  const { severity, rawScore } = _calcSeverity(features);
  const confidence = _calcConfidence(features, rawScore);
  console.log(`[SignalProcessor] Severity: ${severity} | Confidence: ${confidence}`);

  return _buildResult(candidate, severity, confidence, features);
}

// ─────────────────────────────────────────────────────────────────
// Private Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Calculate the static baseline as the average of the first N samples.
 * @param {number[]} window
 * @param {number}   n
 * @returns {number}
 */
function _calcBaseline(window, n) {
  const slice = window.slice(0, n);
  return slice.reduce((acc, v) => acc + v, 0) / slice.length;
}

/**
 * Find the first sample index (after the leading ignore zone) where
 * two consecutive relative samples both exceed EVENT_THRESHOLD magnitude.
 * Returns -1 if no such pair is found.
 *
 * @param {number[]} relative – Baseline-subtracted signal
 * @returns {number}
 */
function _findEventStart(relative) {
  const start = CONFIG.IGNORE_LEADING_SAMPLES;
  for (let i = start; i < relative.length - 1; i++) {
    if (
      Math.abs(relative[i]) >= CONFIG.EVENT_THRESHOLD &&
      Math.abs(relative[i + 1]) >= CONFIG.EVENT_THRESHOLD
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * Extract temporal peak features from the analysis slice.
 * All indices returned are relative to the full window via `sliceOffset`.
 *
 * @param {number[]} slice       – Analysis segment (up to 15 samples)
 * @param {number}   sliceOffset – The absolute index where the slice begins
 * @returns {object}
 */
function _extractFeatures(slice, sliceOffset) {
  let posPeak = 0,   posPeakIdx = -1;
  let negPeak = 0,   negPeakIdx = -1;

  for (let i = 0; i < slice.length; i++) {
    const v = slice[i];
    if (v > posPeak) { posPeak = v; posPeakIdx = i; }
    if (v < negPeak) { negPeak = v; negPeakIdx = i; }
  }

  // Absolute window indices (helpful for logging / debugging)
  const absPosIdx = posPeakIdx >= 0 ? posPeakIdx + sliceOffset : -1;
  const absNegIdx = negPeakIdx >= 0 ? negPeakIdx + sliceOffset : -1;

  console.log(`[SignalProcessor] Positive Peak: ${posPeak.toFixed(4)} @ slice[${posPeakIdx}] (window[${absPosIdx}])`);
  console.log(`[SignalProcessor] Negative Peak: ${negPeak.toFixed(4)} @ slice[${negPeakIdx}] (window[${absNegIdx}])`);

  // Peak order: which arrived first?
  let peakOrder = 'none';
  if (posPeakIdx >= 0 && negPeakIdx >= 0) {
    peakOrder = negPeakIdx < posPeakIdx ? 'neg_first' : 'pos_first';
  } else if (posPeakIdx >= 0) {
    peakOrder = 'pos_only';
  } else if (negPeakIdx >= 0) {
    peakOrder = 'neg_only';
  }

  const peakTimeGap =
    posPeakIdx >= 0 && negPeakIdx >= 0
      ? Math.abs(posPeakIdx - negPeakIdx)
      : -1;

  const peakDifference = posPeak - negPeak;           // always ≥ 0
  const peakRatio =
    negPeak !== 0 ? Math.abs(posPeak / negPeak) : Infinity;

  console.log(`[SignalProcessor] Peak Order: ${peakOrder} | Time Gap: ${peakTimeGap} samples`);

  return {
    positivePeak:      posPeak,
    positivePeakIndex: absPosIdx,
    negativePeak:      negPeak,
    negativePeakIndex: absNegIdx,
    peakOrder,
    peakTimeGap,
    peakDifference,
    peakRatio: isFinite(peakRatio) ? parseFloat(peakRatio.toFixed(3)) : 999,
  };
}

/**
 * Classify the anomaly based on temporal peak order.
 *
 * Physics rationale:
 *   • POTHOLE  → wheel drops in (negative impulse first), then rebounds
 *                upward (positive impulse). Pattern: neg_first.
 *   • HUMP     → wheel rides up (positive impulse first), then drops back.
 *                Pattern: pos_first.
 *   • SMOOTH   → peaks are absent or too small to qualify.
 *
 * @param {object} features
 * @returns {'Pothole' | 'Hump' | 'Smooth'}
 */
function _classify(features) {
  const { positivePeak, negativePeak, peakOrder, peakTimeGap } = features;

  // Reject if peaks don't cross the significance threshold
  const posSignificant = positivePeak >= CONFIG.PEAK_THRESHOLD;
  const negSignificant = Math.abs(negativePeak) >= CONFIG.PEAK_THRESHOLD;

  if (!posSignificant && !negSignificant) return 'Smooth';

  // Reject if the gap between peaks is too small (likely noise jitter)
  if (peakTimeGap !== -1 && peakTimeGap < CONFIG.MIN_PEAK_GAP) return 'Smooth';

  if (peakOrder === 'neg_first' && negSignificant) return 'Pothole';
  if (peakOrder === 'pos_first' && posSignificant) return 'Hump';

  // Single-sided impulse – use whichever peak is significant
  if (negSignificant && !posSignificant) return 'Pothole';
  if (posSignificant && !negSignificant) return 'Hump';

  return 'Smooth';
}

/**
 * Calculate severity as a normalised score (0-100) bucketed into
 * Low / Medium / High categories.
 *
 * Score = peakDifference * |negativePeak| * positivePeak  (normalised)
 *
 * @param {object} features
 * @returns {{ severity: string, rawScore: number }}
 */
function _calcSeverity(features) {
  const { peakDifference, positivePeak, negativePeak } = features;
  const maxPeak = Math.max(positivePeak, Math.abs(negativePeak));

  // Raw composite score
  const raw = peakDifference * maxPeak * Math.abs(negativePeak);

  // Normalise to 0-100 using an empirical divisor (tune with real data)
  const NORM_DIVISOR = 1000;
  const rawScore = Math.min(100, (raw / NORM_DIVISOR) * 100);

  let severity;
  if (rawScore <= CONFIG.SEVERITY_LOW_MAX)        severity = 'Low';
  else if (rawScore <= CONFIG.SEVERITY_MEDIUM_MAX) severity = 'Medium';
  else                                              severity = 'High';

  return { severity, rawScore: parseFloat(rawScore.toFixed(2)) };
}

/**
 * Estimate detection confidence (0-100) based on how clearly the
 * signal matches the expected pattern.
 *
 * Factors: peak magnitudes, time gap, peak difference.
 *
 * @param {object} features
 * @param {number} rawScore
 * @returns {number}
 */
function _calcConfidence(features, rawScore) {
  const { peakTimeGap, peakDifference } = features;

  let score = rawScore;                              // base from severity

  // Reward a clear time gap between peaks (pattern sharpness)
  if (peakTimeGap >= 4) score += 15;
  else if (peakTimeGap >= CONFIG.MIN_PEAK_GAP) score += 8;

  // Reward a large differential (clear asymmetry → clear anomaly)
  if (peakDifference >= 10) score += 10;
  else if (peakDifference >= 6)  score += 5;

  return Math.min(100, Math.round(score));
}

/**
 * Construct the final result object.
 * @param {string} type
 * @param {string} severity
 * @param {number} confidence
 * @param {object} features
 * @returns {object}
 */
function _buildResult(type, severity, confidence, features) {
  return { type, severity, confidence, features };
}

// ─────────────────────────────────────────────────────────────────
module.exports = { processWindow, CONFIG };
