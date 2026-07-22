/**
 * start-tunnel.js
 * Permanent localtunnel launcher for PM2.
 * Fixed URL: https://vits-trading-bot-engine.loca.lt
 * 
 * PM2 runs this as a Node.js process, so we spawn the localtunnel CLI as a child.
 */
const { spawn } = require('child_process');

const tunnel = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['localtunnel', '--port', '4000', '--subdomain', 'vits-trading-bot-engine'],
  { stdio: 'inherit', shell: false }
);

tunnel.on('close', (code) => {
  process.exit(code ?? 1); // PM2 will auto-restart after exit
});
