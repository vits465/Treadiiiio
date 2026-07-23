/**
 * bot-watchdog.js
 * Continuous auto-healing supervisor for Treadiiiio Forex Trading Bot.
 * Monitors Engine (4000), ML Service (8000), Dashboard (3000), and Tunnel.
 * Auto-restarts any process if it crashes, exits, or fails health checks.
 * Stops automatically at 7:00 PM local time.
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const ROOT_DIR = __dirname;
const ML_DIR = path.join(__dirname, 'ml-service');

const TARGET_HOUR = 19; // 7 PM
const TARGET_MINUTE = 0;

let services = {
  mlService: { name: 'ML Service', process: null, restarts: 0 },
  engine: { name: 'Trading Engine', process: null, restarts: 0 },
  dashboard: { name: 'Next.js Dashboard', process: null, restarts: 0 },
  tunnel: { name: 'Localtunnel', process: null, restarts: 0 },
};

let isStopping = false;

function log(msg) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[WATCHDOG ${timestamp}] ${msg}`);
}

function startMLService() {
  if (isStopping) return;
  log("Starting ML Microservice (FastAPI)...");
  const pyExecutable = path.join(ML_DIR, 'venv', 'Scripts', 'python.exe');
  services.mlService.process = spawn(pyExecutable, ['main.py'], { cwd: ML_DIR });

  services.mlService.process.stdout?.on('data', (d) => process.stdout.write(`[ML] ${d}`));
  services.mlService.process.stderr?.on('data', (d) => process.stderr.write(`[ML ERR] ${d}`));

  services.mlService.process.on('exit', (code) => {
    log(`⚠️ ML Microservice exited with code ${code}.`);
    if (!isStopping) {
      services.mlService.restarts++;
      log(`Auto-restarting ML Microservice (Restart #${services.mlService.restarts})...`);
      setTimeout(startMLService, 3000);
    }
  });
}

function startEngine() {
  if (isStopping) return;
  log("Starting Trading Engine (Node.js)...");
  const scriptPath = path.join(ROOT_DIR, 'dist', 'index.js');
  services.engine.process = spawn(process.execPath, [scriptPath], { cwd: ROOT_DIR });

  services.engine.process.stdout?.on('data', (d) => process.stdout.write(`[ENGINE] ${d}`));
  services.engine.process.stderr?.on('data', (d) => process.stderr.write(`[ENGINE ERR] ${d}`));

  services.engine.process.on('exit', (code) => {
    log(`⚠️ Trading Engine exited with code ${code}.`);
    if (!isStopping) {
      services.engine.restarts++;
      log(`Auto-restarting Trading Engine (Restart #${services.engine.restarts})...`);
      setTimeout(startEngine, 3000);
    }
  });
}

function startDashboard() {
  if (isStopping) return;
  log("Starting Next.js Dashboard...");
  const scriptPath = path.join(ROOT_DIR, 'start-dashboard.js');
  services.dashboard.process = spawn(process.execPath, [scriptPath], { cwd: ROOT_DIR });

  services.dashboard.process.stdout?.on('data', (d) => process.stdout.write(`[DASHBOARD] ${d}`));
  services.dashboard.process.stderr?.on('data', (d) => process.stderr.write(`[DASHBOARD ERR] ${d}`));

  services.dashboard.process.on('exit', (code) => {
    log(`⚠️ Next.js Dashboard exited with code ${code}.`);
    if (!isStopping) {
      services.dashboard.restarts++;
      log(`Auto-restarting Next.js Dashboard (Restart #${services.dashboard.restarts})...`);
      setTimeout(startDashboard, 3000);
    }
  });
}

function startTunnel() {
  if (isStopping) return;
  log("Starting Localtunnel Service...");
  const scriptPath = path.join(ROOT_DIR, 'start-tunnel.js');
  services.tunnel.process = spawn(process.execPath, [scriptPath], { cwd: ROOT_DIR });

  services.tunnel.process.stdout?.on('data', (d) => process.stdout.write(`[TUNNEL] ${d}`));
  services.tunnel.process.stderr?.on('data', (d) => process.stderr.write(`[TUNNEL ERR] ${d}`));

  services.tunnel.process.on('exit', (code) => {
    log(`⚠️ Localtunnel process exited with code ${code}.`);
    if (!isStopping) {
      services.tunnel.restarts++;
      log(`Auto-restarting Localtunnel (Restart #${services.tunnel.restarts})...`);
      setTimeout(startTunnel, 3000);
    }
  });
}

function checkHttp(url, callback) {
  const req = http.get(url, { timeout: 4000 }, (res) => {
    res.resume();
    callback(res.statusCode === 200);
  });
  req.on('error', () => callback(false));
  req.on('timeout', () => { req.destroy(); callback(false); });
}

let engineFailures = 0;
let mlFailures = 0;

function startSupervisor() {
  log("Watchdog supervisor initialized. Waiting 35s startup grace period...");

  setTimeout(() => {
    log("Watchdog supervisor health checks ACTIVE (Checking every 15s).");

    setInterval(() => {
      if (isStopping) return;

      const now = new Date();
      if (now.getHours() >= TARGET_HOUR && now.getMinutes() >= TARGET_MINUTE) {
        log("⏰ 7:00 PM reached! Triggering graceful shutdown of all trading services...");
        stopAll();
        return;
      }

      // Health check Engine (Port 4000)
      checkHttp('http://127.0.0.1:4000/api/health', (ok) => {
        if (ok) {
          engineFailures = 0;
        } else if (!isStopping) {
          engineFailures++;
          log(`⚠️ Engine (4000) health check failed (${engineFailures}/3)...`);
          if (engineFailures >= 3) {
            log("🔴 Engine unreachable after 3 checks. Force restarting engine...");
            engineFailures = 0;
            if (services.engine.process) {
              try { services.engine.process.kill('SIGKILL'); } catch (e) {}
            }
            startEngine();
          }
        }
      });

      // Health check ML Service (Port 8000)
      checkHttp('http://127.0.0.1:8000/health', (ok) => {
        if (ok) {
          mlFailures = 0;
        } else if (!isStopping) {
          mlFailures++;
          log(`⚠️ ML Service (8000) health check failed (${mlFailures}/3)...`);
          if (mlFailures >= 3) {
            log("🔴 ML Service unreachable after 3 checks. Force restarting ML service...");
            mlFailures = 0;
            if (services.mlService.process) {
              try { services.mlService.process.kill('SIGKILL'); } catch (e) {}
            }
            startMLService();
          }
        }
      });

    }, 15000);
  }, 35000);
}

function stopAll() {
  isStopping = true;
  log("Stopping all managed services...");
  Object.values(services).forEach((s) => {
    if (s.process) {
      try { s.process.kill(); } catch (e) {}
    }
  });
  log("All services stopped. Watchdog supervisor exiting cleanly.");
  process.exit(0);
}

log("==================================================");
log("   Treadiiiio Watchdog Supervisor Started          ");
log("   Monitors: Engine, ML, Dashboard, Tunnel         ");
log("   Auto-restart on error | Target Stop: 7:00 PM    ");
log("==================================================");

startMLService();
setTimeout(startEngine, 2000);
setTimeout(startDashboard, 4000);
setTimeout(startTunnel, 6000);
startSupervisor();
