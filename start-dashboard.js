const { spawn } = require('child_process');
const path = require('path');

const dashboardDir = path.join(__dirname, 'dashboard');
const nextBin = path.join(dashboardDir, 'node_modules', 'next', 'dist', 'bin', 'next');

console.log("[Dashboard] Starting Next.js production server on dual-stack [::]:3000...");

process.env.NODE_ENV = 'production';
process.env.PORT = '3000';

const child = spawn(process.execPath, [nextBin, 'start', '-p', '3000', '-H', '::'], {
  cwd: dashboardDir,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, PORT: '3000' }
});

child.on('error', (err) => {
  console.error('[Dashboard] Spawn error:', err);
});

child.on('exit', (code) => {
  console.log(`[Dashboard] Next.js production server exited with code ${code}`);
  process.exit(code || 0);
});

// Keep event loop alive permanently
setInterval(() => {}, 60000);
