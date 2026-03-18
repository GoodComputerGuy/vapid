import { useState, useEffect } from 'react';

const supported =
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  ('standalone' in navigator && navigator.standalone === true);
const needsHomeScreen = isIOS && !isStandalone;

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

export default function App() {
  const [status, setStatus] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  const [onCall, setOnCall] = useState(null); // null = unknown
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [counts, setCounts] = useState(null); // { subscribers, onCall }

  async function refreshCounts() {
    try {
      const r = await fetch('/api/status');
      const d = await r.json();
      setCounts({ subscribers: d.subscribers, onCall: d.onCall });
    } catch {}
  }

  // On mount: check existing SW subscription and its on-call status
  useEffect(() => {
    refreshCounts();
    if (!supported) return;
    navigator.serviceWorker.ready.then(reg =>
      reg.pushManager.getSubscription().then(async sub => {
        if (!sub) return;
        setSubscribed(true);
        try {
          const r = await fetch('/api/oncall-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          if (r.ok) {
            const d = await r.json();
            setOnCall(d.onCall);
          }
        } catch {}
      })
    );
  }, []);

  async function subscribe() {
    if (!supported) {
      setStatus('Push notifications are not supported in this browser.');
      return;
    }
    try {
      setStatus('Requesting notification permission…');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(`Permission ${permission}. Grant notifications in browser settings and try again.`);
        return;
      }

      setStatus('Registering service worker…');
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      setStatus('Fetching VAPID public key…');
      const res = await fetch('/api/vapid-public-key');
      if (!res.ok) throw new Error(`Backend error: ${res.status}`);
      const { publicKey } = await res.json();

      setStatus('Subscribing to push…');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      setStatus('Sending subscription to backend…');
      const postRes = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub),
      });
      if (!postRes.ok) throw new Error(`Subscribe failed: ${postRes.status}`);

      setSubscribed(true);
      setOnCall(true); // new subscriptions default to on-call
      await refreshCounts();
      setStatus('Subscribed and on call.');
    } catch (err) {
      console.error(err);
      setStatus(`Error: ${err.message}`);
    }
  }

  async function unsubscribe() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setOnCall(null);
      await refreshCounts();
      setStatus('Unsubscribed.');
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  }

  async function toggleOnCall() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;

      const res = await fetch('/api/oncall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint, active: !onCall }),
      });
      const data = await res.json();
      if (res.ok) {
        setOnCall(data.onCall);
        await refreshCounts();
        setStatus(data.onCall ? 'You are now on call.' : 'You are now off call.');
      }
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  }

  async function sendTest() {
    setSending(true);
    setStatus('Sending push notification…');
    try {
      const res = await fetch('/api/test-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(`Error: ${data.error}`);
      } else {
        setStatus(`Sent to ${data.sent} on-call subscriber(s)${data.failed ? ` (${data.failed} failed)` : ''}.`);
        await refreshCounts();
      }
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
    setSending(false);
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.h1}>VAPID Push Test</h1>
        <p style={styles.sub}>
          End-to-end web push validator
          {counts !== null && (
            <span style={styles.badge}>
              {counts.onCall}/{counts.subscribers} on call
            </span>
          )}
        </p>

        {needsHomeScreen && (
          <div style={styles.warn}>
            <strong>iOS requires Home Screen install.</strong><br />
            Safari → Share → Add to Home Screen → reopen from home screen.
          </div>
        )}
        {!supported && !needsHomeScreen && (
          <div style={styles.warn}>
            Push notifications not supported in this browser.
          </div>
        )}

        <div style={styles.btnGroup}>
          <button onClick={subscribe} disabled={needsHomeScreen} style={btn(needsHomeScreen ? '#9ca3af' : '#2563eb')}>
            {subscribed ? '✓ Re-subscribe' : 'Subscribe to Notifications'}
          </button>

          {subscribed && onCall !== null && (
            <button onClick={toggleOnCall} style={onCallBtn(onCall)}>
              {onCall ? '🟢 On Call — tap to go off call' : '⚫ Off Call — tap to go on call'}
            </button>
          )}

          {subscribed && (
            <button onClick={unsubscribe} style={btn('#dc2626')}>
              Unsubscribe
            </button>
          )}

          <input
            type="text"
            placeholder="Message (optional — leave blank for default)"
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !sending && sendTest()}
            style={styles.input}
          />
          <button onClick={sendTest} disabled={sending} style={btn(!sending ? '#16a34a' : '#9ca3af')}>
            {sending ? 'Sending…' : 'Send Notification'}
          </button>
        </div>

        {status && <div style={styles.status}>{status}</div>}

        <div style={styles.hint}>
          <strong>Desktop / Android Chrome:</strong> Click Subscribe, allow, then Send.<br />
          <strong>iOS (Safari 16.4+):</strong> Share → Add to Home Screen → reopen → Subscribe.<br />
          <strong>Cross-device:</strong> Subscribe on phone, trigger Send from desktop.
        </div>
      </div>
    </div>
  );
}

function btn(bg) {
  return {
    padding: '14px 20px',
    fontSize: 16,
    fontWeight: 600,
    background: bg,
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    cursor: bg === '#9ca3af' ? 'not-allowed' : 'pointer',
    transition: 'opacity .15s',
    width: '100%',
  };
}

function onCallBtn(active) {
  return {
    padding: '14px 20px',
    fontSize: 16,
    fontWeight: 600,
    background: active ? '#dcfce7' : '#f3f4f6',
    color: active ? '#15803d' : '#6b7280',
    border: `2px solid ${active ? '#86efac' : '#d1d5db'}`,
    borderRadius: 10,
    cursor: 'pointer',
    width: '100%',
  };
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f0f4ff',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: 16,
    boxSizing: 'border-box',
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: 32,
    width: '100%',
    maxWidth: 420,
    boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
  },
  h1: { margin: '0 0 4px', fontSize: 24, color: '#1e3a8a' },
  sub: { margin: '0 0 24px', color: '#6b7280', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 },
  badge: { background: '#dbeafe', color: '#1d4ed8', borderRadius: 12, padding: '2px 8px', fontSize: 12, fontWeight: 600 },
  btnGroup: { display: 'flex', flexDirection: 'column', gap: 12 },
  input: {
    padding: '12px 14px',
    fontSize: 15,
    border: '1.5px solid #d1d5db',
    borderRadius: 10,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  status: {
    marginTop: 20,
    padding: '12px 16px',
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: 8,
    fontSize: 14,
    color: '#1e40af',
    lineHeight: 1.5,
  },
  warn: {
    marginBottom: 20,
    padding: '12px 16px',
    background: '#fff7ed',
    border: '1px solid #fed7aa',
    borderRadius: 8,
    fontSize: 14,
    color: '#9a3412',
    lineHeight: 1.5,
  },
  hint: {
    marginTop: 24,
    padding: '12px 16px',
    background: '#f9fafb',
    borderRadius: 8,
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 1.6,
  },
};
