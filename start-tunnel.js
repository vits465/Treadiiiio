/**
 * start-tunnel.js
 * Self-healing permanent localtunnel process manager.
 * Auto-restarts if localtunnel drops, returns 502/503, or times out.
 * Drains response streams to prevent Node.js socket timeouts.
 */
const { spawn } = require('child_process');
const https = require('https');

let tunnelProcess = null;
let healthCheckInterval = null;
let isRestarting = false;
let activeUrl = '';

function startTunnel() {
  if (isRestarting) return;
  
  console.log('[TUNNEL] Starting localtunnel on port 4000 (subdomain: treadiiiio-bot-8877)...');
  
  tunnelProcess = spawn(
    'npx',
    ['localtunnel', '--port', '4000', '--subdomain', 'treadiiiio-bot-8877'],
    { shell: true }
  );

  tunnelProcess.stdout.on('data', (data) => {
    const text = data.toString();
    process.stdout.write(text); // print stdout to terminal

    const match = text.match(/your url is:\s+(https:\/\/[a-zA-Z0-9\-\.]+)/i);
    if (match) {
      activeUrl = match[1].trim();
      console.log(`\n[TUNNEL] Handshake completed. Active URL: ${activeUrl}`);
      if (activeUrl !== 'https://treadiiiio-bot-8877.loca.lt') {
        console.warn(`[TUNNEL WARNING] Could not bind to target subdomain. Using fallback: ${activeUrl}`);
      }
      startHealthCheck();
    }
  });

  tunnelProcess.stderr.on('data', (data) => {
    process.stderr.write(data.toString());
  });

  tunnelProcess.on('close', (code) => {
    console.log(`[TUNNEL] Localtunnel process exited with code ${code}.`);
    cleanupAndScheduleRestart();
  });

  tunnelProcess.on('error', (err) => {
    console.error('[TUNNEL] Localtunnel error:', err.message);
    cleanupAndScheduleRestart();
  });
}

function cleanupAndScheduleRestart() {
  if (isRestarting) return;
  isRestarting = true;

  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
  
  activeUrl = '';

  console.log('[TUNNEL] Restarting localtunnel in 7 seconds...');
  setTimeout(() => {
    isRestarting = false;
    startTunnel();
  }, 7000);
}

function startHealthCheck() {
  if (healthCheckInterval) clearInterval(healthCheckInterval);
  if (!activeUrl) return;

  // Wait 15 seconds after startup before starting checks to let it settle
  setTimeout(() => {
    if (isRestarting || !activeUrl) return;
    
    healthCheckInterval = setInterval(() => {
      if (isRestarting || !activeUrl) return;

      const targetUrl = `${activeUrl}/api/config`;
      
      const req = https.get(targetUrl, {
        headers: {
          'x-api-key': 'a3f7c9d2e1b4f6a8c0d5e7f9b2a4c6d8',
          'Bypass-Tunnel-Reminder': 'true',
          'bypass-tunnel-reminder': 'true',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      }, (res) => {
        // DRAIN RESPONSE STREAM TO PREVENT SOCKET TIMEOUT HANGS
        res.resume();

        if (res.statusCode === 200) {
          // Tunnel is healthy!
          return;
        }
        console.warn(`[TUNNEL HEALTH] Unhealthy response from ${targetUrl}: ${res.statusCode}. Restarting...`);
        req.destroy();
        killTunnelAndRestart();
      });

      req.on('error', (err) => {
        console.warn(`[TUNNEL HEALTH] Request to ${targetUrl} failed: ${err.message}. Restarting...`);
        killTunnelAndRestart();
      });

      req.on('timeout', () => {
        console.warn(`[TUNNEL HEALTH] Request to ${targetUrl} timed out. Restarting...`);
        req.destroy();
        killTunnelAndRestart();
      });
    }, 20000);
  }, 15000);
}

function killTunnelAndRestart() {
  if (isRestarting) return;
  console.log('[TUNNEL] Killing unresponsive tunnel...');
  if (tunnelProcess) {
    try {
      const { exec } = require('child_process');
      exec(`taskkill /pid ${tunnelProcess.pid} /t /f`, () => {});
      tunnelProcess.kill('SIGKILL');
    } catch (e) {}
  }
  cleanupAndScheduleRestart();
}

startTunnel();
