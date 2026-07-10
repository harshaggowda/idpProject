# Road Anomaly Detection Algorithm

This document details the deterministic temporal peak-sequence algorithm implemented in `backend/services/signalProcessor.js`. The engine classifies vertical acceleration (AZ) signals from an MPU6050 sensor into three categories: **Pothole**, **Speed Breaker (Hump)**, and **Smooth Road**.

---

## 1. Physical Rationale

The algorithm relies on the physics of how a vehicle's suspension reacts when traversing road anomalies:

*   **Pothole Signature:** When a wheel encounters a pothole, it first drops into the hole. This causes a sudden downward acceleration (a **negative** vertical impulse). Immediately following this, the wheel hits the far edge of the hole and the suspension rebounds upwards, causing a sharp upward acceleration (a **positive** vertical impulse).
    *   *Temporal Pattern:* **Negative Peak $\rightarrow$ Positive Peak**
*   **Speed Breaker (Hump) Signature:** When a wheel encounters a speed breaker, it is forced upwards, compressing the suspension and causing an upward acceleration (a **positive** vertical impulse). After crossing the crest, the wheel drops back down to the road level, causing a downward acceleration (a **negative** vertical impulse).
    *   *Temporal Pattern:* **Positive Peak $\rightarrow$ Negative Peak**

By analyzing the *order* of the acceleration peaks in a short 40-sample window, we deterministically classify the type of anomaly.

---

## 2. Algorithm Pipeline Implementation

The detection engine processes a window of 40 consecutive vertical acceleration (AZ) samples sent by the ESP8266. Below is the step-by-step breakdown with the corresponding JavaScript implementation.

### Step 1: Baseline Calibration
Instead of assuming gravity is exactly $9.81 m/s^2$ (which varies based on sensor orientation), the algorithm dynamically calculates a static baseline. It takes the average of the first 5 samples, assuming the vehicle is on a flat surface just before hitting the anomaly.

```javascript
/**
 * Calculate the static baseline as the average of the first N samples.
 */
function _calcBaseline(window, n) {
  const slice = window.slice(0, n);
  return slice.reduce((acc, v) => acc + v, 0) / slice.length;
}
```

### Step 2: Signal Normalization
The baseline is subtracted from all samples to center the signal around $0$. This isolates the pure positive and negative impulses.

```javascript
const relative = window.map((s) => s - baseline);
```

### Step 3: Event Trigger Detection
The algorithm scans the normalized signal to find the start of an event. To avoid triggering on micro-noise, it requires **two consecutive samples** to exceed an `EVENT_THRESHOLD` ($2.0 m/s^2$).

```javascript
/**
 * Find the first sample index where two consecutive relative samples 
 * both exceed EVENT_THRESHOLD magnitude.
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
```

### Step 4 & 5: Slice Analysis Window & Feature Extraction
To ignore subsequent bounces or secondary vibrations, the algorithm slices an "analysis segment" (15 samples) starting from the trigger index. It then finds the positive peak, negative peak, their indices, and their temporal order.

```javascript
function _extractFeatures(slice, sliceOffset) {
  let posPeak = 0,   posPeakIdx = -1;
  let negPeak = 0,   negPeakIdx = -1;

  for (let i = 0; i < slice.length; i++) {
    const v = slice[i];
    if (v > posPeak) { posPeak = v; posPeakIdx = i; }
    if (v < negPeak) { negPeak = v; negPeakIdx = i; }
  }

  // Peak order: which arrived first?
  let peakOrder = 'none';
  if (posPeakIdx >= 0 && negPeakIdx >= 0) {
    peakOrder = negPeakIdx < posPeakIdx ? 'neg_first' : 'pos_first';
  } else if (posPeakIdx >= 0) {
    peakOrder = 'pos_only';
  } else if (negPeakIdx >= 0) {
    peakOrder = 'neg_only';
  }

  const peakTimeGap = posPeakIdx >= 0 && negPeakIdx >= 0 
    ? Math.abs(posPeakIdx - negPeakIdx) : -1;
  const peakDifference = posPeak - negPeak;

  return { positivePeak: posPeak, negativePeak: negPeak, peakOrder, peakTimeGap, peakDifference };
}
```

### Step 6: Classification Rules
Using the extracted features, the algorithm applies the physics rationale. It checks if the peaks are significant (cross a higher `PEAK_THRESHOLD` of $4.0 m/s^2$) and if the time gap is large enough to represent a physical wheel displacement rather than sensor jitter.

```javascript
function _classify(features) {
  const { positivePeak, negativePeak, peakOrder, peakTimeGap } = features;

  // Reject if peaks don't cross the significance threshold
  const posSignificant = positivePeak >= CONFIG.PEAK_THRESHOLD;
  const negSignificant = Math.abs(negativePeak) >= CONFIG.PEAK_THRESHOLD;

  if (!posSignificant && !negSignificant) return 'Smooth';

  // Reject if the gap between peaks is too small (likely noise jitter)
  if (peakTimeGap !== -1 && peakTimeGap < CONFIG.MIN_PEAK_GAP) return 'Smooth';

  // CLASSIFICATION BASED ON PHYSICS RATIONALE
  if (peakOrder === 'neg_first' && negSignificant) return 'Pothole';
  if (peakOrder === 'pos_first' && posSignificant) return 'Hump';

  // Single-sided impulse fallback
  if (negSignificant && !posSignificant) return 'Pothole';
  if (posSignificant && !negSignificant) return 'Hump';

  return 'Smooth';
}
```

---

## 3. Severity and Confidence Scoring

### Severity Calculation
Severity (Low, Medium, High) is calculated based on the total energy and asymmetry of the impact. The composite score multiplies the absolute magnitudes of the peaks by the difference between them.

```javascript
function _calcSeverity(features) {
  const { peakDifference, positivePeak, negativePeak } = features;
  const maxPeak = Math.max(positivePeak, Math.abs(negativePeak));

  // Raw composite score
  const raw = peakDifference * maxPeak * Math.abs(negativePeak);

  // Normalise to 0-100
  const NORM_DIVISOR = 1000;
  const rawScore = Math.min(100, (raw / NORM_DIVISOR) * 100);

  let severity;
  if (rawScore <= CONFIG.SEVERITY_LOW_MAX)        severity = 'Low';
  else if (rawScore <= CONFIG.SEVERITY_MEDIUM_MAX) severity = 'Medium';
  else                                              severity = 'High';

  return { severity, rawScore };
}
```

### Confidence Score
The algorithm assigns a percentage (0-100%) indicating how perfectly the signal matched the expected physical model. It adds bonuses to the severity score if the temporal gap is highly distinct, or if the impact was highly asymmetrical.

```javascript
function _calcConfidence(features, rawScore) {
  const { peakTimeGap, peakDifference } = features;
  let score = rawScore; // base from severity

  // Reward a clear time gap between peaks (pattern sharpness)
  if (peakTimeGap >= 4) score += 15;
  else if (peakTimeGap >= CONFIG.MIN_PEAK_GAP) score += 8;

  // Reward a large differential (clear asymmetry → clear anomaly)
  if (peakDifference >= 10) score += 10;
  else if (peakDifference >= 6)  score += 5;

  return Math.min(100, Math.round(score));
}
```

---

## 4. Advantages of this Approach

1.  **Deterministic & Transparent:** Unlike "black-box" machine learning models, every classification mathematically traces back to the physical sequence of suspension movement.
2.  **Highly Efficient:** Finding peaks in a 15-sample array requires virtually zero CPU overhead, making the backend incredibly fast.
3.  **Orientation Tolerant:** By dynamically calculating the baseline from the leading edge of the window, the algorithm gracefully ignores static tilt or slight mounting misalignments of the MPU6050 sensor on the vehicle.
4.  **Edge-Ready:** Because the math relies entirely on simple loops and arithmetic, this exact code can be ported natively to the ESP8266 (Edge Computing / C++) in the future to save bandwidth.
