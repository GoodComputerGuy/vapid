# VAPID Push Notification Test

Minimal end-to-end web push proof-of-concept. Node/Express backend + React frontend in a single Docker Compose stack. Validates the full VAPID push flow on real devices before integrating into a production app.

## Features

- VAPID key pair auto-generated on first run, persisted to `.env`
- Push subscriptions persisted to `subscriptions.json` — survive container restarts
- Per-device **on-call toggle** — only on-call subscribers receive notifications
- **Custom message** field — type a message or leave blank for the default timestamped notification
- Subscribe / Unsubscribe from the UI
- Live subscriber badge showing `X/Y on call`
- PWA manifest — installable to home screen
- Works on desktop Chrome/Firefox, Android Chrome, and iOS Safari 16.4+

## Quick start

```bash
# .env will be created automatically on first run, but it must exist as a file
# for Docker's volume mount to work correctly
touch .env
touch subscriptions.json

docker compose up --build
```

The app is served at `http://localhost:3001`.

## Cloudflare tunnel (required for iOS)

iOS Safari requires HTTPS to register a service worker. Point a tunnel at port `3001`:

```bash
# Quick one-shot tunnel (no account needed)
cloudflared tunnel --url http://localhost:3001

# Named tunnel
cloudflared tunnel run <your-tunnel-name>
```

Set `PUBLIC_URL` in `.env` to your tunnel URL (logged by the backend):

```
PUBLIC_URL=https://your-tunnel.example.com
```

## Platform setup

| Platform | Browser | Steps |
|---|---|---|
| **Desktop** | Chrome / Firefox / Edge | Open URL → Subscribe → Send |
| **Android** | Chrome | Open URL → Subscribe → Send |
| **iOS** | Safari 16.4+ | Open URL → Share → Add to Home Screen → reopen from home screen → Subscribe |

> Chrome on iOS does **not** support web push (WebKit restriction).

## On-call toggle

Each subscribed device shows an **On Call / Off Call** toggle. Only on-call devices receive notifications when Send is triggered. Toggle state is persisted — survives container restarts.

This pattern is designed to be reused in production apps. To adapt it:
- Rename Subscribe/Unsubscribe to match your domain language
- Rename the toggle to "Go On Call / Go Off Call"
- Optionally add a server-side schedule that auto-flips the `onCall` flag

## API endpoints

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/api/vapid-public-key` | — | Returns VAPID public key |
| `POST` | `/api/subscribe` | push subscription object | Register a device |
| `POST` | `/api/unsubscribe` | `{ endpoint }` | Remove a device |
| `POST` | `/api/oncall` | `{ endpoint, active }` | Toggle on-call status |
| `POST` | `/api/oncall-status` | `{ endpoint }` | Get on-call status for a device |
| `POST` | `/api/test-notify` | `{ message? }` | Push to all on-call subscribers |
| `GET` | `/api/status` | — | Subscriber + on-call counts |

## Persistent files

Both files are volume-mounted into the backend container and survive rebuilds:

| File | Contents |
|------|----------|
| `.env` | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `PUBLIC_URL` |
| `subscriptions.json` | Array of push subscription objects with `onCall` flag |

## Notes

- Expired push endpoints (HTTP 410) are automatically pruned after a failed send
- Subscriptions default to `onCall: true` when first registered
- Custom notification tone is **not possible** via the Web Push API — sound is OS-controlled
- iOS notification sound can be changed in iOS Settings → Notifications; Android in Settings → Apps → Chrome → Notifications
