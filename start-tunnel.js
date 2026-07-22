/**
 * start-tunnel.js
 * Self-healing permanent localtunnel process manager.
 * Auto-restarts instantly if localtunnel drops or returns 503.
 */
const { spawn } = require('child_process');
const http = require('http');

let tunnelProcess = null;

function startTunnel() {
  console.log('[TUNNEL] Starting localtunnel on port 4000 (subdomain: treadiiiio-bot-5531)...');
  
  tunnelProcess = spawn(
    'npx',
    ['localtunnel', '--port', '4000', '--subdomain', 'treadiiiio-bot-5531'],
    { stdio: 'inherit', shell: true }
  );

  tunnelProcess.on('close', (code) => {
    console.log(`[TUNNEL] Localtunnel process exited with code ${code}. Restarting in 3 seconds...`);
    setTimeout(startTunnel, 3000);
  });

  tunnelProcess.on('error', (err) => {
    console.error('[TUNNEL] Localtunnel error:', err.message);
  });
}

startTunnel();
