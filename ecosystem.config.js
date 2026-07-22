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
      script: "venv/Scripts/uvicorn.exe",
      args: "api.main:app --host 0.0.0.0 --port 8000",
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
      // Permanent fixed-subdomain tunnel — URL never changes: https://vits-trading-bot-engine.loca.lt
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

