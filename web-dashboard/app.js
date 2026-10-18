/* ─── SANGAR Web Dashboard — app.js (Spatial Analysis Network for Geohazard Alert and Resilience) ── */
'use strict';

// ─── CONFIGURATION ──────────────────────────────────────────────────────────
let defaultWsUrl = 'ws://localhost:5000';
if (window.location.protocol && window.location.protocol.startsWith('http')) {
  defaultWsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
}
let WS_URL = localStorage.getItem('sangar_ws_url') || localStorage.getItem('nexsis_ws_url') || defaultWsUrl;
const API_BASE = () => WS_URL.replace('ws://', 'http://').replace('wss://', 'https://');

// ─── STATE ───────────────────────────────────────────────────────────────────
let ws = null;
let isAlarmActive = false;
let eventHistory = [];
let uptimeSeconds = 0;
let uptimeInterval = null;
let wavePhase = 0;
let lastFrameTime = 0;
let animFrameId = null;
let todayEvents = 0;
let lastAlertTime = null;
let startTime = Date.now();

// ─── CANVAS WAVEFORM ─────────────────────────────────────────────────────────
const canvas = document.getElementById('waveform-canvas');
const ctx = canvas.getContext('2d');
const NUM_POINTS = 120;
let wavePoints = Array(NUM_POINTS).fill(null).map((_, i) => i);

function resizeCanvas() {
  const container = document.getElementById('waveform-container');
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
}

function drawWaveform(timestamp) {
  const delta = timestamp - lastFrameTime;
  if (delta >= 33) { // ~30fps
    lastFrameTime = timestamp;
    wavePhase += isAlarmActive ? 0.3 : 0.08;

    const W = canvas.width;
    const H = canvas.height;
    const CY = H / 2;
    const STEP = W / (NUM_POINTS - 1);

    // Shift points
    wavePoints.shift();
    let nextY;
    if (isAlarmActive) {
      const base = Math.sin(wavePhase * 1.5) * (H * 0.28);
      const spike = Math.random() > 0.35 ? (Math.random() - 0.5) * H * 0.55 : 0;
      nextY = CY + base + spike;
      nextY = Math.max(8, Math.min(H - 8, nextY));
    } else {
      const base = Math.sin(wavePhase * 0.6) * (H * 0.04);
      const jitter = (Math.random() - 0.5) * (H * 0.02);
      nextY = CY + base + jitter;
    }
    wavePoints.push(nextY);

    // Draw
    ctx.clearRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const gridSize = 32;
    for (let x = 0; x < W; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Center line
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.setLineDash([4, 8]);
    ctx.beginPath(); ctx.moveTo(0, CY); ctx.lineTo(W, CY); ctx.stroke();
    ctx.setLineDash([]);

    // Waveform
    const color = isAlarmActive ? '#FF6B35' : '#2DD4BF';
    ctx.strokeStyle = color;
    ctx.lineWidth = isAlarmActive ? 2 : 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Glow effect
    ctx.shadowColor = color;
    ctx.shadowBlur = isAlarmActive ? 12 : 6;

    ctx.beginPath();
    ctx.moveTo(0, wavePoints[0]);
    for (let i = 1; i < NUM_POINTS; i++) {
      ctx.lineTo(i * STEP, wavePoints[i]);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  animFrameId = requestAnimationFrame(drawWaveform);
}

// ─── STATUS MANAGEMENT ───────────────────────────────────────────────────────
function setStatus(state) {
  const badge = document.getElementById('status-badge');
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  badge.className = 'status-badge ' + state;
  dot.className = 'status-dot ' + state;
  const labels = { online: 'ONLINE', offline: 'OFFLINE', connecting: 'MENGHUBUNGKAN...' };
  text.textContent = labels[state] || state;
}

// ─── AUDIO SYNTHESIS (WEB AUDIO API) ─────────────────────────────────────────
let audioCtx = null;
let alarmInterval = null;
let activeOscillators = [];

function initAudio() {
  if (audioCtx) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (AudioContext) {
    audioCtx = new AudioContext();
  }
}

function playAlarmSound() {
  initAudio();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  if (alarmInterval) return;

  const playSirenCycle = () => {
    if (!audioCtx || audioCtx.state === 'suspended') return;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    // Sci-fi sweep alarm tone (sawtooth, sweeping frequency)
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(550, audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(950, audioCtx.currentTime + 0.35);
    osc.frequency.linearRampToValueAtTime(550, audioCtx.currentTime + 0.7);
    
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + 0.1);
    gainNode.gain.setValueAtTime(0.12, audioCtx.currentTime + 0.6);
    gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.7);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.7);
    activeOscillators.push(osc);
  };

  playSirenCycle();
  alarmInterval = setInterval(playSirenCycle, 700);
}

function stopAlarmSound() {
  if (alarmInterval) {
    clearInterval(alarmInterval);
    alarmInterval = null;
  }
  activeOscillators.forEach(osc => {
    try { osc.stop(); } catch {}
  });
  activeOscillators = [];
}

// ─── ALARM ───────────────────────────────────────────────────────────────────
function triggerAlarm(event) {
  isAlarmActive = true;
  lastAlertTime = new Date();
  document.getElementById('stat-last-alert').textContent = formatTime(lastAlertTime);
  document.getElementById('alert-title').textContent = '⚠ VIBRASI SEISMIK ANOMALI';
  document.getElementById('alert-detail').textContent = `Sensor ${event.sensor} — ${event.receivedAt}`;
  document.getElementById('alert-banner').style.display = 'block';
  document.getElementById('waveform-label').textContent = '⚠ VIBRASI SEISMIK ANOMALI';
  document.getElementById('waveform-label').classList.add('alert');
  document.getElementById('waveform-panel').style.borderBottom = '2px solid #FF6B35';

  playAlarmSound();

  clearTimeout(window._alarmTimeout);
  window._alarmTimeout = setTimeout(clearAlarm, 8000);
}

function clearAlarm() {
  isAlarmActive = false;
  document.getElementById('alert-banner').style.display = 'none';
  document.getElementById('waveform-label').textContent = '✦ SENSOR STANDBY / MONITORING AKTIF';
  document.getElementById('waveform-label').classList.remove('alert');
  document.getElementById('waveform-panel').style.borderBottom = '';
  
  stopAlarmSound();
}

// ─── HISTORY TABLE ───────────────────────────────────────────────────────────
function addEventToTable(event) {
  eventHistory.unshift(event);
  if (eventHistory.length > 50) eventHistory.pop();
  renderTable();

  // Update stat
  const today = new Date().toDateString();
  if (new Date(event.timestamp).toDateString() === today) {
    todayEvents++;
    document.getElementById('stat-today').textContent = todayEvents;
  }
}

function renderTable() {
  const tbody = document.getElementById('history-tbody');
  const count = document.getElementById('event-count');
  count.textContent = `${eventHistory.length} event${eventHistory.length !== 1 ? 's' : ''}`;

  if (eventHistory.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="5">
          <div class="empty-state">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
              <polyline points="2 12 6 4 10 16 14 8 18 20 22 12"></polyline>
            </svg>
            <span>Belum ada data seismik terdeteksi</span>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = eventHistory.map(ev => {
    const isAlert = ev.status === 'earthquake_detected';
    const badgeClass = isAlert ? 'detected' : 'normal';
    const badgeLabel = isAlert ? 'TERDETEKSI' : 'NORMAL';
    return `
      <tr class="${isAlert ? 'row-alert' : ''}">
        <td class="td-id">${ev.id}</td>
        <td class="td-mono">${ev.sensor || '—'}</td>
        <td>
          <span class="row-status-badge ${badgeClass}">
            <span class="row-status-dot"></span>
            ${badgeLabel}
          </span>
        </td>
        <td class="td-mono">${ev.timestamp ? new Date(ev.timestamp).toLocaleString('id-ID') : '—'}</td>
        <td class="td-mono">${ev.receivedAt || '—'}</td>
      </tr>`;
  }).join('');
}

// ─── WEBSOCKET ───────────────────────────────────────────────────────────────
let reconnectTimer = null;

function connect() {
  if (ws) { ws.close(); ws = null; }
  clearTimeout(reconnectTimer);
  setStatus('connecting');

  const host = document.getElementById('host-value');
  host.textContent = WS_URL.replace('ws://', '').replace('wss://', '');

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      setStatus('online');
      startUptime();
      fetchHistory();
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'earthquake' && msg.data) {
          addEventToTable(msg.data);
          triggerAlarm(msg.data);
        }
      } catch {}
    };

    ws.onclose = () => {
      setStatus('offline');
      stopUptime();
      const autoReconnect = document.getElementById('auto-reconnect')?.checked ?? true;
      if (autoReconnect) {
        reconnectTimer = setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => {
      setStatus('offline');
    };
  } catch (err) {
    setStatus('offline');
  }
}

// ─── HISTORY FETCH ───────────────────────────────────────────────────────────
async function fetchHistory() {
  try {
    const res = await fetch(`${API_BASE()}/history`);
    const data = await res.json();
    if (Array.isArray(data)) {
      data.forEach(ev => {
        if (!eventHistory.find(e => e.id === ev.id)) {
          eventHistory.push(ev);
          const today = new Date().toDateString();
          if (new Date(ev.timestamp).toDateString() === today) todayEvents++;
        }
      });
      eventHistory.sort((a, b) => b.id - a.id);
      renderTable();
      document.getElementById('stat-today').textContent = todayEvents;
    }
  } catch {}
}

// ─── SIMULATE ────────────────────────────────────────────────────────────────
async function simulateEarthquake() {
  const password = prompt('Masukkan password untuk melakukan simulasi:');
  if (password !== 'rafi ganteng') {
    alert('Password salah! Simulasi dibatalkan.');
    return;
  }

  try {
    const r = await fetch(`${API_BASE()}/earthquake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sensor: 'SANGAR-SIM',
        status: 'earthquake_detected',
        password: password
      })
    });
    if (!r.ok) throw new Error('Network error');
  } catch {
    // Simulate locally if server not available
    const mock = {
      id: Date.now(),
      status: 'earthquake_detected',
      sensor: 'SANGAR-SIM',
      timestamp: new Date().toISOString(),
      receivedAt: formatDate(new Date())
    };
    addEventToTable(mock);
    triggerAlarm(mock);
  }
}

// ─── UPTIME ──────────────────────────────────────────────────────────────────
function startUptime() {
  stopUptime();
  startTime = Date.now();
  uptimeInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    document.getElementById('stat-uptime').textContent = formatUptime(elapsed);
  }, 1000);
}
function stopUptime() {
  if (uptimeInterval) { clearInterval(uptimeInterval); uptimeInterval = null; }
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }
function formatDate(d) {
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function formatTime(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
function formatUptime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

// ─── MODAL ───────────────────────────────────────────────────────────────────
function openModal() {
  document.getElementById('modal-overlay').style.display = 'flex';
  document.getElementById('ws-url-input').value = WS_URL;
}
function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
}

// ─── EVENT LISTENERS ─────────────────────────────────────────────────────────
document.getElementById('settings-btn').addEventListener('click', openModal);
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});
document.getElementById('modal-save').addEventListener('click', () => {
  WS_URL = document.getElementById('ws-url-input').value.trim() || WS_URL;
  localStorage.setItem('sangar_ws_url', WS_URL);
  closeModal();
  connect();
});
// ─── SAFETY GUIDE MODAL ──────────────────────────────────────────────────────
function openSafetyModal() {
  document.getElementById('safety-overlay').classList.add('open');
}
function closeSafetyModal() {
  document.getElementById('safety-overlay').classList.remove('open');
}
window.toggleAcc = function(card) {
  const isOpen = card.classList.contains('open');
  document.querySelectorAll('#safety-overlay .acc-card').forEach(c => {
    c.classList.remove('open');
  });
  if (!isOpen) {
    card.classList.add('open');
  }
};

document.getElementById('safety-btn').addEventListener('click', openSafetyModal);
document.getElementById('safety-close').addEventListener('click', closeSafetyModal);

document.getElementById('alert-dismiss').addEventListener('click', clearAlarm);
document.getElementById('simulate-btn').addEventListener('click', simulateEarthquake);
document.getElementById('clear-btn').addEventListener('click', () => {
  eventHistory = [];
  todayEvents = 0;
  document.getElementById('stat-today').textContent = '0';
  renderTable();
});

window.addEventListener('resize', () => {
  resizeCanvas();
});

// ─── MOBILE AUDIO UNLOCK ──────────────────────────────────────────────────────
// Mobile browsers (Chrome/Safari) block AudioContext until a user gesture.
// We unlock it on the very first touch or click anywhere on the page.
const unlockAudio = () => {
  initAudio();
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  // Hide the toast
  const toast = document.getElementById('audio-toast');
  if (toast) {
    toast.classList.add('hidden');
    setTimeout(() => toast.remove(), 600);
  }
  window.removeEventListener('touchstart', unlockAudio);
  window.removeEventListener('click', unlockAudio);
};
window.addEventListener('touchstart', unlockAudio, { once: true });
window.addEventListener('click', unlockAudio, { once: true });

// ─── FCM PUSH BRIDGE ──────────────────────────────────────────────────────────
// firebase.js dispatches this custom event when a foreground FCM push arrives.
window.addEventListener('sangar:earthquake', (e) => {
  const event = e.detail;
  addEventToTable(event);
  triggerAlarm(event);
});

// ─── INIT ─────────────────────────────────────────────────────────────────────
resizeCanvas();
requestAnimationFrame(drawWaveform);
connect();
