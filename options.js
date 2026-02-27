// options.js — Settings page (simple: configure + test connection via WS handshake)

document.addEventListener('DOMContentLoaded', async () => {
  const config = await chrome.storage.sync.get(['gatewayHost', 'gatewayPort', 'gatewayToken', 'targetSession']);
  if (config.gatewayHost) document.getElementById('gatewayHost').value = config.gatewayHost;
  if (config.gatewayPort) document.getElementById('gatewayPort').value = config.gatewayPort;
  if (config.gatewayToken) document.getElementById('gatewayToken').value = config.gatewayToken;
  if (config.targetSession) document.getElementById('targetSession').value = config.targetSession;

  document.getElementById('saveBtn').addEventListener('click', save);
  document.getElementById('testBtn').addEventListener('click', testConnection);
});

async function save() {
  const host = document.getElementById('gatewayHost').value.trim() || 'localhost';
  const port = document.getElementById('gatewayPort').value.trim() || '18789';
  const token = document.getElementById('gatewayToken').value.trim();
  const session = document.getElementById('targetSession').value.trim();

  if (!token) { showStatus('Gateway token is required', 'err'); return; }
  if (!session) { showStatus('Session key is required', 'err'); return; }

  await chrome.storage.sync.set({
    gatewayHost: host,
    gatewayPort: port,
    gatewayToken: token,
    gatewayUrl: `http://${host}:${port}`,
    targetSession: session
  });
  showStatus('✅ Settings saved!', 'success');
}

async function testConnection() {
  const host = document.getElementById('gatewayHost').value.trim() || 'localhost';
  const port = document.getElementById('gatewayPort').value.trim() || '18789';
  const token = document.getElementById('gatewayToken').value.trim();

  if (!token) { showStatus('Enter gateway token first', 'err'); return; }

  document.getElementById('testBtn').disabled = true;
  showStatus('🔌 Testing connection...', 'success');

  try {
    const result = await new Promise((resolve) => {
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
              client: { id: 'cli', version: '1.0.0', platform: 'chrome-extension', mode: 'cli' },
              role: 'operator', scopes: [],
              caps: [], commands: [], permissions: {},
              auth: { token },
              locale: 'en-US',
              userAgent: 'openclaw-snap/1.0.0'
            }
          }));
        }

        if (msg.type === 'res' && msg.id === '1') {
          clearTimeout(timeout);
          ws.close();
          if (msg.ok) {
            resolve({ ok: true, protocol: msg.payload?.protocol });
          } else {
            const err = typeof msg.error === 'string' ? msg.error
              : msg.error?.message || JSON.stringify(msg.error);
            resolve({ ok: false, error: err });
          }
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve({ ok: false, error: 'Connection failed — is the gateway running?' });
      };

      ws.onclose = (e) => {
        clearTimeout(timeout);
        if (e.code !== 1000 && e.code !== 1005) {
          resolve({ ok: false, error: `Closed: ${e.reason || 'code ' + e.code}` });
        }
      };
    });

    if (result.ok) {
      showStatus(`✅ Connected! Gateway protocol v${result.protocol || '?'}`, 'success');
    } else {
      showStatus(`❌ ${result.error}`, 'err');
    }
  } catch (e) {
    showStatus(`❌ ${e.message}`, 'err');
  }

  document.getElementById('testBtn').disabled = false;
}

function showStatus(msg, type) {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.className = type;
  if (type !== 'err') {
    setTimeout(() => { el.style.display = 'none'; el.className = ''; }, 5000);
  }
}
