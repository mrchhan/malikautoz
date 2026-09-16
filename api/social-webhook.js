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
// Meta sent, needed for signature verification. The config MUST be attached
// to the same function object assigned to module.exports, and AFTER that
// assignment -- attaching it to module.exports first and then reassigning
// module.exports to the handler function discards it silently.

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
    console.error('Webhook POST arrived with an empty body. Raw length:', rawBodyBuffer.length);
    return res.status(200).send('EVENT_RECEIVED');
  }

  const signatureHeader = req.headers['x-hub-signature-256'] || '';
  if (!verifySignature(rawBody, signatureHeader)) {
    console.error('Webhook signature mismatch -- rejecting. Body length was:', rawBody.length);
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
    if (messages.length === 0) {
      // DIAGNOSTIC: when extraction finds nothing, log the actual shape of
      // what arrived so we can see exactly why -- a wrong field name, an
      // unexpected event type, whatever it turns out to be. This is the
      // single most useful line for figuring out a real-world payload
      // mismatch instead of guessing at Meta's documentation.
      console.log('DIAGNOSTIC -- full payload when 0 messages extracted:', JSON.stringify(body).slice(0, 3000));
    }
    for (const msg of messages) {
      await storeMessage(msg);
    }
  } catch (e) {
    console.error('Error processing webhook event:', e && e.stack ? e.stack : e);
  }

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
//
// Also handles the newer Instagram Graph API "changes" shape as a fallback,
// in case that's what's actually arriving (some IG webhook configurations
// deliver messages under entry[].changes[] with field:"messages" instead
// of entry[].messaging[] -- the diagnostic log above will confirm which).
function extractMessages(body) {
  const platform = body.object === 'instagram' ? 'instagram' : (body.object === 'page' ? 'facebook' : null);
  if (!platform || !Array.isArray(body.entry)) return [];

  const out = [];
  for (const entry of body.entry) {
    const events = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const evt of events) {
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

    // Fallback shape: entry[].changes[] with field "messages" (seen on some
    // Instagram webhook configurations instead of the messaging[] shape).
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      if (change.field !== 'messages' || !change.value) continue;
      const v = change.value;
      if (!v.message || v.message.is_echo || !v.message.text) continue;
      out.push({
        id: v.message.mid || `${v.sender && v.sender.id}-${v.timestamp || Date.now()}`,
        platform,
        senderId: v.sender && v.sender.id,
        recipientId: v.recipient && v.recipient.id,
        text: v.message.text,
        timestamp: v.timestamp || Date.now(),
        receivedAt: Date.now()
      });
    }
  }
  return out;
}

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
  const dedupeKey = `social:seen:${msg.id}`;
  const seen = await redisCommand(['SET', dedupeKey, '1', 'NX', 'EX', '86400']);
  if (seen && seen.result === null) return;

  await redisCommand(['LPUSH', MESSAGES_KEY, JSON.stringify(msg)]);
  await redisCommand(['LTRIM', MESSAGES_KEY, '0', String(MAX_STORED_MESSAGES - 1)]);
}
