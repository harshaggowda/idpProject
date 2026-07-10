/**
 * aiService.js
 * ─────────────────────────────────────────────────────────────────
 * Gemini integration for the AI Civic Report Generator.
 *
 *   Summary JSON  →  Prompt Builder  →  Gemini 2.5 Flash  →  Markdown
 *
 * Design rules enforced here:
 *   • The model receives ONLY the aggregated analytics summary —
 *     never raw sensor windows or database documents.
 *   • The API key is read from the environment (GEMINI_API_KEY).
 *     It is NEVER hardcoded.
 *   • Every failure mode degrades gracefully: the caller always gets
 *     a structured result and the app never crashes.
 *
 * The Gemini REST endpoint is called with Node's native `fetch`
 * (Node 18+), so no extra SDK dependency is required.
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Hard timeout so a hanging upstream never blocks the request.
const REQUEST_TIMEOUT_MS = 30000;

// Retry policy for transient upstream failures (overload / rate limit).
const MAX_ATTEMPTS = 4;                 // 1 initial + 3 retries
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const BASE_BACKOFF_MS = 1200;           // 1.2s, 2.4s, 4.8s … exponential

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * System persona + hard rules for the model.
 * Kept separate from the data so the contract is explicit.
 */
const SYSTEM_INSTRUCTION = [
  'You are a Professional Municipal Road Infrastructure Analyst working for an',
  'AI Road Analytics Platform. You produce formal road condition reports for',
  'municipal engineers, road authorities, smart-city administrators and public',
  'works departments.',
  '',
  'STRICT RULES:',
  '1. Use ONLY the statistics provided in the supplied analytics JSON.',
  '2. Never invent, estimate, or extrapolate numbers that are not present.',
  '3. If the data is insufficient (e.g. zero events), state this clearly and',
  '   do not fabricate findings.',
  '4. Maintain a professional, formal engineering tone at all times.',
  '5. No emojis. No conversational language. No first-person chit-chat.',
  '6. Output GitHub-flavoured Markdown only — no preamble, no code fences',
  '   around the whole document.',
  '7. Each hotspot includes an `address` field with a real street/area',
  '   name. ALWAYS refer to locations by this address (e.g. "Hosur Road,',
  '   BTM Layout"). Only if `address` is null/missing, fall back to',
  '   "Location (lat, lng)". You may append the coordinates in parentheses',
  '   after the address for precision, but lead with the address.',
].join('\n');

/**
 * Build the full text prompt from the analytics summary.
 *
 * @param {object} summary analytics summary from reportGenerator
 * @returns {string}
 */
function buildPrompt(summary) {
  const sections = [
    '1. Executive Summary',
    '2. Road Health Overview',
    '3. Detection Statistics',
    '4. Most Critical Roads',
    '5. High Severity Areas',
    '6. Traffic Safety Analysis',
    '7. Maintenance Priority Ranking',
    '8. Municipal Recommendations',
    '9. Predicted Impact',
    '10. Suggested Immediate Actions',
    '11. Conclusion',
  ].join('\n');

  return [
    SYSTEM_INSTRUCTION,
    '',
    '────────────────────────────────────────',
    `Reporting window: ${summary.timeRange}`,
    `Report generated at: ${summary.generatedAt}`,
    '',
    'ANALYTICS DATA (the ONLY source of truth — do not use anything else):',
    '```json',
    JSON.stringify(summary, null, 2),
    '```',
    '',
    'Produce a complete municipal road infrastructure report in Markdown with',
    'the following numbered sections, each as a Markdown heading:',
    '',
    sections,
    '',
    'Begin the document with a top-level title (e.g. "# Municipal Road',
    'Infrastructure Condition Report") followed by the reporting window and',
    'generation timestamp. If `hasSufficientData` is false, clearly state that',
    'insufficient data was collected during this window and keep the report brief.',
  ].join('\n');
}

/**
 * Call Gemini and return a Markdown report.
 *
 * Always resolves (never throws) with a structured result:
 *   { ok: true,  markdown }            on success
 *   { ok: false, error,  markdown:null } on any failure
 *
 * @param {object} summary analytics summary from reportGenerator
 * @returns {Promise<{ok:boolean, markdown:(string|null), error?:string}>}
 */
async function generateReport(summary) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      markdown: null,
      error: 'GEMINI_API_KEY is not configured on the server.',
    };
  }

  const prompt = buildPrompt(summary);

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,        // low → factual, deterministic tone
      topP: 0.9,
      maxOutputTokens: 4096,
    },
  };

  let lastError = 'Unknown error contacting Gemini.';

  // Retry transient failures (overload / rate-limit / gateway) with
  // exponential backoff. Non-retryable errors return immediately.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await _callGeminiOnce(body, apiKey);

    if (result.ok) return result;

    lastError = result.error;

    if (!result.retryable || attempt === MAX_ATTEMPTS) {
      return { ok: false, markdown: null, error: lastError };
    }

    const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1);
    console.warn(
      `[aiService] Gemini attempt ${attempt}/${MAX_ATTEMPTS} failed ` +
      `(${lastError.slice(0, 80)}). Retrying in ${backoff}ms…`
    );
    await sleep(backoff);
  }

  return { ok: false, markdown: null, error: lastError };
}

/**
 * Perform a single Gemini request.
 * @returns {Promise<{ok:boolean, markdown?:string, error?:string, retryable?:boolean}>}
 */
async function _callGeminiOnce(body, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return {
        ok: false,
        retryable: RETRYABLE_STATUS.has(response.status),
        error: `Gemini API returned ${response.status}: ${detail.slice(0, 200)}`,
      };
    }

    const data = await response.json();

    // Defensive extraction — the response shape can vary on edge cases.
    const markdown = data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || '')
      .join('')
      .trim();

    if (!markdown) {
      const blockReason = data?.promptFeedback?.blockReason;
      return {
        ok: false,
        retryable: false, // a block / empty body won't change on retry
        error: blockReason
          ? `Gemini returned no content (blocked: ${blockReason}).`
          : 'Gemini returned an empty response.',
      };
    }

    return { ok: true, markdown };
  } catch (err) {
    // Network errors and timeouts are worth retrying.
    const reason = err.name === 'AbortError'
      ? 'Gemini request timed out.'
      : err.message || 'Unknown error contacting Gemini.';
    return { ok: false, retryable: true, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  generateReport,
  buildPrompt,       // exported for testing
  GEMINI_MODEL,
};
