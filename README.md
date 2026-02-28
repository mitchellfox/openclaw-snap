# 📸 OpenClaw Snap

Contextual screenshots with annotation for OpenClaw agentic workflows. Take a screenshot, annotate it, and send it to your agent with full page context — no typing required.

## Install

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select this folder: `~/.openclaw/workspace/openclaw-snap/`

## Setup

1. Click the extension icon → ⚙️ Settings
2. Enter your OpenClaw gateway URL (default: `http://localhost:18789`)
3. Enter your gateway token
4. Click **Save & Setup** — channels are auto-detected

## Usage

1. Click the extension icon on any page
2. Choose capture mode:
   - **Capture Visible Area** — screenshots what you see
   - **Select Area** — click and drag to crop
   - **Full Page** — captures the visible viewport
3. Annotate with **rectangles**, **arrows**, and **text**
4. Add optional notes (type or use 🎤 voice-to-text)
5. Click **Send to OpenClaw**

## What Gets Sent

- Annotated screenshot (PNG)
- Markdown context table:
  - Page URL and title
  - Protocol (HTTP/HTTPS)
  - Browser and OS
  - Viewport and screen resolution
  - Device pixel ratio
  - Cookie count and auth detection
  - Console errors (last 20)
  - Timestamp

## Architecture

```
Chrome Extension  →  Snap Relay (localhost)  →  openclaw CLI  →  Discord
   (capture)          (saves + sends)          (components v2)    (channel)
```

The extension captures screenshots and sends them to a local relay server. The relay saves the image and uses the `openclaw` CLI to deliver a rich component message to the target Discord channel.

See [`relay/README.md`](relay/README.md) for relay setup.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome MV3 extension manifest |
| `popup.html/js` | Extension popup (capture triggers) |
| `background.js` | Service worker (capture, context, send) |
| `content.js` | Console error capture (injected on all pages) |
| `area-select.js` | Area selection overlay (injected on demand) |
| `annotate.html/js/css` | Full annotation editor |
| `options.html/js` | Settings page |
| `relay/snap-relay.js` | Local HTTP relay server |
