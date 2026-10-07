const http = require('http');

function stopBotAt5AM() {
  const now = new Date();
  const target = new Date();
  target.setHours(5, 0, 0, 0); // 5:00:00 AM
  
  if (now.getTime() >= target.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  
  const delayMs = target.getTime() - now.getTime();
  const hoursRemaining = (delayMs / (1000 * 60 * 60)).toFixed(2);
  console.log(`[5AM Auto-Stop] Scheduled bot auto-pause in ${hoursRemaining} hours (at 5:00 AM local time).`);

  setTimeout(() => {
    console.log(`[5AM Auto-Stop] 5:00 AM reached! Sending pause signal to Trading Bot Engine...`);
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
      console.log(`[5AM Auto-Stop] Engine paused successfully (status code ${res.statusCode}).`);
    });

    req.on('error', (err) => {
      console.error('[5AM Auto-Stop] Error calling pause API:', err.message);
    });

    req.end();
  }, delayMs);
}

stopBotAt5AM();
