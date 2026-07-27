const http = require('http');
const { exec } = require('child_process');

function scheduleStopAt12PM() {
  const now = new Date();
  let target = new Date();
  target.setHours(12, 0, 0, 0); // 12:00:00 PM (Noon)

  // If 12:00 PM today has already passed, set target to 12:00 PM tomorrow
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  const delayMs = target.getTime() - now.getTime();
  const totalMinutesRemaining = (delayMs / (1000 * 60)).toFixed(1);
  const totalHoursRemaining = (delayMs / (1000 * 60 * 60)).toFixed(2);

  console.log(`========================================================`);
  console.log(` [AUTO-STOP TIMER] Trading Bot Auto-Stop Scheduled`);
  console.log(` Current Time:      ${now.toLocaleString()}`);
  console.log(` Target Stop Time: ${target.toLocaleString()} (12:00 PM)`);
  console.log(` Remaining Time:   ${totalHoursRemaining} hours (${totalMinutesRemaining} minutes)`);
  console.log(`========================================================`);

  // Unpause/start bot engine via API right away to ensure it's actively running
  setTimeout(() => {
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
      console.warn('[AUTO-STOP TIMER] Warning: Could not send start signal to bot API yet:', err.message);
    });

    startReq.end();
  }, 5000); // 5 second initial delay to allow server startup

  // Periodic log every 30 minutes
  const interval = setInterval(() => {
    const current = new Date();
    const remainingMs = target.getTime() - current.getTime();
    if (remainingMs > 0) {
      const remainingMins = (remainingMs / (1000 * 60)).toFixed(1);
      const remainingHrs = (remainingMs / (1000 * 60 * 60)).toFixed(2);
      console.log(`[AUTO-STOP TIMER] Bot is running. Time remaining until 12:00 PM stop: ${remainingHrs} hours (${remainingMins} mins).`);
    }
  }, 30 * 60 * 1000);

  // Stop timer trigger
  setTimeout(() => {
    clearInterval(interval);
    console.log(`\n========================================================`);
    console.log(` [AUTO-STOP TIMER] TARGET TIME 12:00 PM REACHED!`);
    console.log(` Stopping bot services now (${new Date().toLocaleString()})...`);
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

    // 2. Stop PM2 processes
    exec('npx pm2 stop ecosystem.config.js', (err, stdout, stderr) => {
      if (err) {
        console.error('[AUTO-STOP TIMER] Error stopping PM2 processes:', err.message);
      } else {
        console.log('[AUTO-STOP TIMER] PM2 processes successfully stopped.');
        console.log(stdout);
      }
      process.exit(0);
    });
  }, delayMs);
}

scheduleStopAt12PM();
