module.exports = {
  apps: [
    {
      name: "engine",
      script: "./dist/index.js",
      cwd: "./",
      watch: false,
      env: {
        NODE_ENV: "production",
        USE_SIMULATOR: "true",
      },
    },
    {
      name: "ml-service",
      script: "venv/Scripts/python.exe",
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
      // Permanent fixed-subdomain tunnel — URL: https://treadiiiio-bot-5531.loca.lt
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

