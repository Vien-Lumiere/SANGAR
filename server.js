const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const path = require('path');

const PORT = process.env.PORT || 5000;
const FCM_TOPIC = 'sangar-alerts';

// 1. Initialize Firebase Admin SDK
let messaging = null;
let firebaseKey = null;

if (process.env.FIREBASE_KEY) {
  try {
    firebaseKey = JSON.parse(process.env.FIREBASE_KEY);
  } catch (parseError) {
    console.error('CRITICAL: Failed to parse FIREBASE_KEY environment variable as JSON.');
    console.error(parseError);
  }
} else {
  const fs = require('fs');
  const potentialPaths = [
    path.join(__dirname, 'firebase-key.json'),
    path.join(__dirname, 'sangar-firebase-adminsdk.json'),
    path.join(__dirname, 'nexsis-da1b2-firebase-adminsdk-fbsvc-c9f83bb248.json'),
    path.join(__dirname, 'nexsis-68baa-firebase-adminsdk-fbsvc-d10f373e90.json')
  ];

  for (const keyPath of potentialPaths) {
    if (fs.existsSync(keyPath)) {
      try {
        const fileContent = fs.readFileSync(keyPath, 'utf8');
        // Handle files containing multiple JSON objects (like appended device mock payloads)
        // by taking only the first valid JSON block
        const cleanContent = fileContent.trim().split(/\n\s*\n|\n(?={)/)[0];
        firebaseKey = JSON.parse(cleanContent);
        console.log(`Successfully loaded Firebase credential key from ${path.basename(keyPath)}.`);
        break;
      } catch (err) {
        console.warn(`Attempted to load key from ${path.basename(keyPath)} but failed:`, err.message);
      }
    }
  }
}

if (firebaseKey) {
  try {
    const firebaseApp = initializeApp({
      credential: cert(firebaseKey)
    });
    messaging = getMessaging(firebaseApp);
    console.log('Firebase Admin SDK initialized successfully.');
  } catch (error) {
    console.error('CRITICAL: Failed to initialize Firebase Admin SDK.');
    console.error(error);
  }
} else {
  console.warn('WARNING: Firebase credentials not found (env or local). FCM push notifications will be disabled.');
}

const app = express();
app.use(express.json());

// Serve static assets for the dashboards
app.use(express.static(path.join(__dirname, 'web-dashboard')));
app.use('/mobile', express.static(path.join(__dirname, 'mobile-ui')));

// Enable CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// In-memory earthquake history
const earthquakeHistory = [
  {
    id: 1234567800,
    status: 'earthquake_detected',
    sensor: 'SANGAR-A1',
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    receivedAt: formatDate(new Date(Date.now() - 3600000)),
  },
  {
    id: 1234567801,
    status: 'earthquake_detected',
    sensor: 'SANGAR-B2',
    timestamp: new Date(Date.now() - 7200000).toISOString(),
    receivedAt: formatDate(new Date(Date.now() - 7200000)),
  }
];

function formatDate(date) {
  const pad = (num) => String(num).padStart(2, '0');
  const d = pad(date.getDate());
  const m = pad(date.getMonth() + 1);
  const y = date.getFullYear();
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${d}/${m}/${y} ${h}:${min}:${s}`;
}

// 2. GET /history - Fetch last 10-50 earthquake records
app.get('/history', (req, res) => {
  res.json(earthquakeHistory);
});

// 3. POST /earthquake - Incoming event from ESP8266 or simulated trigger
app.post('/earthquake', (req, res) => {
  const body = req.body || {};

  // Check if it's a simulated event (contains 'sim' or 'test' in sensor name)
  const isSimulation = body.sensor && (
    body.sensor.toLowerCase().includes('sim') ||
    body.sensor.toLowerCase().includes('test')
  );

  if (isSimulation) {
    if (body.password !== 'rafi ganteng') {
      return res.status(403).json({ ok: false, message: 'Password salah untuk melakukan simulasi.' });
    }
  }

  const newEvent = {
    id: body.id || Date.now(),
    status: body.status || 'earthquake_detected',
    sensor: body.sensor || 'SANGAR',
    timestamp: body.timestamp || new Date().toISOString(),
    receivedAt: formatDate(new Date()),
  };

  // Add to history
  earthquakeHistory.unshift(newEvent);
  if (earthquakeHistory.length > 50) {
    earthquakeHistory.pop();
  }

  // Trigger WebSocket and FCM broadcast
  handleEarthquakeEvent(newEvent);

  res.status(201).json({ ok: true, message: 'Earthquake event processed.', event: newEvent });
});

// Create HTTP Server
const server = http.createServer(app);

// 4. WebSocket Server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket.');
  ws.on('close', () => {
    console.log('Client disconnected.');
  });
});

// Core logic to handle incoming events
function handleEarthquakeEvent(event) {
  // A. Broadcast via WebSocket (Foreground clients)
  const payload = JSON.stringify({
    type: 'earthquake',
    data: event,
  });

  console.log(`\n[EVENT RECEIVED]: Sensor ${event.sensor} at ${event.receivedAt}`);
  
  let wsCount = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
      wsCount++;
    }
  });
  console.log(`- Broadcasted via WebSocket to ${wsCount} client(s).`);

  // B. Send FCM Push Notification (Background/Locked clients)
  if (messaging) {
    const fcmMessage = {
      notification: {
        title: '⚠ Getaran Terdeteksi',
        body: `Sensor ${event.sensor} — ${event.receivedAt}`,
      },
      topic: FCM_TOPIC,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'sangar-alerts',
        }
      }
    };

    messaging.send(fcmMessage)
      .then((response) => {
        console.log('- FCM notification broadcast successfully:', response);
      })
      .catch((error) => {
        console.warn('- Failed to send FCM notification:', error.message);
      });
  } else {
    console.warn('- FCM Messaging is not initialized, skipping notification.');
  }
}

// Start Server
server.listen(PORT, () => {
  console.log(`=================================================`);
  console.log('SANGAR Backend Server running on port 5000');
  console.log(`API URL: http://localhost:${PORT}`);
  console.log(`WS URL:  ws://localhost:${PORT}`);
  console.log(`=================================================`);
  console.log(`Commands:`);
  console.log(`- Press [ENTER] key in this terminal to simulate and broadcast a new earthquake alert.`);
  console.log(`=================================================`);
});

// Listen to keyboard inputs on stdin to simulate alerts (local dev only)
if (process.stdin.isTTY) {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (data) => {
    if (data.trim() === '') {
      const mockEvent = {
        id: Date.now(),
        status: 'earthquake_detected',
        sensor: 'SANGAR-SIM',
        timestamp: new Date().toISOString(),
        receivedAt: formatDate(new Date()),
      };
      earthquakeHistory.unshift(mockEvent);
      if (earthquakeHistory.length > 50) {
        earthquakeHistory.pop();
      }
      handleEarthquakeEvent(mockEvent);
    }
  });
  console.log('- Press [ENTER] to simulate a seismic alert.');
} else {
  console.log('- Stdin simulation disabled (non-TTY / cloud environment).');
  console.log(`- POST /earthquake to trigger an event programmatically.`);
}
