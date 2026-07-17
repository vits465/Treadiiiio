const { execSync } = require('child_process');
console.log("Starting Next.js dashboard...");
try {
  execSync('node node_modules/next/dist/bin/next start -p 3000', { stdio: 'inherit', cwd: './dashboard' });
} catch (e) {
  console.error("Dashboard crashed:", e);
}
