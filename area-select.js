// area-select.js — Injected into page for area selection
(function() {
  if (document.getElementById('openclaw-snap-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'openclaw-snap-overlay';
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
    zIndex: '2147483647', cursor: 'crosshair', background: 'rgba(0,0,0,0.3)'
  });

  const selection = document.createElement('div');
  Object.assign(selection.style, {
    position: 'fixed', border: '2px dashed #4ade80', background: 'rgba(74,222,128,0.1)',
    display: 'none', zIndex: '2147483647', pointerEvents: 'none'
  });

  const hint = document.createElement('div');
  hint.textContent = 'Click and drag to select area • ESC to cancel';
  Object.assign(hint.style, {
    position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
    zIndex: '2147483647', background: '#1a1a2e', color: '#e0e0e0',
    padding: '8px 16px', borderRadius: '8px', fontSize: '13px',
    fontFamily: '-apple-system, sans-serif', boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
  });

  document.body.appendChild(overlay);
  document.body.appendChild(selection);
  document.body.appendChild(hint);

  let startX, startY, dragging = false;

  overlay.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startY = e.clientY;
    dragging = true;
    selection.style.display = 'block';
    selection.style.left = startX + 'px';
    selection.style.top = startY + 'px';
    selection.style.width = '0';
    selection.style.height = '0';
  });

  overlay.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    selection.style.left = x + 'px';
    selection.style.top = y + 'px';
    selection.style.width = w + 'px';
    selection.style.height = h + 'px';
  });

  overlay.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    const rect = {
      x: Math.min(e.clientX, startX),
      y: Math.min(e.clientY, startY),
      width: Math.abs(e.clientX - startX),
      height: Math.abs(e.clientY - startY),
      dpr: window.devicePixelRatio
    };
    cleanup();
    if (rect.width > 10 && rect.height > 10) {
      chrome.runtime.sendMessage({ action: 'areaSelected', rect: rect });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cleanup();
  });

  function cleanup() {
    overlay.remove();
    selection.remove();
    hint.remove();
  }
})();
