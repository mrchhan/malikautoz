// ============================================================================
// Social media order intake — webhook receiver
// ============================================================================
// Meta calls this endpoint two ways:
//   GET  - the one-time verification handshake when you paste this URL into
//          the Meta dashboard (see SETUP.md). Must echo back hub.challenge.
//   POST - every actual incoming Messenger/Instagram DM, forever after.
//
// There's no traditional database behind this app (everything else lives in
// each browser's localStorage), so incoming messages are held in a small
// Redis store (Upstash, connected via Vercel Storage) until the shop opens
// the Social Inbox screen and fetches them through api/social-messages.js.
// This file only ever WRITES to that store; it never reads it back out.
//
// IMPORTANT: bodyParser is disabled below so we can read the exact raw bytes
// Meta sent. Meta signs the POST body with the App Secret, and that
// signature only matches against the byte-for-byte original -- Vercel's
// default automatic JSON parsing consumes the stream before we ever see it,
// which silently produces an empty body here otherwise. The config MUST be
// attached to the same function object assigned to module.exports, and
// AFTER that assignment -- attaching it to module.exports first and then
// reassigning module.exports to the handler function (the bug this file
// originally shipped with) discards it silently. Order matters here.

const crypto = require('crypto');

const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || '';
const APP_SECRET = process.env.META_APP_SECRET || '';
const KV_URL = process.env.KV_REST_API_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';
const MESSAGES_KEY = 'social:messages';
const MAX_STORED_MESSAGES = 500; // keep the store bounded -- this is a working inbox, not an archive

async function handler(req, res) {
  if (req.method === 'GET') {
    return handleVerification(req, res);
  }
  if (req.method === 'POST') {
    return handleIncomingEvent(req, res);
  }
  res.status(405).send('Method not allowed');
}

// Assign to module.exports FIRST, then attach .config to that same object --
// see the note above. This is the fix.
module.exports = handler;
module.exports.config = {
  api: { bodyParser: false }
};

// ---- Step 1 of Meta's setup: prove this URL is really ours ----
function handleVerification(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && VERIFY_TOKEN && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Verification failed');
  }
}

// Reads the raw request body as a Buffer, byte for byte, before anything
// else touches it. With bodyParser disabled (see config above), req is a
// plain Node readable stream -- this is the standard way to collect one.
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---- Every real message event lands here, forever after ----
async function handleIncomingEvent(req, res) {
  const rawBodyBuffer = await readRawBody(req);
  const rawBody = rawBodyBuffer.toString('utf8');

  if (!rawBody) {
    // Loud on purpose -- an empty body here almost always means bodyParser
    // config isn't actually being applied (see the note at the top of this
    // file), not a normal/expected condition worth staying quiet about.
    console.error('Webhook POST arrived with an empty body -- bodyParser config may not be applied. Raw body length:', rawBodyBuffer.length);
    return res.status(200).send('EVENT_RECEIVED');
  }

  const signatureHeader = req.headers['x-hub-signature-256'] || '';
  if (!verifySignature(rawBody, signatureHeader)) {
    console.error('Webhook signature mismatch -- rejecting. Body length was:', rawBody.length);
    // Still 200 here: Meta retries aggressively on non-200 responses, and a
    // forged request doesn't deserve that many attempts acknowledged either
    // way. Silently drop it (from Meta's perspective -- our own logs still
    // record it, per the line above).
    return res.status(200).send('EVENT_RECEIVED');
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (e) {
    console.error('Webhook body failed to parse as JSON:', e.message, '-- first 200 chars:', rawBody.slice(0, 200));
    return res.status(200).send('EVENT_RECEIVED');
  }

  try {
    const messages = extractMessages(body);
    console.log(`Webhook processed: ${messages.length} message(s) extracted from object="${body.object}"`);
    for (const msg of messages) {
      await storeMessage(msg);
    }
  } catch (e) {
    // Never let a parsing hiccup on one message cause Meta to retry the
    // whole batch -- log it and move on.
    console.error('Error processing webhook event:', e && e.stack ? e.stack : e);
  }

  // Meta expects a fast 200 -- it does not care what's in the body.
  res.status(200).send('EVENT_RECEIVED');
}

function verifySignature(rawBody, signatureHeader) {
  if (!APP_SECRET || !signatureHeader.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', APP_SECRET).update(rawBody, 'utf8').digest('hex');
  const provided = signatureHeader.slice('sha256='.length);
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

// Pulls out the handful of fields the Social Inbox actually needs from
// Meta's (fairly verbose) webhook payload shape. Messenger and Instagram
// use the same "messaging" array shape when both go through a linked Page,
// so one function covers both -- just tagged by the top-level "object".
function extractMessages(body) {
  const platform = body.object === 'instagram' ? 'instagram' : (body.object === 'page' ? 'facebook' : null);
  if (!platform || !Array.isArray(body.entry)) return [];

  const out = [];
  for (const entry of body.entry) {
    const events = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const evt of events) {
      // Skip delivery receipts / read receipts / echoes of our own replies --
      // only real inbound text messages become inbox entries.
      if (!evt.message || evt.message.is_echo || !evt.message.text) continue;
      out.push({
        id: evt.message.mid || `${evt.sender && evt.sender.id}-${evt.timestamp}`,
        platform,
        senderId: evt.sender && evt.sender.id,
        recipientId: evt.recipient && evt.recipient.id,
        text: evt.message.text,
        timestamp: evt.timestamp || Date.now(),
        receivedAt: Date.now()
      });
    }
  }
  return out;
}

// ---- Minimal Upstash REST client (no npm package -- same approach as the
// rest of this backend: plain fetch, nothing to install or build) ----
async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Redis is not configured (KV_REST_API_URL/TOKEN missing)');
  const resp = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Redis command failed: ${resp.status} ${text.slice(0, 200)}`);
  }
  return resp.json();
}

async function storeMessage(msg) {
  // De-dupe: Meta sometimes redelivers the same event on retry. Using the
  // message id as part of a dedupe set keeps a flaky network from creating
  // duplicate inbox entries.
  const dedupeKey = `social:seen:${msg.id}`;
  const seen = await redisCommand(['SET', dedupeKey, '1', 'NX', 'EX', '86400']);
  if (seen && seen.result === null) return; // already stored this one

  await redisCommand(['LPUSH', MESSAGES_KEY, JSON.stringify(msg)]);
  await redisCommand(['LTRIM', MESSAGES_KEY, '0', String(MAX_STORED_MESSAGES - 1)]);
}
