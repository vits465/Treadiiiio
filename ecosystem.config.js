const isWin = process.platform === "win32";
const pythonPath = isWin ? "venv/Scripts/python.exe" : "venv/bin/python";

module.exports = {
  apps: [
    {
      name: "engine",
      script: "./dist/index.js",
      cwd: "./",
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "ml-service",
      script: pythonPath,
      args: "main.py",
      cwd: "./ml-service",
      watch: false,
      env: {
        PYTHONUNBUFFERED: "1",
      },
    },
    {
      name: "dashboard",
      script: "./start-dashboard.js",
      cwd: "./",
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "tunnel",
      script: "./start-tunnel.js",
      cwd: "./",
      watch: false,
      autorestart: true,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
      },
    },
  ]
};


