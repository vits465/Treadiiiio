const http = require('http');
const { exec } = require('child_process');

const DURATION_MINUTES = 120;
const DURATION_MS = DURATION_MINUTES * 60 * 1000;
const startTime = new Date();
const stopTime = new Date(startTime.getTime() + DURATION_MS);

console.log(`========================================================`);
console.log(` [AUTO-STOP TIMER] Trading Bot run timer started.`);
console.log(` Start Time: ${startTime.toLocaleTimeString()}`);
console.log(` Target Stop Time: ${stopTime.toLocaleTimeString()} (${DURATION_MINUTES} minutes / 2 hours)`);
console.log(`========================================================`);

// Unpause/start bot engine via API right away to ensure it's actively running
const startReq = http.request({
  hostname: 'localhost',
  port: 4000,
  path: '/api/bot/start',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'a3f7c9d2e1b4f6a8c0d5e7f9b2a4c6d8'
  }
}, (res) => {
  console.log(`[AUTO-STOP TIMER] Engine started/unpaused successfully (status code ${res.statusCode}).`);
});

startReq.on('error', (err) => {
  console.warn('[AUTO-STOP TIMER] Warning: Could not send start signal to bot API (may still be initializing):', err.message);
});

startReq.end();

// Timer to log progress every 30 minutes
const interval = setInterval(() => {
  const elapsedMinutes = Math.floor((Date.now() - startTime.getTime()) / (1000 * 60));
  const remainingMinutes = DURATION_MINUTES - elapsedMinutes;
  if (remainingMinutes > 0) {
    console.log(`[AUTO-STOP TIMER] ${elapsedMinutes} minutes elapsed. ${remainingMinutes} minutes remaining...`);
  }
}, 30 * 60 * 1000);

// Target timer for 2 hours
setTimeout(() => {
  clearInterval(interval);
  console.log(`\n========================================================`);
  console.log(` [AUTO-STOP TIMER] 2 HOURS REACHED!`);
  console.log(` Stopping bot services now (${new Date().toLocaleTimeString()})...`);
  console.log(`========================================================\n`);

  // 1. Send pause command to bot REST API
  const req = http.request({
    hostname: 'localhost',
    port: 4000,
    path: '/api/bot/pause',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'a3f7c9d2e1b4f6a8c0d5e7f9b2a4c6d8'
    }
  }, (res) => {
    console.log(`[AUTO-STOP TIMER] Bot engine paused via API (status code ${res.statusCode}).`);
  });

  req.on('error', (err) => {
    console.error('[AUTO-STOP TIMER] Error calling pause API:', err.message);
  });

  req.end();

  // 2. Stop PM2 daemon/apps
  exec('npx pm2 stop ecosystem.config.js', (err, stdout, stderr) => {
    if (err) {
      console.error('[AUTO-STOP TIMER] Error stopping PM2 processes:', err.message);
    } else {
      console.log('[AUTO-STOP TIMER] PM2 processes successfully stopped.');
      console.log(stdout);
    }
    process.exit(0);
  });
}, DURATION_MS);
