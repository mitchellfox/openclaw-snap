// annotate.js — Canvas annotation editor for OpenClaw Snap

let bgCanvas, drawCanvas, bgCtx, drawCtx;
let image = null;
let context = {};
let annotations = []; // {type, color, strokeWidth, ...}
let currentTool = 'select';
let currentColor = '#ff3b3b';
let currentStrokeWidth = 3;
let drawing = false;
let startX = 0, startY = 0;
let selectedIndex = -1;
let dragOffsetX = 0, dragOffsetY = 0;
let textInput = null;

// Init
document.addEventListener('DOMContentLoaded', async () => {
  bgCanvas = document.getElementById('bgCanvas');
  drawCanvas = document.getElementById('drawCanvas');
  bgCtx = bgCanvas.getContext('2d');
  drawCtx = drawCanvas.getContext('2d');

  // Load snap data from storage
  const data = await chrome.storage.local.get('snapData');
  if (!data.snapData) {
    document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#f87171">No screenshot data found. Capture a screenshot first.</div>';
    return;
  }

  context = data.snapData.context || {};

  // Load image
  image = new Image();
  image.onload = () => {
    const cropRect = context._cropRect;
    let imgW = image.width, imgH = image.height;

    if (cropRect) {
      // Crop the image
      const dpr = cropRect.dpr || 1;
      const sx = cropRect.x * dpr, sy = cropRect.y * dpr;
      const sw = cropRect.width * dpr, sh = cropRect.height * dpr;

      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = sw;
      tmpCanvas.height = sh;
      const tmpCtx = tmpCanvas.getContext('2d');
      tmpCtx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);

      // Replace image data
      const croppedImg = new Image();
      croppedImg.onload = () => {
        image = croppedImg;
        setupCanvas(sw, sh);
      };
      croppedImg.src = tmpCanvas.toDataURL();
      return;
    }

    setupCanvas(imgW, imgH);
  };
  image.src = data.snapData.image;

  // Tool selection
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
      drawCanvas.style.cursor = currentTool === 'select' ? 'default' : 'crosshair';
      selectedIndex = -1;
      redraw();
    });
  });

  document.getElementById('colorPicker').addEventListener('input', (e) => {
    currentColor = e.target.value;
  });
  document.getElementById('strokeWidth').addEventListener('change', (e) => {
    currentStrokeWidth = parseInt(e.target.value);
  });

  document.getElementById('undoBtn').addEventListener('click', () => {
    annotations.pop();
    selectedIndex = -1;
    redraw();
  });
  document.getElementById('clearBtn').addEventListener('click', () => {
    annotations = [];
    selectedIndex = -1;
    redraw();
  });
  document.getElementById('deleteBtn').addEventListener('click', () => {
    if (selectedIndex >= 0) {
      annotations.splice(selectedIndex, 1);
      selectedIndex = -1;
      redraw();
    }
  });

  document.getElementById('cancelBtn').addEventListener('click', () => {
    window.close();
  });

  document.getElementById('sendBtn').addEventListener('click', sendScreenshot);

  // Voice-to-text
  setupVoice();
});

function setupCanvas(w, h) {
  // Scale to fit viewport
  const container = document.getElementById('canvasContainer');
  const maxW = container.clientWidth;
  const maxH = container.clientHeight;
  const scale = Math.min(1, maxW / w, maxH / h);

  const displayW = Math.floor(w * scale);
  const displayH = Math.floor(h * scale);

  bgCanvas.width = w;
  bgCanvas.height = h;
  bgCanvas.style.width = displayW + 'px';
  bgCanvas.style.height = displayH + 'px';

  drawCanvas.width = w;
  drawCanvas.height = h;
  drawCanvas.style.width = displayW + 'px';
  drawCanvas.style.height = displayH + 'px';

  // Store scale for coordinate mapping
  drawCanvas._scale = w / displayW;

  bgCtx.drawImage(image, 0, 0);

  // Mouse events
  drawCanvas.addEventListener('mousedown', onMouseDown);
  drawCanvas.addEventListener('mousemove', onMouseMove);
  drawCanvas.addEventListener('mouseup', onMouseUp);
  drawCanvas.addEventListener('dblclick', onDblClick);
}

function canvasCoords(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const scale = drawCanvas._scale || 1;
  return {
    x: (e.clientX - rect.left) * scale,
    y: (e.clientY - rect.top) * scale
  };
}

function onMouseDown(e) {
  const { x, y } = canvasCoords(e);
  startX = x;
  startY = y;

  if (currentTool === 'select') {
    // Try to select an annotation
    selectedIndex = -1;
    for (let i = annotations.length - 1; i >= 0; i--) {
      if (hitTest(annotations[i], x, y)) {
        selectedIndex = i;
        const a = annotations[i];
        if (a.type === 'rect') {
          dragOffsetX = x - a.x;
          dragOffsetY = y - a.y;
        } else if (a.type === 'arrow') {
          dragOffsetX = x - a.x1;
          dragOffsetY = y - a.y1;
        } else if (a.type === 'text') {
          dragOffsetX = x - a.x;
          dragOffsetY = y - a.y;
        }
        drawing = true;
        redraw();
        return;
      }
    }
    redraw();
    return;
  }

  if (currentTool === 'text') {
    // Create text input at click position
    createTextInput(x, y);
    return;
  }

  drawing = true;
}

function onMouseMove(e) {
  if (!drawing) return;
  const { x, y } = canvasCoords(e);

  if (currentTool === 'select' && selectedIndex >= 0) {
    const a = annotations[selectedIndex];
    if (a.type === 'rect') {
      a.x = x - dragOffsetX;
      a.y = y - dragOffsetY;
    } else if (a.type === 'arrow') {
      const dx = x - dragOffsetX - a.x1;
      const dy = y - dragOffsetY - a.y1;
      a.x1 += dx; a.y1 += dy;
      a.x2 += dx; a.y2 += dy;
      dragOffsetX = x - a.x1;
      dragOffsetY = y - a.y1;
    } else if (a.type === 'text') {
      a.x = x - dragOffsetX;
      a.y = y - dragOffsetY;
    }
    redraw();
    return;
  }

  // Preview
  redraw();
  drawCtx.save();
  if (currentTool === 'rect') {
    drawCtx.strokeStyle = currentColor;
    drawCtx.lineWidth = currentStrokeWidth;
    drawCtx.strokeRect(startX, startY, x - startX, y - startY);
  } else if (currentTool === 'arrow') {
    drawArrow(drawCtx, startX, startY, x, y, currentColor, currentStrokeWidth);
  }
  drawCtx.restore();
}

function onMouseUp(e) {
  if (!drawing) return;
  drawing = false;
  const { x, y } = canvasCoords(e);

  if (currentTool === 'select') {
    redraw();
    return;
  }

  if (currentTool === 'rect') {
    const w = x - startX, h = y - startY;
    if (Math.abs(w) > 5 && Math.abs(h) > 5) {
      annotations.push({
        type: 'rect',
        x: Math.min(startX, x), y: Math.min(startY, y),
        w: Math.abs(w), h: Math.abs(h),
        color: currentColor, strokeWidth: currentStrokeWidth
      });
    }
  } else if (currentTool === 'arrow') {
    const dist = Math.hypot(x - startX, y - startY);
    if (dist > 10) {
      annotations.push({
        type: 'arrow',
        x1: startX, y1: startY, x2: x, y2: y,
        color: currentColor, strokeWidth: currentStrokeWidth
      });
    }
  }

  redraw();
}

function onDblClick(e) {
  if (currentTool !== 'select') return;
  const { x, y } = canvasCoords(e);
  for (let i = annotations.length - 1; i >= 0; i--) {
    if (annotations[i].type === 'text' && hitTest(annotations[i], x, y)) {
      // Edit existing text
      const a = annotations[i];
      createTextInput(a.x, a.y, a.text, i);
      return;
    }
  }
}

function hitTest(a, x, y) {
  if (a.type === 'rect') {
    return x >= a.x - 5 && x <= a.x + a.w + 5 && y >= a.y - 5 && y <= a.y + a.h + 5;
  } else if (a.type === 'arrow') {
    // Distance from point to line segment
    const d = distToSegment(x, y, a.x1, a.y1, a.x2, a.y2);
    return d < 15;
  } else if (a.type === 'text') {
    drawCtx.font = `600 ${a.fontSize || 16}px -apple-system, sans-serif`;
    const tw = drawCtx.measureText(a.text).width;
    return x >= a.x - 5 && x <= a.x + tw + 5 && y >= a.y - 20 && y <= a.y + 10;
  }
  return false;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function createTextInput(x, y, existingText, editIndex) {
  if (textInput) textInput.remove();

  const container = document.getElementById('canvasContainer');
  const canvasRect = drawCanvas.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const scale = drawCanvas._scale || 1;

  // Position relative to the container, accounting for canvas offset within container
  const screenX = canvasRect.left - containerRect.left + (x / scale);
  const screenY = canvasRect.top - containerRect.top + (y / scale) - 10;

  const input = document.createElement('input');
  input.className = 'text-input-overlay';
  input.type = 'text';
  input.value = existingText || '';
  input.style.left = screenX + 'px';
  input.style.top = screenY + 'px';
  input.style.color = currentColor;
  input.style.fontSize = (16 / scale) + 'px';

  container.style.position = 'relative'; // ensure positioned parent
  container.appendChild(input);

  // Small delay to prevent the click from immediately blurring
  setTimeout(() => input.focus(), 50);
  textInput = input;

  const commit = () => {
    const text = input.value.trim();
    if (text) {
      if (editIndex !== undefined) {
        annotations[editIndex].text = text;
        annotations[editIndex].color = currentColor;
      } else {
        annotations.push({
          type: 'text', x, y, text,
          color: currentColor, fontSize: 16
        });
      }
    }
    input.remove();
    textInput = null;
    redraw();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') { input.remove(); textInput = null; }
  });
  input.addEventListener('blur', commit);
}

function redraw() {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

  annotations.forEach((a, i) => {
    drawCtx.save();
    const isSelected = i === selectedIndex;

    if (a.type === 'rect') {
      if (isSelected) {
        drawCtx.strokeStyle = '#fff';
        drawCtx.lineWidth = a.strokeWidth + 2;
        drawCtx.setLineDash([5, 3]);
        drawCtx.strokeRect(a.x - 1, a.y - 1, a.w + 2, a.h + 2);
        drawCtx.setLineDash([]);
      }
      drawCtx.strokeStyle = a.color;
      drawCtx.lineWidth = a.strokeWidth;
      drawCtx.strokeRect(a.x, a.y, a.w, a.h);
    } else if (a.type === 'arrow') {
      if (isSelected) {
        drawArrow(drawCtx, a.x1, a.y1, a.x2, a.y2, '#fff', a.strokeWidth + 2);
      }
      drawArrow(drawCtx, a.x1, a.y1, a.x2, a.y2, a.color, a.strokeWidth);
    } else if (a.type === 'text') {
      drawCtx.font = `600 ${a.fontSize || 16}px -apple-system, sans-serif`;
      if (isSelected) {
        const tw = drawCtx.measureText(a.text).width;
        drawCtx.strokeStyle = '#fff';
        drawCtx.lineWidth = 1;
        drawCtx.setLineDash([3, 2]);
        drawCtx.strokeRect(a.x - 3, a.y - a.fontSize, tw + 6, a.fontSize + 6);
        drawCtx.setLineDash([]);
      }
      // Text shadow for readability
      drawCtx.fillStyle = 'rgba(0,0,0,0.7)';
      drawCtx.fillText(a.text, a.x + 1, a.y + 1);
      drawCtx.fillStyle = a.color;
      drawCtx.fillText(a.text, a.x, a.y);
    }

    drawCtx.restore();
  });
}

function drawArrow(ctx, x1, y1, x2, y2, color, width) {
  const headLen = Math.max(15, width * 5);
  const angle = Math.atan2(y2 - y1, x2 - x1);

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';

  // Line
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - 0.4), y2 - headLen * Math.sin(angle - 0.4));
  ctx.lineTo(x2 - headLen * Math.cos(angle + 0.4), y2 - headLen * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();
}

// Voice-to-text
function setupVoice() {
  const btn = document.getElementById('voiceBtn');
  const status = document.getElementById('voiceStatus');
  const notesInput = document.getElementById('notesInput');

  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    btn.style.display = 'none';
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let isRecording = false;

  btn.addEventListener('click', () => {
    if (isRecording) {
      recognition.stop();
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = notesInput.value;
    if (finalTranscript && !finalTranscript.endsWith(' ')) finalTranscript += ' ';

    recognition.onstart = () => {
      isRecording = true;
      btn.classList.add('recording');
      status.textContent = '🔴 Listening...';
    };

    recognition.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalTranscript += e.results[i][0].transcript;
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      notesInput.value = finalTranscript + interim;
    };

    recognition.onend = () => {
      isRecording = false;
      btn.classList.remove('recording');
      status.textContent = '';
      notesInput.value = finalTranscript;
    };

    recognition.onerror = (e) => {
      isRecording = false;
      btn.classList.remove('recording');
      status.textContent = '⚠️ ' + e.error;
    };

    recognition.start();
  });
}

// Send to OpenClaw
async function sendScreenshot() {
  const sendBtn = document.getElementById('sendBtn');
  const statusEl = document.getElementById('sendStatus');
  sendBtn.disabled = true;
  statusEl.className = 'send-status sending';
  statusEl.textContent = '📤 Sending to OpenClaw...';

  try {
    // Composite the final image
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = bgCanvas.width;
    finalCanvas.height = bgCanvas.height;
    const fCtx = finalCanvas.getContext('2d');
    fCtx.drawImage(bgCanvas, 0, 0);
    fCtx.drawImage(drawCanvas, 0, 0);

    const imageData = finalCanvas.toDataURL('image/png');
    const notes = document.getElementById('notesInput').value;

    const result = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'sendToOpenClaw',
        imageData,
        context,
        notes
      }, resolve);
    });

    if (result && result.success) {
      statusEl.className = 'send-status success';
      statusEl.textContent = '✅ Sent to OpenClaw!';
      setTimeout(() => window.close(), 1500);
    } else {
      throw new Error(result?.error || 'Unknown error');
    }
  } catch (e) {
    statusEl.className = 'send-status error';
    statusEl.textContent = '❌ ' + e.message;
    sendBtn.disabled = false;
  }
}
