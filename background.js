// background.js — OpenClaw Snap service worker

// Keep service worker alive during WS connections
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Snap] Extension installed/updated');
});

// Gateway WebSocket state
let gwWs = null;
let gwConnected = false;
let gwPendingRpc = {};
let gwRpcId = 0;
let gwConnectResolve = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'captureVisible') {
    captureVisible(msg.tabId);
  } else if (msg.action === 'captureArea') {
    startAreaSelect(msg.tabId);
  } else if (msg.action === 'captureFullPage') {
    captureFullPage(msg.tabId);
  } else if (msg.action === 'areaSelected') {
    captureAndCrop(sender.tab.id, msg.rect);
  } else if (msg.action === 'sendToOpenClaw') {
    sendToOpenClaw(msg.imageData, msg.context, msg.notes)
      .then(result => sendResponse(result))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  } else if (msg.action === 'gwConnect') {
    gwConnect(msg.host, msg.port, msg.token)
      .then(result => sendResponse(result))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  } else if (msg.action === 'gwListSessions') {
    gwRpcCall('sessions.list', { messageLimit: 0 })
      .then(result => sendResponse({ ok: true, payload: result }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  } else if (msg.action === 'gwDisconnect') {
    gwDisconnect();
    sendResponse({ ok: true });
  }
  return true;
});

// --- Gateway WebSocket (runs in service worker, no origin issues) ---

function gwConnect(host, port, token) {
  return new Promise((resolve, reject) => {
    gwDisconnect();

    const wsUrl = `ws://${host}:${port}`;
    console.log('[Snap] Connecting to', wsUrl);
    try {
      gwWs = new WebSocket(wsUrl);
    } catch (e) {
      console.error('[Snap] WebSocket create failed:', e);
      reject(new Error('Failed to create WebSocket: ' + e.message));
      return;
    }

    const timeout = setTimeout(() => {
      console.error('[Snap] Connection timeout after 10s');
      gwDisconnect();
      reject(new Error('Connection timeout'));
    }, 10000);

    gwWs.onopen = () => {
      console.log('[Snap] WebSocket opened, waiting for challenge...');
    };

    gwWs.onmessage = (evt) => {
      console.log('[Snap] WS message:', evt.data.substring(0, 200));
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }

      // Handle challenge
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        const id = String(++gwRpcId);
        gwPendingRpc[id] = (res) => {
          clearTimeout(timeout);
          if (res.ok) {
            gwConnected = true;
            resolve({ ok: true, protocol: res.payload?.protocol });
          } else {
            gwDisconnect();
            const errMsg = typeof res.error === 'string' ? res.error
              : res.error?.message || res.error?.code || res.payload?.message
              || JSON.stringify(res.error || res.payload);
            reject(new Error(errMsg));
          }
        };
        gwWs.send(JSON.stringify({
          type: 'req', id, method: 'connect',
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
        return;
      }

      // Handle RPC responses
      if (msg.type === 'res' && msg.id && gwPendingRpc[msg.id]) {
        gwPendingRpc[msg.id](msg);
        delete gwPendingRpc[msg.id];
      }
    };

    gwWs.onerror = (e) => {
      console.error('[Snap] WebSocket error:', e);
      clearTimeout(timeout);
      gwDisconnect();
      reject(new Error('WebSocket connection failed'));
    };

    gwWs.onclose = (e) => {
      console.log('[Snap] WebSocket closed:', e.code, e.reason);
      gwConnected = false;
    };
  });
}

function gwDisconnect() {
  gwConnected = false;
  gwPendingRpc = {};
  if (gwWs) {
    try { gwWs.close(); } catch {}
    gwWs = null;
  }
}

function gwRpcCall(method, params) {
  return new Promise((resolve, reject) => {
    if (!gwWs || gwWs.readyState !== WebSocket.OPEN || !gwConnected) {
      reject(new Error('Not connected to gateway'));
      return;
    }
    const id = String(++gwRpcId);
    gwPendingRpc[id] = (res) => {
      if (res.ok) resolve(res.payload || res);
      else reject(new Error(typeof res.error === 'string' ? res.error : JSON.stringify(res.error)));
    };
    gwWs.send(JSON.stringify({ type: 'req', id, method, params }));
    setTimeout(() => {
      if (gwPendingRpc[id]) {
        delete gwPendingRpc[id];
        reject(new Error('RPC timeout'));
      }
    }, 10000);
  });
}

async function captureVisible(tabId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    const tab = await chrome.tabs.get(tabId);
    const context = await gatherContext(tab);
    openAnnotator(tabId, dataUrl, context);
  } catch (e) {
    console.error('Capture failed:', e);
  }
}

async function startAreaSelect(tabId) {
  // Inject area selection overlay into the page
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['area-select.js']
  });
}

async function captureAndCrop(tabId, rect) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    const tab = await chrome.tabs.get(tabId);
    const context = await gatherContext(tab);

    // Crop will happen in the annotator
    context._cropRect = rect;
    openAnnotator(tabId, dataUrl, context);
  } catch (e) {
    console.error('Capture+crop failed:', e);
  }
}

async function captureFullPage(tabId) {
  // For full page, we just capture visible for now (scroll-stitch is complex)
  // TODO: implement scroll-stitch for true full page
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    const tab = await chrome.tabs.get(tabId);
    const context = await gatherContext(tab);
    context._fullPage = true;
    openAnnotator(tabId, dataUrl, context);
  } catch (e) {
    console.error('Full page capture failed:', e);
  }
}

async function gatherContext(tab) {
  const context = {
    url: tab.url,
    title: tab.title,
    protocol: new URL(tab.url).protocol.replace(':', '').toUpperCase(),
    timestamp: new Date().toISOString()
  };

  // Get viewport/screen info and console errors from the page
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        return {
          viewport: `${window.innerWidth}×${window.innerHeight}`,
          screen: `${screen.width}×${screen.height}`,
          dpr: window.devicePixelRatio,
          userAgent: navigator.userAgent,
          cookieCount: document.cookie.split(';').filter(c => c.trim()).length,
          cookies: document.cookie,
          consoleErrors: window.__openclawSnapErrors || []
        };
      }
    });
    if (results && results[0] && results[0].result) {
      const r = results[0].result;
      Object.assign(context, r);

      // Parse browser/OS from user agent
      const ua = r.userAgent;
      context.browser = parseBrowser(ua);
      context.os = parseOS(ua);

      // Check for auth cookies
      const authPatterns = ['session', 'token', 'jwt', 'auth', 'logged_in', 'csrf', 'sid', '_identity', 'connect.sid'];
      const cookieParts = r.cookies.split(';').map(c => c.trim().split('=')[0].toLowerCase());
      context.authCookies = cookieParts.filter(c => authPatterns.some(p => c.includes(p)));
      context.loginDetected = context.authCookies.length > 0;
    }
  } catch (e) {
    context.contextError = e.message;
  }

  return context;
}

function parseBrowser(ua) {
  if (ua.includes('Chrome/')) {
    const m = ua.match(/Chrome\/([\d.]+)/);
    return 'Chrome ' + (m ? m[1] : 'unknown');
  }
  if (ua.includes('Firefox/')) {
    const m = ua.match(/Firefox\/([\d.]+)/);
    return 'Firefox ' + (m ? m[1] : 'unknown');
  }
  if (ua.includes('Safari/') && !ua.includes('Chrome')) {
    const m = ua.match(/Version\/([\d.]+)/);
    return 'Safari ' + (m ? m[1] : 'unknown');
  }
  return ua.substring(0, 50);
}

function parseOS(ua) {
  if (ua.includes('Mac OS X')) {
    const m = ua.match(/Mac OS X ([\d_]+)/);
    return 'macOS ' + (m ? m[1].replace(/_/g, '.') : '');
  }
  if (ua.includes('Windows NT')) {
    const m = ua.match(/Windows NT ([\d.]+)/);
    const versions = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' };
    return 'Windows ' + (m ? (versions[m[1]] || m[1]) : '');
  }
  if (ua.includes('Linux')) return 'Linux';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iOS')) return 'iOS';
  return 'Unknown OS';
}

function openAnnotator(tabId, imageDataUrl, context) {
  // Store data for the annotator page to pick up
  chrome.storage.local.set({
    snapData: {
      image: imageDataUrl,
      context: context,
      capturedAt: Date.now()
    }
  }, () => {
    // Open annotator in a new tab
    chrome.tabs.create({
      url: chrome.runtime.getURL('annotate.html'),
      active: true
    });
  });
}

async function sendToOpenClaw(imageData, context, notes) {
  const config = await chrome.storage.sync.get(['webhookUrl']);

  if (!config.webhookUrl) {
    console.error('OpenClaw Snap not configured');
    return { success: false, error: 'Not configured — set Webhook URL in Settings' };
  }

  const md = buildMarkdown(context, notes);
  const base64Data = imageData.split(',')[1];

  // Convert base64 to blob for multipart upload
  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/png' });

  try {
    // Send via Discord webhook (multipart: message + image attachment)
    const formData = new FormData();

    // Discord webhook payload
    const payload = {
      content: md,
      username: '📸 OpenClaw Snap'
    };
    formData.append('payload_json', JSON.stringify(payload));
    formData.append('files[0]', blob, `screenshot-${Date.now()}.png`);

    const resp = await fetch(config.webhookUrl, {
      method: 'POST',
      body: formData
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Discord webhook error ${resp.status}: ${text.substring(0, 200)}`);
    }

    return { success: true };
  } catch (e) {
    console.error('Send failed:', e);
    return { success: false, error: e.message };
  }
}

function buildMarkdown(ctx, notes) {
  let md = `📸 **Screenshot from ${ctx.title || 'Unknown Page'}**\n\n`;

  if (notes && notes.trim()) {
    md += `**Notes:** ${notes.trim()}\n\n`;
  }

  md += `---\n**Context:**\n`;
  md += `| Field | Value |\n|-------|-------|\n`;
  md += `| URL | ${ctx.url} |\n`;
  md += `| Protocol | ${ctx.protocol} ${ctx.protocol === 'HTTPS' ? '✅' : '⚠️'} |\n`;
  md += `| Browser | ${ctx.browser || 'Unknown'} |\n`;
  md += `| OS | ${ctx.os || 'Unknown'} |\n`;
  md += `| Viewport | ${ctx.viewport || 'Unknown'} |\n`;
  md += `| Screen | ${ctx.screen || 'Unknown'} @ ${ctx.dpr || '?'}x DPR |\n`;
  md += `| Cookies | ${ctx.cookieCount || 0}${ctx.loginDetected ? ' (auth detected: ' + ctx.authCookies.join(', ') + ')' : ' (no auth detected)'} |\n`;
  md += `| Timestamp | ${ctx.timestamp} |\n`;

  if (ctx.consoleErrors && ctx.consoleErrors.length > 0) {
    md += `\n**Console Errors (${ctx.consoleErrors.length}):**\n\`\`\`\n`;
    ctx.consoleErrors.forEach(e => { md += `${e}\n`; });
    md += `\`\`\`\n`;
  }

  return md;
}
