// popup.js — OpenClaw Snap popup controller

document.addEventListener('DOMContentLoaded', async () => {
  const config = await chrome.storage.sync.get(['gatewayHost', 'gatewayPort', 'gatewayToken', 'channelId', 'channels']);
  const statusEl = document.getElementById('status');
  const channelSelect = document.getElementById('channelSelect');

  // Populate channel dropdown
  const channels = config.channels || [];
  if (channels.length > 0) {
    channelSelect.innerHTML = '';
    channels.forEach(ch => {
      const opt = document.createElement('option');
      opt.value = ch.id;
      opt.textContent = `#${ch.name}`;
      if (ch.id === config.channelId) opt.selected = true;
      channelSelect.appendChild(opt);
    });
  } else if (config.channelId) {
    channelSelect.innerHTML = `<option value="${config.channelId}">#channel-${config.channelId.slice(-4)}</option>`;
  } else {
    channelSelect.innerHTML = '<option value="">No channels — check Settings</option>';
  }

  // Save channel selection
  channelSelect.addEventListener('change', async () => {
    await chrome.storage.sync.set({ channelId: channelSelect.value });
  });

  // Connection status
  if (config.gatewayHost && config.gatewayToken && (config.channelId || channels.length > 0)) {
    statusEl.className = 'status-bar ready';
    statusEl.innerHTML = '<i class="ph ph-check-circle" style="font-size:14px"></i> Ready';
  }

  // Capture visible tab
  document.getElementById('captureVisible').addEventListener('click', async () => {
    // Save current channel selection before capture
    await chrome.storage.sync.set({ channelId: channelSelect.value });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.runtime.sendMessage({ action: 'captureVisible', tabId: tab.id });
    window.close();
  });

  // Capture selected area
  document.getElementById('captureArea').addEventListener('click', async () => {
    await chrome.storage.sync.set({ channelId: channelSelect.value });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.runtime.sendMessage({ action: 'captureArea', tabId: tab.id });
    window.close();
  });

  // Capture full page
  document.getElementById('captureFullPage').addEventListener('click', async () => {
    await chrome.storage.sync.set({ channelId: channelSelect.value });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.runtime.sendMessage({ action: 'captureFullPage', tabId: tab.id });
    window.close();
  });

  // Settings
  document.getElementById('openSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Auto-fetch channels if we have gateway creds but no channel list
  if (config.gatewayHost && config.gatewayToken && channels.length === 0) {
    fetchChannels(config.gatewayHost, config.gatewayPort || '18789', config.gatewayToken);
  }
});

async function fetchChannels(host, port, token) {
  try {
    const relayPort = parseInt(port) + 1;
    const resp = await fetch(`http://${host}:${relayPort}/channels`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.channels && data.channels.length > 0) {
        await chrome.storage.sync.set({ channels: data.channels });
        const select = document.getElementById('channelSelect');
        select.innerHTML = '';
        const config = await chrome.storage.sync.get(['channelId']);
        data.channels.forEach(ch => {
          const opt = document.createElement('option');
          opt.value = ch.id;
          opt.textContent = `#${ch.name}`;
          if (ch.id === config.channelId) opt.selected = true;
          select.appendChild(opt);
        });
        // Auto-select first if none selected
        if (!config.channelId && data.channels.length > 0) {
          await chrome.storage.sync.set({ channelId: data.channels[0].id });
        }
      }
    }
  } catch (e) {
    console.log('Could not fetch channels:', e.message);
  }
}
