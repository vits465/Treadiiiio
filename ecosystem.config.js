const path = require('path');
const isWin = process.platform === "win32";
const pythonExecutable = isWin
  ? path.join(__dirname, "ml-service", "venv", "Scripts", "python.exe")
  : path.join(__dirname, "ml-service", "venv", "bin", "python");

module.exports = {
  apps: [
    {
      name: "engine",
      script: "./dist/index.js",
      cwd: __dirname,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "ml-service",
      script: "main.py",
      interpreter: pythonExecutable,
      cwd: path.join(__dirname, "ml-service"),
      watch: false,
      env: {
        PYTHONUNBUFFERED: "1",
      },
    },
    {
      name: "dashboard",
      script: "./start-dashboard.js",
      cwd: __dirname,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "tunnel",
      script: "./start-tunnel.js",
      cwd: __dirname,
      watch: false,
      autorestart: true,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "auto-stop",
      script: "./stop-at-12pm.js",
      cwd: __dirname,
      watch: false,
      autorestart: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ]
};


