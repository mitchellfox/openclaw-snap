// popup.js — OpenClaw Snap popup controller

document.addEventListener('DOMContentLoaded', async () => {
  // Check config status
  const config = await chrome.storage.sync.get(['gatewayUrl', 'gatewayToken', 'targetSession']);
  const statusEl = document.getElementById('status');

  if (config.gatewayUrl && config.gatewayToken && config.targetSession) {
    statusEl.className = 'status connected';
    statusEl.textContent = '✅ Connected to OpenClaw';
  }

  // Capture visible tab
  document.getElementById('captureVisible').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.runtime.sendMessage({ action: 'captureVisible', tabId: tab.id });
    window.close();
  });

  // Capture selected area
  document.getElementById('captureArea').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.runtime.sendMessage({ action: 'captureArea', tabId: tab.id });
    window.close();
  });

  // Capture full page
  document.getElementById('captureFullPage').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.runtime.sendMessage({ action: 'captureFullPage', tabId: tab.id });
    window.close();
  });

  // Settings
  document.getElementById('openSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
