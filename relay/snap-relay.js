#!/usr/bin/env node
// snap-relay.js — HTTP relay for OpenClaw Snap
// Receives screenshots from the extension, saves locally, and sends a rich
// component message to the target Discord channel via `openclaw message send`.
//
// All secrets are read from openclaw.json at startup — nothing is hardcoded.
// Auth: requests must include the gateway token as a Bearer token.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { execFile } = require('child_process');

// --- Config ---
const OPENCLAW_DIR = process.env.OPENCLAW_DIR || path.join(process.env.HOME, '.openclaw');
const cfgPath = path.join(OPENCLAW_DIR, 'openclaw.json');

if (!fs.existsSync(cfgPath)) {
  console.error(`[snap-relay] Config not found: ${cfgPath}`);
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const GATEWAY_TOKEN = cfg.gateway?.auth?.token;
const BOT_TOKEN = cfg.env?.vars?.DISCORD_BOT_TOKEN;
const PORT = parseInt(process.env.SNAP_RELAY_PORT || '18790');
const MEDIA_DIR = process.env.SNAP_MEDIA_DIR || path.join(OPENCLAW_DIR, 'media/snaps');

// Find openclaw CLI binary
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || (() => {
  const candidates = [
    path.join(process.env.HOME, '.npm-global/bin/openclaw'),
    '/usr/local/bin/openclaw',
    '/usr/bin/openclaw',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'openclaw'; // fallback to PATH
})();

if (!GATEWAY_TOKEN) { console.error('[snap-relay] No gateway.auth.token in config'); process.exit(1); }

// --- Server ---
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // POST /snap — receive screenshot from extension
  if (req.method === 'POST' && req.url === '/snap') {
    if (!checkAuth(req, res)) return;

    try {
      const body = await readBody(req);
      const data = JSON.parse(body);
      const { channelId, message, imageBase64, context } = data;

      if (!channelId || !imageBase64) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing channelId or imageBase64' }));
        return;
      }

      // Save image
      const snapId = randomUUID().slice(0, 8);
      fs.mkdirSync(MEDIA_DIR, { recursive: true });
      const imagePath = path.join(MEDIA_DIR, `snap-${snapId}.png`);
      fs.writeFileSync(imagePath, Buffer.from(imageBase64, 'base64'));

      // Save manifest
      const ctx = context || {};
      const manifest = { snapId, channelId, imagePath, context: ctx, message: message || '', timestamp: new Date().toISOString() };
      fs.writeFileSync(path.join(MEDIA_DIR, `snap-${snapId}.json`), JSON.stringify(manifest, null, 2));

      // Build context text
      const lines = [];
      if (ctx.url) lines.push(`🔗 ${ctx.url}`);
      if (ctx.pageTitle) lines.push(`📄 ${ctx.pageTitle}`);
      const noteMatch = message ? message.match(/\*\*Notes:\*\*\s*(.+?)(?:\n|$)/) : null;
      const note = noteMatch ? noteMatch[1].trim() : (message && !message.startsWith('📸') ? message : '');
      if (note) lines.push(`💬 ${note}`);
      const contextText = lines.join('\n') || 'No context';

      // Send rich message via openclaw CLI
      const components = {
        text: `📸 **Snap** \`${snapId}\`\n${contextText}`,
        blocks: [{ type: 'media-gallery', items: [{ url: `attachment://snap-${snapId}.png` }] }]
      };

      const result = await sendViaOpenClaw(channelId, imagePath, components);
      console.log(`[snap-relay] Snap ${snapId} → channel ${channelId}: ${result}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, snapId }));
    } catch (e) {
      console.error('[snap-relay] Error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // GET /health
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'snap-relay' }));
    return;
  }

  // GET /channels — list allowed Discord channels
  if (req.method === 'GET' && req.url === '/channels') {
    if (!checkAuth(req, res)) return;

    try {
      const freshCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      const guilds = freshCfg.channels?.discord?.guilds || {};
      const channels = [];

      for (const [guildId, guild] of Object.entries(guilds)) {
        for (const [chId, chCfg] of Object.entries(guild.channels || {})) {
          if (chCfg.allow !== false) channels.push({ id: chId, guildId });
        }
      }

      // Enrich with channel names from Discord API (if bot token available)
      const enriched = BOT_TOKEN
        ? await Promise.all(channels.map(async (ch) => {
            try {
              const data = await discordGet(`/channels/${ch.id}`);
              return { ...ch, name: data.name || ch.id };
            } catch { return { ...ch, name: ch.id }; }
          }))
        : channels.map(ch => ({ ...ch, name: ch.id }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ channels: enriched }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// --- Helpers ---

function checkAuth(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (token !== GATEWAY_TOKEN) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return false;
  }
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function sendViaOpenClaw(channelId, imagePath, components) {
  return new Promise((resolve, reject) => {
    const args = [
      'message', 'send',
      '--channel', 'discord',
      '--target', `channel:${channelId}`,
      '--media', imagePath,
      '--components', JSON.stringify(components)
    ];

    execFile(OPENCLAW_BIN, args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        console.error(`[snap-relay] CLI error: ${stderr || err.message}`);
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

function discordGet(apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'discord.com', path: `/api/v10${apiPath}`, method: 'GET',
      headers: { 'Authorization': `Bot ${BOT_TOKEN}` }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(Buffer.concat(chunks).toString()));
        else reject(new Error(`Discord ${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// --- Start ---
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[snap-relay] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[snap-relay] Media dir: ${MEDIA_DIR}`);
  console.log(`[snap-relay] OpenClaw CLI: ${OPENCLAW_BIN}`);
});
