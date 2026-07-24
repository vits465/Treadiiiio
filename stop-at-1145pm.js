const http = require('http');

function stopServicesAt1145PM() {
  const now = new Date();
  const target = new Date();
  target.setHours(23, 45, 0, 0); // 11:45:00 PM today

  let delayMs = target.getTime() - now.getTime();
  if (delayMs < 0) {
    console.log("[11:45 PM Auto-Stop] Target time 11:45 PM has already passed for today.");
    return;
  }

  const minutesRemaining = (delayMs / (1000 * 60)).toFixed(1);
  console.log(`[11:45 PM Auto-Stop] Scheduled bot auto-pause and stop in ${minutesRemaining} minutes (at 11:45 PM local time).`);

  setTimeout(() => {
    console.log(`[11:45 PM Auto-Stop] 11:45 PM reached! Sending pause signal to Trading Bot Engine...`);
    
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
      console.log(`[11:45 PM Auto-Stop] Engine paused successfully (status code ${res.statusCode}).`);
    });

    req.on('error', (err) => {
      console.error('[11:45 PM Auto-Stop] Error calling pause API:', err.message);
    });

    req.end();
  }, delayMs);
}

stopServicesAt1145PM();
