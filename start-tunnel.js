/**
 * start-tunnel.js
 * Self-healing permanent localtunnel process manager.
 * Auto-restarts if localtunnel drops, returns 502/503, or times out.
 */
const { spawn } = require('child_process');
const https = require('https');

let tunnelProcess = null;
let healthCheckInterval = null;
let isRestarting = false;

function startTunnel() {
  if (isRestarting) return;
  
  console.log('[TUNNEL] Starting localtunnel on port 4000 (subdomain: treadiiiio-bot-5532)...');
  
  tunnelProcess = spawn(
    'npx',
    ['localtunnel', '--port', '4000', '--subdomain', 'treadiiiio-bot-5532'],
    { stdio: 'inherit', shell: true }
  );

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

  console.log('[TUNNEL] Restarting localtunnel in 5 seconds...');
  setTimeout(() => {
    isRestarting = false;
    startTunnel();
    startHealthCheck();
  }, 5000);
}

function startHealthCheck() {
  if (healthCheckInterval) clearInterval(healthCheckInterval);
  
  // Wait 12 seconds after startup before starting checks to let it establish connection
  setTimeout(() => {
    if (isRestarting) return;
    
    healthCheckInterval = setInterval(() => {
      if (isRestarting) return;

      const req = https.get('https://treadiiiio-bot-5532.loca.lt/api/config', {
        headers: {
          'x-api-key': 'a3f7c9d2e1b4f6a8c0d5e7f9b2a4c6d8',
          'Bypass-Tunnel-Reminder': 'true'
        },
        timeout: 6000
      }, (res) => {
        if (res.statusCode === 200) {
          // Tunnel is healthy
          return;
        }
        console.warn(`[TUNNEL HEALTH] Unhealthy response: ${res.statusCode}. Restarting...`);
        req.destroy();
        killTunnelAndRestart();
      });

      req.on('error', (err) => {
        console.warn(`[TUNNEL HEALTH] Request failed: ${err.message}. Restarting...`);
        killTunnelAndRestart();
      });

      req.on('timeout', () => {
        console.warn('[TUNNEL HEALTH] Request timed out. Restarting...');
        req.destroy();
        killTunnelAndRestart();
      });
    }, 15000);
  }, 12000);
}

function killTunnelAndRestart() {
  if (isRestarting) return;
  console.log('[TUNNEL] Killing unresponsive tunnel...');
  if (tunnelProcess) {
    try {
      // In Windows, shell spawns need taskkill to clean up tree
      const { exec } = require('child_process');
      exec(`taskkill /pid ${tunnelProcess.pid} /t /f`, () => {});
      tunnelProcess.kill('SIGKILL');
    } catch (e) {}
  }
  cleanupAndScheduleRestart();
}

startTunnel();
startHealthCheck();
