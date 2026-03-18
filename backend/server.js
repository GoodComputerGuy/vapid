const express = require('express');
const webpush = require('web-push');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const envPath = path.join(__dirname, '.env');
dotenv.config({ path: envPath });

const app = express();
app.use(express.json());
app.use(cors());

const SUBS_FILE = path.join(__dirname, 'subscriptions.json');

function loadSubscriptions() {
  try {
    if (fs.existsSync(SUBS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
      // Default onCall:true for any subscriptions saved before this field existed
      if (Array.isArray(data)) return data.map(s => ({ onCall: true, ...s }));
    }
  } catch (e) {
    console.warn('[vapid] Could not load subscriptions.json:', e.message);
  }
  return [];
}

function saveSubscriptions() {
  try {
    fs.writeFileSync(SUBS_FILE, JSON.stringify(subscriptions, null, 2));
  } catch (e) {
    console.warn('[vapid] Could not save subscriptions.json:', e.message);
  }
}

const subscriptions = loadSubscriptions();
console.log(`[vapid] Loaded ${subscriptions.length} persisted subscription(s)`);

function ensureVapidKeys() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.log('[vapid] No keys found — generating new VAPID key pair...');
    const keys = webpush.generateVAPIDKeys();

    try {
      let existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      existing = existing
        .split('\n')
        .filter(l => !l.startsWith('VAPID_PUBLIC_KEY=') && !l.startsWith('VAPID_PRIVATE_KEY='))
        .join('\n')
        .trimEnd();
      const addition = `\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`;
      fs.writeFileSync(envPath, existing + addition);
      console.log('[vapid] Keys written to .env');
    } catch (e) {
      console.warn('[vapid] Could not write .env:', e.message);
    }

    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  }

  const contact = process.env.VAPID_CONTACT || 'mailto:vapid@example.com';
  webpush.setVapidDetails(contact, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  console.log('[vapid] Configured. Public key:', process.env.VAPID_PUBLIC_KEY);
  console.log('[vapid] Public URL:', process.env.PUBLIC_URL || '(not set)');
}

ensureVapidKeys();

// ── Routes ──────────────────────────────────────────────────────────────────

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

app.post('/api/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint) return res.status(400).json({ error: 'Invalid subscription' });

  const exists = subscriptions.some(s => s.endpoint === sub.endpoint);
  if (!exists) {
    subscriptions.push({ ...sub, onCall: true });
    saveSubscriptions();
    console.log(`[vapid] New subscription. Total: ${subscriptions.length}`);
  }

  res.status(201).json({ success: true });
});

app.post('/api/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });

  const idx = subscriptions.findIndex(s => s.endpoint === endpoint);
  if (idx !== -1) {
    subscriptions.splice(idx, 1);
    saveSubscriptions();
    console.log(`[vapid] Unsubscribed. Total: ${subscriptions.length}`);
  }

  res.json({ success: true });
});

app.post('/api/oncall', (req, res) => {
  const { endpoint, active } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });

  const sub = subscriptions.find(s => s.endpoint === endpoint);
  if (!sub) return res.status(404).json({ error: 'Subscription not found' });

  sub.onCall = !!active;
  saveSubscriptions();

  const onCallCount = subscriptions.filter(s => s.onCall).length;
  console.log(`[vapid] ${sub.onCall ? 'On' : 'Off'} call. On-call count: ${onCallCount}`);

  res.json({ success: true, onCall: sub.onCall });
});

app.post('/api/oncall-status', (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });

  const sub = subscriptions.find(s => s.endpoint === endpoint);
  if (!sub) return res.status(404).json({ error: 'Not found' });

  res.json({ onCall: sub.onCall });
});

app.post('/api/test-notify', async (req, res) => {
  const targets = subscriptions.filter(s => s.onCall);

  if (targets.length === 0) {
    return res.status(400).json({ error: 'No one is on call.' });
  }

  const time = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const payload = JSON.stringify({
    title: 'VAPID Test ✓',
    body: req.body.message?.trim() || `Test notification from VAPID — ${time} ET`,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    timestamp: Date.now(),
  });

  const results = await Promise.allSettled(
    targets.map(sub => webpush.sendNotification(sub, payload))
  );

  // Prune dead endpoints (410 Gone) — map back from targets index to subscriptions
  let pruned = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    if (results[i].status === 'rejected' && results[i].reason?.statusCode === 410) {
      const globalIdx = subscriptions.indexOf(targets[i]);
      if (globalIdx !== -1) subscriptions.splice(globalIdx, 1);
      pruned++;
    }
  }
  if (pruned) {
    saveSubscriptions();
    console.log(`[vapid] Pruned ${pruned} expired subscription(s)`);
  }

  const failed = results.filter(r => r.status === 'rejected').length;
  const sent = results.length - failed;
  console.log(`[vapid] Sent: ${sent}, Failed: ${failed}`);

  res.json({ sent, failed, total: subscriptions.length, onCall: subscriptions.filter(s => s.onCall).length });
});

app.get('/api/status', (req, res) => {
  res.json({
    subscribers: subscriptions.length,
    onCall: subscriptions.filter(s => s.onCall).length,
    publicKey: process.env.VAPID_PUBLIC_KEY,
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`[vapid] Backend listening on :${PORT}`));
