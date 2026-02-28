# Snap Relay

Lightweight HTTP server that receives screenshots from the OpenClaw Snap extension and delivers them to Discord channels via the `openclaw` CLI.

## Requirements

- Node.js 18+
- `openclaw` CLI installed and configured (`openclaw.json` with gateway token + Discord channel)

## Setup

```bash
node relay/snap-relay.js
```

Or as a systemd user service:

```ini
[Unit]
Description=OpenClaw Snap Relay

[Service]
ExecStart=/usr/bin/node /path/to/snap-relay.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SNAP_RELAY_PORT` | `18790` | HTTP listen port |
| `SNAP_MEDIA_DIR` | `~/.openclaw/media/snaps` | Where screenshots are saved |
| `OPENCLAW_DIR` | `~/.openclaw` | OpenClaw config directory |
| `OPENCLAW_BIN` | Auto-detected | Path to `openclaw` binary |

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/snap` | Bearer token | Receive screenshot + context |
| GET | `/channels` | Bearer token | List configured Discord channels |
| GET | `/health` | None | Health check |

## Security

- All mutating endpoints require the gateway token as a `Bearer` token
- Listens on `127.0.0.1` only (not exposed to network)
- No secrets are hardcoded — everything is read from `openclaw.json` at startup
