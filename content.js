// content.js — Console error capture for OpenClaw Snap
// Injected on all pages to capture console errors for context

(function() {
  if (window.__openclawSnapInit) return;
  window.__openclawSnapInit = true;
  window.__openclawSnapErrors = [];

  const origError = console.error;
  console.error = function(...args) {
    window.__openclawSnapErrors.push(args.map(a => {
      try { return typeof a === 'string' ? a : JSON.stringify(a); }
      catch { return String(a); }
    }).join(' '));
    // Keep last 20 errors
    if (window.__openclawSnapErrors.length > 20) {
      window.__openclawSnapErrors = window.__openclawSnapErrors.slice(-20);
    }
    origError.apply(console, args);
  };

  // Also capture unhandled errors
  window.addEventListener('error', (e) => {
    window.__openclawSnapErrors.push(`${e.message} (${e.filename}:${e.lineno})`);
  });

  window.addEventListener('unhandledrejection', (e) => {
    window.__openclawSnapErrors.push(`Unhandled Promise: ${e.reason}`);
  });
})();
