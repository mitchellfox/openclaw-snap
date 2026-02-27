// options.js — Settings page (uses HTTP for connectivity test, WS via background for send)

let selectedSession = null;

document.addEventListener('DOMContentLoaded', async () => {
  const config = await chrome.storage.sync.get(['gatewayHost', 'gatewayPort', 'gatewayToken', 'targetSession']);
  if (config.gatewayHost) document.getElementById('gatewayHost').value = config.gatewayHost;
  if (config.gatewayPort) document.getElementById('gatewayPort').value = config.gatewayPort;
  if (config.gatewayToken) document.getElementById('gatewayToken').value = config.gatewayToken;
  selectedSession = config.targetSession || null;

  document.getElementById('connectBtn').addEventListener('click', connect);
  document.getElementById('saveBtn').addEventListener('click', save);
});

function getConfig() {
  return {
    host: document.getElementById('gatewayHost').value.trim() || 'localhost',
    port: document.getElementById('gatewayPort').value.trim() || '18789',
    token: document.getElementById('gatewayToken').value.trim()
  };
}

async function connect() {
  const { host, port, token } = getConfig();
  if (!token) { showStatus('Enter gateway token first', 'err'); return; }

  setConnStatus('connecting', 'Connecting...');
  document.getElementById('connectBtn').disabled = true;

  try {
    // Test connectivity via HTTP — fetch the control UI page with auth
    const baseUrl = `http://${host}:${port}`;
    
    // Try to connect via WebSocket from this page directly using a simple test
    const connected = await testWsConnection(host, port, token);
    
    if (connected.ok) {
      setConnStatus('connected', `Connected (protocol ${connected.protocol || '3'})`);
      document.getElementById('connectBtn').textContent = '🔄 Reconnect';
      
      // Fetch sessions
      await fetchSessions(host, port, token);
    } else {
      setConnStatus('error', connected.error || 'Connection failed');
    }
  } catch (e) {
    console.error('[Snap] Connect error:', e);
    setConnStatus('error', e.message || 'Connection failed');
  }

  document.getElementById('connectBtn').disabled = false;
}

function testWsConnection(host, port, token) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${host}:${port}`);
    const timeout = setTimeout(() => {
      ws.close();
      resolve({ ok: false, error: 'Connection timeout (10s)' });
    }, 10000);

    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }

      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        ws.send(JSON.stringify({
          type: 'req', id: '1', method: 'connect',
          params: {
            minProtocol: 3, maxProtocol: 3,
            client: { id: 'gateway-client', version: '1.0.0', platform: 'chrome-extension', mode: 'backend' },
            role: 'operator',
            scopes: ['operator.read', 'operator.write'],
            caps: [], commands: [], permissions: {},
            auth: { token },
            locale: 'en-US',
            userAgent: 'openclaw-snap/1.0.0'
          }
        }));
      }

      if (msg.type === 'res' && msg.id === '1') {
        clearTimeout(timeout);
        if (msg.ok) {
          // Keep this connection alive for session listing
          ws._authed = true;
          ws._resolve = resolve;
          resolve({ ok: true, protocol: msg.payload?.protocol, ws });
        } else {
          ws.close();
          const err = typeof msg.error === 'string' ? msg.error
            : msg.error?.message || JSON.stringify(msg.error || msg.payload);
          resolve({ ok: false, error: err });
        }
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      resolve({ ok: false, error: 'WebSocket connection failed — is the gateway running?' });
    };

    ws.onclose = (e) => {
      if (!e.wasClean) {
        clearTimeout(timeout);
        resolve({ ok: false, error: `Connection closed: ${e.reason || 'code ' + e.code}` });
      }
    };
  });
}

async function fetchSessions(host, port, token) {
  const section = document.getElementById('sessionSection');
  section.style.opacity = '1';
  section.style.pointerEvents = 'auto';

  const listEl = document.getElementById('sessionList');
  listEl.innerHTML = '<div class="empty-sessions">Loading sessions...</div>';

  try {
    // Use a fresh WS connection to list sessions
    const result = await wsRpcCall(host, port, token, 'sessions.list', { messageLimit: 0 });
    const sessions = result.sessions || result || [];

    if (!Array.isArray(sessions) || sessions.length === 0) {
      listEl.innerHTML = '<div class="empty-sessions">No active sessions found</div>';
      return;
    }

    listEl.innerHTML = '';
    sessions.forEach(s => {
      const key = s.sessionKey || s.key || '';
      const agent = s.agentId || key.split(':')[1] || 'unknown';
      const channel = extractChannel(key);

      const item = document.createElement('div');
      item.className = 'session-item' + (selectedSession === key ? ' selected' : '');
      item.innerHTML = `
        <span class="agent">${s.agentEmoji || '🤖'} ${agent}</span>
        <span class="channel">${channel}</span>
        <span class="key">${key}</span>
      `;
      item.addEventListener('click', () => {
        document.querySelectorAll('.session-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        selectedSession = key;
        document.getElementById('saveBtn').disabled = false;
      });
      listEl.appendChild(item);
    });

    if (selectedSession) document.getElementById('saveBtn').disabled = false;
  } catch (e) {
    listEl.innerHTML = `<div class="empty-sessions">Error: ${e.message}</div>`;
  }
}

function wsRpcCall(host, port, token, method, params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}:${port}`);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Timeout')); }, 15000);
    let authed = false;

    ws.onmessage = (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }

      if (msg.type === 'event' && msg.event === 'connect.challenge' && !authed) {
        ws.send(JSON.stringify({
          type: 'req', id: 'auth', method: 'connect',
          params: {
            minProtocol: 3, maxProtocol: 3,
            client: { id: 'gateway-client', version: '1.0.0', platform: 'chrome-extension', mode: 'backend' },
            role: 'operator',
            scopes: ['operator.read', 'operator.write'],
            caps: [], commands: [], permissions: {},
            auth: { token },
            locale: 'en-US',
            userAgent: 'openclaw-snap/1.0.0'
          }
        }));
      }

      if (msg.type === 'res' && msg.id === 'auth') {
        if (msg.ok) {
          authed = true;
          ws.send(JSON.stringify({ type: 'req', id: 'rpc1', method, params }));
        } else {
          clearTimeout(timeout);
          ws.close();
          reject(new Error('Auth failed'));
        }
      }

      if (msg.type === 'res' && msg.id === 'rpc1') {
        clearTimeout(timeout);
        ws.close();
        if (msg.ok) resolve(msg.payload || msg);
        else reject(new Error(JSON.stringify(msg.error)));
      }
    };

    ws.onerror = () => { clearTimeout(timeout); reject(new Error('Connection failed')); };
  });
}

async function save() {
  const { host, port, token } = getConfig();
  if (!token) { showStatus('Gateway token is required', 'err'); return; }
  if (!selectedSession) { showStatus('Select a target session', 'err'); return; }

  await chrome.storage.sync.set({
    gatewayHost: host,
    gatewayPort: port,
    gatewayToken: token,
    gatewayUrl: `http://${host}:${port}`,
    targetSession: selectedSession
  });
  showStatus('Settings saved!', 'success');
}

function extractChannel(key) {
  const parts = key.split(':');
  if (parts.length >= 4) {
    return `${parts[2]} ${parts[3] === 'channel' ? '#' : ''}${parts.slice(3).join(':')}`;
  }
  return key;
}

function setConnStatus(state, text) {
  const el = document.getElementById('connStatus');
  el.className = `connection-status ${state}`;
  el.innerHTML = `<span class="dot"></span><span>${text}</span>`;
}

function showStatus(msg, type) {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.className = type;
  setTimeout(() => { el.style.display = 'none'; el.className = ''; }, 4000);
}
