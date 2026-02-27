// options.js — Settings page

document.addEventListener('DOMContentLoaded', async () => {
  const config = await chrome.storage.sync.get(['gatewayUrl', 'gatewayToken', 'targetSession']);

  document.getElementById('gatewayUrl').value = config.gatewayUrl || '';
  document.getElementById('gatewayToken').value = config.gatewayToken || '';
  document.getElementById('targetSession').value = config.targetSession || '';

  document.getElementById('saveBtn').addEventListener('click', async () => {
    const gatewayUrl = document.getElementById('gatewayUrl').value.trim().replace(/\/$/, '');
    const gatewayToken = document.getElementById('gatewayToken').value.trim();
    const targetSession = document.getElementById('targetSession').value.trim();

    if (!gatewayUrl || !gatewayToken || !targetSession) {
      showStatus('All fields are required', 'error');
      return;
    }

    await chrome.storage.sync.set({ gatewayUrl, gatewayToken, targetSession });
    showStatus('Settings saved!', 'success');
  });

  document.getElementById('testBtn').addEventListener('click', async () => {
    const gatewayUrl = document.getElementById('gatewayUrl').value.trim().replace(/\/$/, '');
    const gatewayToken = document.getElementById('gatewayToken').value.trim();

    if (!gatewayUrl || !gatewayToken) {
      showStatus('Enter gateway URL and token first', 'error');
      return;
    }

    try {
      const resp = await fetch(`${gatewayUrl}/api/status`, {
        headers: { 'Authorization': `Bearer ${gatewayToken}` }
      });
      if (resp.ok) {
        const data = await resp.json();
        showStatus(`Connected! Gateway v${data.version || 'unknown'}`, 'success');
      } else {
        showStatus(`HTTP ${resp.status}: ${resp.statusText}`, 'error');
      }
    } catch (e) {
      showStatus(`Connection failed: ${e.message}`, 'error');
    }
  });
});

function showStatus(msg, type) {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.className = type;
  setTimeout(() => { el.style.display = 'none'; el.className = ''; }, 4000);
}
