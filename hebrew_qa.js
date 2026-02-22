#!/usr/bin/env node
/**
 * Hebrew Transcription QA Framework
 * Maccabi Healthcare - Wonderful AI Platform
 *
 * Fetches today's voice-AI conversations, scores the customer-side Hebrew
 * transcription quality via Claude, detects agent confusion signals, and
 * outputs a tiered dashboard + JSON report.
 *
 * Usage:
 *   MACCABI_API_KEY=<key> node hebrew_qa.js
 *
 * Required env vars:
 *   MACCABI_API_KEY   – Wonderful AI / Maccabi sandbox API key
 *
 * Optional env vars:
 *   ANTHROPIC_API_KEY – Explicit Anthropic API key. When omitted the script
 *                       automatically uses the Claude Code enterprise session
 *                       token from CLAUDE_SESSION_INGRESS_TOKEN_FILE (set by
 *                       the Claude Code runtime — no manual key needed).
 */

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ─── Configuration ────────────────────────────────────────────────────────────

const CONFIG = {
  maccabiBase:   'maccabi.api.sb.wonderful.ai',
  anthropicBase: 'api.anthropic.com',
  claudeModel:   'claude-sonnet-4-20250514',
  pageSize:       100,
  minCustomerTurns: 3,
  delayMs:        300,

  // Score thresholds
  flaggedBelow:  40,
  warnedBelow:   65,   // >= 65 is Clean

  // Wonderful platform base URL for direct conversation links
  wonderfulAppBase: 'https://maccabi.app.sb.wonderful.ai/activities',

  // Hebrew/English confusion phrases the agent uses when it doesn't understand
  confusionPhrases: [
    'לא הבנתי',
    'לא קלטתי',
    'תוכל לחזור',
    'מה אמרת',
    'סליחה',
    'תגיד שוב',
  ],
  confusionThreshold: 2,
};

// ─── Utility helpers ──────────────────────────────────────────────────────────

/** Resolves after `ms` milliseconds. */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** ISO date string for the start of today (local midnight → UTC). */
function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** ISO date string for right now. */
function nowISO() {
  return new Date().toISOString();
}

/** YYYY-MM-DD string for filenames / report date fields. */
function todayDateString() {
  return new Date().toISOString().split('T')[0];
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

/**
 * Generic HTTPS request returning parsed JSON (or raw text on parse error).
 *
 * @param {object} opts          - Options for https.request
 * @param {string|null} body     - Request body (for POST), or null
 * @returns {Promise<{status: number, data: any}>}
 */
function request(opts, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', chunk => (raw += chunk));
      res.on('end', () => {
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw; // return raw string if not valid JSON
        }
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// ─── Maccabi API calls ────────────────────────────────────────────────────────

/**
 * Fetch a page of communications from the Maccabi sandbox.
 *
 * @param {string} apiKey
 * @param {number} page   - 0-based page index
 * @returns {Promise<object>} - Raw API response
 */
async function fetchCommunicationsPage(apiKey, page = 0) {
  const start  = encodeURIComponent(todayStart());
  const end    = encodeURIComponent(nowISO());
  const offset = page * CONFIG.pageSize;

  // Try both common pagination styles (offset and page-based)
  const qs = `?limit=${CONFIG.pageSize}&offset=${offset}`
           + `&created_after=${start}&created_before=${end}`
           + `&sort=created_at:desc`;

  const opts = {
    hostname: CONFIG.maccabiBase,
    path:     `/api/v1/communications${qs}`,
    method:   'GET',
    headers: {
      'x-api-key':    apiKey,
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
  };

  const { status, data } = await request(opts);

  if (status !== 200) {
    throw new Error(`Communications list failed: HTTP ${status} – ${JSON.stringify(data).slice(0, 200)}`);
  }

  return data;
}

/**
 * Extract the conversations array from the API response, handling multiple
 * common envelope shapes.
 */
function extractCommunicationsList(data) {
  if (Array.isArray(data))                   return data;
  if (Array.isArray(data.data))              return data.data;
  if (Array.isArray(data.communications))    return data.communications;
  if (Array.isArray(data.results))           return data.results;
  if (Array.isArray(data.items))             return data.items;
  return [];
}

/**
 * Determine whether there are more pages to fetch.
 */
function hasMorePages(data, fetchedSoFar) {
  // Try common pagination metadata keys
  const total = data.total ?? data.total_count ?? data.count ?? null;
  if (total !== null) return fetchedSoFar < total;

  // Fall back: if the page was full, assume there might be more
  const list = extractCommunicationsList(data);
  return list.length === CONFIG.pageSize;
}

/**
 * Fetch up to CONFIG.pageSize conversations for today, paginating if needed.
 *
 * @param {string} apiKey
 * @returns {Promise<object[]>} array of communication objects
 */
async function fetchTodaysCommunications(apiKey) {
  console.log('📡 Fetching today\'s conversations from Maccabi…');

  let all  = [];
  let page = 0;

  while (all.length < CONFIG.pageSize) {
    const pageData = await fetchCommunicationsPage(apiKey, page);
    const items    = extractCommunicationsList(pageData);

    if (items.length === 0) break;

    all = all.concat(items);
    console.log(`   Page ${page + 1}: +${items.length} conversations (total so far: ${all.length})`);

    if (!hasMorePages(pageData, all.length) || all.length >= CONFIG.pageSize) break;

    page++;
    await sleep(CONFIG.delayMs);
  }

  // Cap at configured max
  return all.slice(0, CONFIG.pageSize);
}

/**
 * Fetch the full transcript for a single communication.
 *
 * @param {string} apiKey
 * @param {string} id - Conversation ID
 * @returns {Promise<object>} - Full communication object
 */
async function fetchCommunicationDetail(apiKey, id) {
  const opts = {
    hostname: CONFIG.maccabiBase,
    path:     `/api/v1/communications/${encodeURIComponent(id)}`,
    method:   'GET',
    headers: {
      'x-api-key':    apiKey,
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
  };

  const { status, data } = await request(opts);

  if (status !== 200) {
    throw new Error(`Detail fetch for ${id} failed: HTTP ${status}`);
  }

  return data;
}

// ─── Transcript parsing ────────────────────────────────────────────────────────

/**
 * Extract the turns array from a communication detail object.
 * Handles common field-name variants.
 */
function extractTurns(detail) {
  const d = detail.data ?? detail; // unwrap envelope if present
  return d.transcript ?? d.messages ?? d.turns ?? d.conversation ?? [];
}

/** Normalise a single turn to { role, text }. */
function normaliseTurn(turn) {
  // Role field variants
  const rawRole = (turn.role ?? turn.speaker ?? turn.type ?? '').toLowerCase();

  // Text field variants
  const text = turn.text ?? turn.content ?? turn.message ?? turn.body ?? '';

  return { rawRole, text: String(text).trim() };
}

/** Returns true if this turn belongs to the customer/user. */
function isCustomerTurn({ rawRole }) {
  return rawRole === 'user' || rawRole === 'customer' || rawRole === 'caller';
}

/** Returns true if this turn belongs to the agent/bot. */
function isAgentTurn({ rawRole }) {
  return rawRole === 'agent' || rawRole === 'assistant' || rawRole === 'bot' || rawRole === 'system';
}

/**
 * Parse a communication detail into separate customer and agent turn arrays.
 *
 * @param {object} detail
 * @returns {{ customerTurns: string[], agentTurns: string[] }}
 */
function parseTurns(detail) {
  const turns        = extractTurns(detail);
  const customerTurns = [];
  const agentTurns    = [];

  for (const raw of turns) {
    const turn = normaliseTurn(raw);
    if (!turn.text) continue;

    if (isCustomerTurn(turn)) {
      customerTurns.push(turn.text);
    } else if (isAgentTurn(turn)) {
      agentTurns.push(turn.text);
    }
  }

  return { customerTurns, agentTurns };
}

// ─── Agent confusion detection ────────────────────────────────────────────────

/**
 * Scan agent turns for confusion phrases.
 *
 * @param {string[]} agentTurns
 * @returns {{ confusionCount: number, confusionFlagged: boolean }}
 */
function detectAgentConfusion(agentTurns) {
  let confusionCount = 0;

  for (const turn of agentTurns) {
    for (const phrase of CONFIG.confusionPhrases) {
      if (turn.includes(phrase)) {
        confusionCount++;
        break; // count at most once per agent turn
      }
    }
  }

  return {
    confusionCount,
    confusionFlagged: confusionCount >= CONFIG.confusionThreshold,
  };
}

// ─── Claude scoring ────────────────────────────────────────────────────────────

/**
 * Strip markdown code fences from a string (```json ... ``` etc.).
 */
function stripCodeFences(str) {
  return str
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/im, '')
    .trim();
}

/**
 * Call Claude to score the Hebrew transcription quality of customer turns.
 *
 * @param {string}   anthropicKey
 * @param {string[]} customerTurns - Array of customer utterance strings
 * @returns {Promise<object>} - Parsed scoring object from Claude
 */
async function scoreHebrewQuality(anthropicKey, customerTurns) {
  const turnsText = customerTurns
    .map((t, i) => `Turn ${i + 1}: ${t}`)
    .join('\n');

  const systemPrompt = `You are a Hebrew language quality analyst specialising in speech-to-text transcription errors.
You will receive the customer-side turns of a voice call transcribed by an automatic speech recognition (ASR) system.
The audio comes from real phone calls with background noise, poor quality, and non-native speakers, so the transcription may contain errors.

Analyse the transcription quality and return ONLY a valid JSON object — no prose, no markdown, no code fences — with exactly these keys:

{
  "quality_score": <integer 0-100, where 100 = perfect Hebrew and 0 = completely unintelligible>,
  "error_types": <array of zero or more values from: ["grammar","spelling","word_substitution","missing_words","nonsense_words","mixed_language","unclear_intent"]>,
  "worst_turn_text": <string — the single most problematic customer utterance, verbatim>,
  "cleaned_version": <string — your best reconstruction in correct Hebrew of what the customer most likely said in that worst turn>,
  "agent_confusion_likely": <boolean — true if the transcription errors are severe enough that a voice agent would struggle to understand>,
  "summary": <string — one sentence in English describing the overall transcription quality>
}`;

  const userMessage = `Here are the customer-side turns from this conversation:\n\n${turnsText}`;

  const payload = JSON.stringify({
    model: CONFIG.claudeModel,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userMessage },
    ],
  });

  const opts = {
    hostname: CONFIG.anthropicBase,
    path:     '/v1/messages',
    method:   'POST',
    headers: {
      'x-api-key':         anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Type':      'application/json',
      'Content-Length':    Buffer.byteLength(payload),
    },
  };

  const { status, data } = await request(opts, payload);

  if (status !== 200) {
    throw new Error(`Claude API error: HTTP ${status} – ${JSON.stringify(data).slice(0, 300)}`);
  }

  // Extract the text content from the Anthropic messages response
  const rawText = data?.content?.[0]?.text ?? '';

  if (!rawText) {
    throw new Error('Claude returned an empty response');
  }

  const cleaned = stripCodeFences(rawText);

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Failed to parse Claude JSON response: ${e.message}\nRaw: ${rawText.slice(0, 500)}`);
  }

  // Validate and normalise the scoring object
  return {
    quality_score:         Number(parsed.quality_score ?? 0),
    error_types:           Array.isArray(parsed.error_types) ? parsed.error_types : [],
    worst_turn_text:       parsed.worst_turn_text ?? '',
    cleaned_version:       parsed.cleaned_version ?? '',
    agent_confusion_likely: Boolean(parsed.agent_confusion_likely ?? false),
    summary:               parsed.summary ?? '',
  };
}

// ─── Tier classification ──────────────────────────────────────────────────────

function scoreTier(score) {
  if (score < CONFIG.flaggedBelow) return 'flagged';
  if (score < CONFIG.warnedBelow)  return 'warned';
  return 'clean';
}

function tierEmoji(tier) {
  return { flagged: '🔴', warned: '🟡', clean: '🟢' }[tier] ?? '⚪';
}

// ─── Direct link builder ──────────────────────────────────────────────────────

function conversationLink(id) {
  return `${CONFIG.wonderfulAppBase}/${id}`;
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

async function main() {
  // Validate required environment variables up-front
  const maccabiKey = process.env.MACCABI_API_KEY;

  if (!maccabiKey) {
    console.error('ERROR: MACCABI_API_KEY environment variable is not set.');
    process.exit(1);
  }

  // Resolve Anthropic auth: explicit key → enterprise session token → error
  let anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    const tokenFile = process.env.CLAUDE_SESSION_INGRESS_TOKEN_FILE;
    if (tokenFile) {
      try {
        anthropicKey = fs.readFileSync(tokenFile, 'utf8').trim();
        console.log('Using Claude Code enterprise session token for Anthropic auth.');
      } catch (e) {
        console.error(`ERROR: Could not read session token from ${tokenFile}: ${e.message}`);
        process.exit(1);
      }
    } else {
      console.error(
        'ERROR: No Anthropic auth found.\n' +
        '  Set ANTHROPIC_API_KEY, or run inside Claude Code (enterprise session token auto-detected).'
      );
      process.exit(1);
    }
  }

  const reportDate = todayDateString();
  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(` Hebrew Transcription QA — ${reportDate}`);
  console.log(`══════════════════════════════════════════════════════\n`);

  // ── Step 1: Fetch today's conversations ───────────────────────────────────
  let communications;
  try {
    communications = await fetchTodaysCommunications(maccabiKey);
  } catch (err) {
    console.error(`FATAL: Could not fetch communications list: ${err.message}`);
    process.exit(1);
  }

  console.log(`\nFound ${communications.length} conversation(s) today.\n`);

  if (communications.length === 0) {
    console.log('No conversations to analyse. Exiting.');
    process.exit(0);
  }

  // ── Steps 2–4: Process each conversation ─────────────────────────────────
  const results = [];
  let processed = 0;
  let skipped   = 0;
  let errors    = 0;

  for (const comm of communications) {
    const id = comm.id ?? comm._id ?? comm.communication_id ?? String(processed);

    process.stdout.write(`Processing [${processed + 1}/${communications.length}] ID: ${id} … `);

    try {
      // Step 2 – Fetch full transcript
      const detail = await fetchCommunicationDetail(maccabiKey, id);
      const { customerTurns, agentTurns } = parseTurns(detail);

      if (customerTurns.length < CONFIG.minCustomerTurns) {
        process.stdout.write(`skipped (only ${customerTurns.length} customer turn(s))\n`);
        skipped++;
        await sleep(CONFIG.delayMs);
        continue;
      }

      // Step 3 – Score Hebrew quality
      const scoring = await scoreHebrewQuality(anthropicKey, customerTurns);

      // Step 4 – Detect agent confusion
      const confusion = detectAgentConfusion(agentTurns);

      const tier = scoreTier(scoring.quality_score);

      process.stdout.write(`${tierEmoji(tier)} score=${scoring.quality_score} tier=${tier}\n`);

      results.push({
        id,
        score:              scoring.quality_score,
        tier,
        error_types:        scoring.error_types,
        worst_turn:         scoring.worst_turn_text,
        cleaned_version:    scoring.cleaned_version,
        agent_confusion_from_transcript: scoring.agent_confusion_likely,
        confusion_count:    confusion.confusionCount,
        agent_confusion:    confusion.confusionFlagged,
        summary:            scoring.summary,
        link:               conversationLink(id),
        created_at:         comm.created_at ?? comm.createdAt ?? null,
      });
    } catch (err) {
      process.stdout.write(`ERROR – ${err.message.slice(0, 120)}\n`);
      errors++;
    }

    processed++;
    await sleep(CONFIG.delayMs);
  }

  // ── Step 5: Build report and dashboard ───────────────────────────────────

  const flagged = results.filter(r => r.tier === 'flagged');
  const warned  = results.filter(r => r.tier === 'warned');
  const clean   = results.filter(r => r.tier === 'clean');

  const avgScore = results.length > 0
    ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length)
    : 0;

  const agentConfusionCount = results.filter(r => r.agent_confusion).length;

  // Console dashboard
  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(` QA Dashboard — ${reportDate}`);
  console.log(`══════════════════════════════════════════════════════`);
  console.log(`  Total analysed : ${results.length}  (skipped: ${skipped}, errors: ${errors})`);
  console.log(`  Average score  : ${avgScore}/100`);
  console.log(`  Agent confusion: ${agentConfusionCount} conversation(s) flagged`);
  console.log(`\n  🔴 Flagged  (< ${CONFIG.flaggedBelow}): ${flagged.length}`);
  console.log(`  🟡 Warned   (${CONFIG.flaggedBelow}–${CONFIG.warnedBelow - 1}): ${warned.length}`);
  console.log(`  🟢 Clean    (${CONFIG.warnedBelow}+): ${clean.length}`);

  if (flagged.length > 0) {
    console.log(`\n── 🔴 Flagged Conversations ──────────────────────────`);
    for (const r of flagged) {
      console.log(`\n  ID      : ${r.id}`);
      console.log(`  Score   : ${r.score}/100`);
      console.log(`  Errors  : ${r.error_types.join(', ') || 'none detected'}`);
      console.log(`  Summary : ${r.summary}`);
      console.log(`  Worst   : "${r.worst_turn}"`);
      console.log(`  Cleaned : "${r.cleaned_version}"`);
      console.log(`  Confusion signals: ${r.confusion_count} (${r.agent_confusion ? 'FLAGGED' : 'ok'})`);
      console.log(`  Link    : ${r.link}`);
    }
  }

  if (warned.length > 0) {
    console.log(`\n── 🟡 Warned Conversations ───────────────────────────`);
    for (const r of warned) {
      console.log(`\n  ID      : ${r.id}`);
      console.log(`  Score   : ${r.score}/100`);
      console.log(`  Summary : ${r.summary}`);
      console.log(`  Link    : ${r.link}`);
    }
  }

  console.log(`\n══════════════════════════════════════════════════════\n`);

  // JSON report
  const report = {
    report_date: reportDate,
    generated_at: nowISO(),
    summary: {
      total_conversations_today:  communications.length,
      total_analysed:             results.length,
      total_skipped_short:        skipped,
      total_errors:               errors,
      average_quality_score:      avgScore,
      flagged_count:              flagged.length,
      warned_count:               warned.length,
      clean_count:                clean.length,
      agent_confusion_count:      agentConfusionCount,
    },
    flagged_conversations: flagged.map(r => ({
      id:                r.id,
      score:             r.score,
      error_types:       r.error_types,
      worst_turn:        r.worst_turn,
      cleaned_version:   r.cleaned_version,
      agent_confusion:   r.agent_confusion,
      confusion_count:   r.confusion_count,
      summary:           r.summary,
      created_at:        r.created_at,
      link:              r.link,
    })),
    warned_conversations: warned.map(r => ({
      id:                r.id,
      score:             r.score,
      error_types:       r.error_types,
      summary:           r.summary,
      agent_confusion:   r.agent_confusion,
      created_at:        r.created_at,
      link:              r.link,
    })),
    clean_conversations: clean.map(r => ({
      id:          r.id,
      score:       r.score,
      created_at:  r.created_at,
      link:        r.link,
    })),
  };

  const outputPath = path.join(process.cwd(), `hebrew_qa_${reportDate}.json`);
  try {
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`JSON report saved to: ${outputPath}\n`);
  } catch (err) {
    console.error(`WARNING: Could not write JSON report: ${err.message}`);
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

main().catch(err => {
  console.error(`\nUnhandled error: ${err.message}`);
  process.exit(1);
});
