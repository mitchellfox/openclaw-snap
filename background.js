// background.js — OpenClaw Snap service worker

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
    return true; // keep channel open for async response
  }
  return true;
});

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
  const config = await chrome.storage.sync.get(['gatewayUrl', 'gatewayToken', 'targetSession']);

  if (!config.gatewayUrl || !config.gatewayToken || !config.targetSession) {
    console.error('OpenClaw not configured');
    return { success: false, error: 'Not configured' };
  }

  // Build markdown context
  const md = buildMarkdown(context, notes);

  // Convert base64 to blob
  const base64 = imageData.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/png' });

  // Send as multipart form data
  const formData = new FormData();
  formData.append('message', md);
  formData.append('media', blob, 'screenshot.png');

  try {
    const url = `${config.gatewayUrl}/api/sessions/${encodeURIComponent(config.targetSession)}/message`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.gatewayToken}`
      },
      body: formData
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
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
