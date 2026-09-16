// ============================================================================
// Social media order intake — inbox reader
// ============================================================================
// The Social Inbox screen in index.html calls this to pull whatever
// messages api/social-webhook.js has stored since the last check. Same
// shared-secret pattern as api/ai.js -- this stops random internet traffic
// from reading your customers' DMs, while your own app keeps working.

const ACCESS_SECRET = process.env.AI_PROXY_SECRET || '';
const KV_URL = process.env.KV_REST_API_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';
const MESSAGES_KEY = 'social:messages';

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Redis is not configured');
  const resp = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!resp.ok) throw new Error(`Redis command failed: ${resp.status}`);
  return resp.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    res.status(405).json({ error: true, message: 'Method not allowed' });
    return;
  }

  if (ACCESS_SECRET) {
    const provided = req.headers['x-app-key'] || '';
    if (!timingSafeEqual(provided, ACCESS_SECRET)) {
      res.status(401).json({ error: true, message: 'Unauthorized' });
      return;
    }
  }

  try {
    if (req.method === 'DELETE') {
      // Used once a message has been turned into a sale (or dismissed) in
      // the app, so it doesn't keep showing up as a new order every time
      // the inbox refreshes.
      const id = (req.query && req.query.id) || '';
      if (!id) { res.status(400).json({ error: true, message: 'Missing id' }); return; }
      await removeMessage(id);
      res.status(200).json({ ok: true });
      return;
    }

    const result = await redisCommand(['LRANGE', MESSAGES_KEY, '0', '-1']);
    const messages = (result.result || [])
      .map(raw => { try { return JSON.parse(raw); } catch (e) { return null; } })
      .filter(Boolean)
      .sort((a, b) => b.timestamp - a.timestamp);
    res.status(200).json({ messages });
  } catch (e) {
    console.error('social-messages error:', e && e.stack ? e.stack : e);
    res.status(500).json({ error: true, message: 'Could not load messages. Please try again.' });
  }
};

async function removeMessage(id) {
  const result = await redisCommand(['LRANGE', MESSAGES_KEY, '0', '-1']);
  const raw = result.result || [];
  const match = raw.find(r => { try { return JSON.parse(r).id === id; } catch (e) { return false; } });
  if (match) await redisCommand(['LREM', MESSAGES_KEY, '0', match]);
}
