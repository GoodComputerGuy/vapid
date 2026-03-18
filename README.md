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

---

## How Docker + GitHub deployment works

This project uses a standard pattern you'll use for all Docker apps:

- **The code** lives on GitHub. You never manually copy files to the server.
- **The server** clones from GitHub, then Docker builds and runs the app from those files.
- **To deploy an update**: push your changes to GitHub on your dev machine, then pull and rebuild on the server. Two commands.

```
Your machine  →  GitHub  →  Server (git pull + docker compose up)
```

> The only files that are NOT in GitHub are `.env` (holds secret keys) and `subscriptions.json`
> (holds live data). These are created once on the server and never overwritten by git.

---

## First deploy on a new server

```bash
# 1. SSH into the server
ssh user@your-server

# 2. Go to where you keep Docker projects
cd /docker-data

# 3. Clone the repo — this downloads all the code
sudo git clone https://github.com/GoodComputerGuy/vapid.git
cd vapid

# 4. Create the two files that git doesn't manage (just needs to exist, content is auto-generated)
sudo touch .env subscriptions.json

# 5. Build the Docker images and start the containers
sudo docker compose up --build -d

# The -d flag means "detached" — runs in the background
# The --build flag means "rebuild the images from the code"
```

The backend generates VAPID keys on first run and writes them to `.env`. The app is running.

---

## Deploying updates

Whenever you make code changes on your dev machine:

```bash
# On your dev machine — commit and push to GitHub
git add .
git commit -m "describe your change"
git push

# On the server — pull the new code and rebuild
ssh user@your-server "cd /docker-data/vapid && sudo git pull && sudo docker compose up --build -d"
```

That's the entire update workflow. `git pull` downloads the new code; `docker compose up --build` rebuilds the images with it and restarts the containers.

---

## Cloudflare tunnel (required for iOS)

iOS Safari requires HTTPS to register a service worker. Point a Cloudflare tunnel at the app port:

```bash
# Quick one-shot tunnel (no account needed, URL changes each time)
cloudflared tunnel --url http://localhost:3001

# Named tunnel with a fixed domain (requires Cloudflare account)
cloudflared tunnel run <your-tunnel-name>
```

Set `PUBLIC_URL` in `.env` on the server to your tunnel URL (logged by the backend):

```
PUBLIC_URL=https://vapid.yourdomain.com
```

---

## Platform setup

| Platform | Browser | Steps |
|---|---|---|
| **Desktop** | Chrome / Firefox / Edge | Open URL → Subscribe → Send |
| **Android** | Chrome | Open URL → Subscribe → Send |
| **iOS** | Safari 16.4+ | Open URL → Share → Add to Home Screen → reopen from home screen → Subscribe |

> Chrome on iOS does **not** support web push (WebKit restriction, not specific to this app).

---

## On-call toggle

Each subscribed device shows an **On Call / Off Call** toggle. Only on-call devices receive notifications when Send is triggered. Toggle state is persisted in `subscriptions.json` and survives container restarts.

**To adapt this pattern for a production app:**
- Rename Subscribe/Unsubscribe to match your domain language
- Rename the toggle to "Go On Call / Go Off Call"
- Optionally add a server-side schedule that auto-flips the `onCall` flag on a rotation

---

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

---

## Useful Docker commands

```bash
# See running containers
docker compose ps

# Watch live logs
docker compose logs -f

# Stop everything
docker compose down

# Rebuild and restart (after a code change)
docker compose up --build -d

# Restart without rebuilding (after a config change)
docker compose restart
```

---

## Notes

- Expired push endpoints (HTTP 410) are automatically pruned after a failed send
- Subscriptions default to `onCall: true` when first registered
- Custom notification tone is **not possible** via the Web Push API — sound is OS-controlled
  - Android: Settings → Apps → Chrome → Notifications → Sound
  - iOS: system default, no per-app override possible
