// options.js — Settings page with WS-based session discovery

let ws = null;
let pendingCallbacks = {};
let rpcId = 0;
let selectedSession = null;
let sessions = [];

document.addEventListener('DOMContentLoaded', async () => {
  // Load saved config
  const config = await chrome.storage.sync.get(['gatewayHost', 'gatewayPort', 'gatewayToken', 'targetSession']);
  if (config.gatewayHost) document.getElementById('gatewayHost').value = config.gatewayHost;
  if (config.gatewayPort) document.getElementById('gatewayPort').value = config.gatewayPort;
  if (config.gatewayToken) document.getElementById('gatewayToken').value = config.gatewayToken;
  selectedSession = config.targetSession || null;

  // If we have saved credentials, auto-connect
  if (config.gatewayHost && config.gatewayToken) {
    connect();
  }

  document.getElementById('connectBtn').addEventListener('click', connect);

  document.getElementById('saveBtn').addEventListener('click', async () => {
    const host = document.getElementById('gatewayHost').value.trim() || 'localhost';
    const port = document.getElementById('gatewayPort').value.trim() || '18789';
    const token = document.getElementById('gatewayToken').value.trim();

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
  });
});

function connect() {
  const host = document.getElementById('gatewayHost').value.trim() || 'localhost';
  const port = document.getElementById('gatewayPort').value.trim() || '18789';
  const token = document.getElementById('gatewayToken').value.trim();

  if (!token) { showStatus('Enter gateway token first', 'err'); return; }

  setConnStatus('connecting', 'Connecting...');
  document.getElementById('connectBtn').disabled = true;

  if (ws) { try { ws.close(); } catch(e) {} }

  ws = new WebSocket(`ws://${host}:${port}`);

  ws.onopen = () => {
    // Wait for challenge
  };

  ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch(e) { return; }

    // Handle challenge
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      const connectReq = {
        type: 'req',
        id: String(++rpcId),
        method: 'connect',
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: 'openclaw-control-ui',
            version: '1.0.0',
            platform: 'chrome-extension',
            mode: 'ui'
          },
          role: 'operator',
          scopes: ['operator.read', 'operator.write'],
          caps: [],
          commands: [],
          permissions: {},
          auth: { token },
          locale: navigator.language,
          userAgent: 'openclaw-snap/1.0.0'
        }
      };
      pendingCallbacks[connectReq.id] = (res) => {
        console.log('Connect response:', JSON.stringify(res));
        if (res.ok) {
          setConnStatus('connected', `Connected (protocol ${res.payload?.protocol || '?'})`);
          document.getElementById('connectBtn').disabled = false;
          document.getElementById('connectBtn').textContent = '🔄 Reconnect';
          fetchSessions();
        } else {
          const errMsg = typeof res.error === 'string' ? res.error
            : res.error?.message || res.error?.code || res.payload?.message || JSON.stringify(res.error || res.payload);
          setConnStatus('error', `Auth failed: ${errMsg}`);
          document.getElementById('connectBtn').disabled = false;
        }
      };
      ws.send(JSON.stringify(connectReq));
      return;
    }

    // Handle RPC responses
    if (msg.type === 'res' && msg.id && pendingCallbacks[msg.id]) {
      pendingCallbacks[msg.id](msg);
      delete pendingCallbacks[msg.id];
    }
  };

  ws.onerror = () => {
    setConnStatus('error', 'Connection failed');
    document.getElementById('connectBtn').disabled = false;
  };

  ws.onclose = () => {
    if (document.getElementById('connStatus').className.includes('connecting')) {
      setConnStatus('error', 'Connection closed');
      document.getElementById('connectBtn').disabled = false;
    }
  };
}

function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('Not connected'));
      return;
    }
    const id = String(++rpcId);
    const req = { type: 'req', id, method, params };
    pendingCallbacks[id] = (res) => {
      if (res.ok) resolve(res.payload || res);
      else reject(new Error(res.error || 'RPC error'));
    };
    ws.send(JSON.stringify(req));
    setTimeout(() => {
      if (pendingCallbacks[id]) {
        delete pendingCallbacks[id];
        reject(new Error('Timeout'));
      }
    }, 10000);
  });
}

async function fetchSessions() {
  const section = document.getElementById('sessionSection');
  section.style.opacity = '1';
  section.style.pointerEvents = 'auto';

  const listEl = document.getElementById('sessionList');
  listEl.innerHTML = '<div class="empty-sessions">Loading sessions...</div>';

  try {
    const result = await rpcCall('sessions.list', { messageLimit: 0 });
    sessions = result.sessions || result || [];

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

    if (selectedSession) {
      document.getElementById('saveBtn').disabled = false;
    }
  } catch (e) {
    listEl.innerHTML = `<div class="empty-sessions">Error: ${e.message}</div>`;
  }
}

function extractChannel(key) {
  // e.g. "agent:kragg:discord:channel:123" → "discord #channel"
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
