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
    }
  ]
};
