/* ─── SANGAR Firebase Web Client — firebase.js ────────────────────────────
 * (SANGAR: Spatial Analysis Network for Geohazard Alert and Resilience)
 * Uses the Firebase CDN (ES module build) — no bundler required.
 * Loaded via <script type="module"> in index.html.
 * ────────────────────────────────────────────────────────────────────────── */

import { initializeApp }   from 'https://www.gstatic.com/firebasejs/11.9.0/firebase-app.js';
import { getAnalytics, logEvent } from 'https://www.gstatic.com/firebasejs/11.9.0/firebase-analytics.js';
import {
  getMessaging,
  getToken,
  onMessage,
} from 'https://www.gstatic.com/firebasejs/11.9.0/firebase-messaging.js';

// ─── Firebase Project Configuration ─────────────────────────────────────────
const firebaseConfig = {
  apiKey:            'AIzaSyDLYaXHG9mtw_YzWlNccvOldm9ODrKmJLQ',
  authDomain:        'nexsis-da1b2.firebaseapp.com',
  projectId:         'nexsis-da1b2',
  storageBucket:     'nexsis-da1b2.firebasestorage.app',
  messagingSenderId: '222025975056',
  appId:             '1:222025975056:web:78de139b0da20f88bbd195',
  measurementId:     'G-0ZBKR85D09',
};

// ─── Initialize App & Analytics ─────────────────────────────────────────────
const firebaseApp = initializeApp(firebaseConfig);
const analytics   = getAnalytics(firebaseApp);

logEvent(analytics, 'dashboard_opened', {
  timestamp: new Date().toISOString(),
});

console.log('[Firebase] App & Analytics initialized for project:', firebaseConfig.projectId);

// ─── Cloud Messaging (FCM) — foreground notifications ───────────────────────
let messaging = null;

try {
  messaging = getMessaging(firebaseApp);

  // Listen for incoming FCM messages while the dashboard tab is open/focused.
  onMessage(messaging, (payload) => {
    console.log('[FCM] Foreground message received:', payload);

    const { title, body } = payload.notification ?? {};
    const data = payload.data ?? {};

    // Build a synthetic earthquake event from the FCM push payload so the
    // dashboard reacts the same way it would from a WebSocket message.
    const event = {
      id:         data.id         ?? Date.now(),
      status:     data.status     ?? 'earthquake_detected',
      sensor:     data.sensor     ?? 'FCM-PUSH',
      timestamp:  data.timestamp  ?? new Date().toISOString(),
      receivedAt: data.receivedAt ?? new Date().toLocaleString('id-ID'),
    };

    // Dispatch a custom DOM event so app.js can stay decoupled from Firebase.
    window.dispatchEvent(new CustomEvent('sangar:earthquake', { detail: event }));

    // Also show a native browser notification if the tab is in the background
    if (document.hidden && Notification.permission === 'granted') {
      new Notification(title ?? '⚠ Getaran Terdeteksi', {
        body: body ?? `Sensor ${event.sensor} — ${event.receivedAt}`,
        icon: '/favicon.png',
        tag:  'sangar-alert',
      });
    }
  });

  console.log('[FCM] Foreground message listener registered.');
} catch (err) {
  // Messaging requires HTTPS and a service worker; silently degrade on HTTP
  console.warn('[FCM] Messaging unavailable (likely HTTP or missing SW):', err.message);
}

// ─── Request notification permission ────────────────────────────────────────
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission().then((perm) => {
    console.log('[Notification] Permission:', perm);
    logEvent(analytics, 'notification_permission', { permission: perm });
  });
}

// ─── Exports for optional use in app.js ─────────────────────────────────────
export { firebaseApp, analytics, messaging };
