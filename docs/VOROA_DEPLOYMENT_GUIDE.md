# Treadiiiio — Voroa Cloud Deployment Guide (getvoroa.com)

This guide walks you through deploying your **Treadiiiio Forex & Gold Trading Bot** to **[Voroa](https://getvoroa.com)** so it runs 24/7 in the cloud without needing your local PC or localtunnel.

---

## 1. Prerequisites

1. A **Voroa** account at [getvoroa.com](https://getvoroa.com).
2. Your repository pushed to GitHub: [`https://github.com/vits465/Treadiiiio`](https://github.com/vits465/Treadiiiio).
3. Your **Twelve Data API Key** (and optional Telegram Bot tokens).

---

## 2. Choosing Your Deployment Strategy on Voroa

You have two simple options on Voroa:

### Option A: Standard Node.js Web Service (Recommended — Fast & Lightweight)
- **Runtime**: Node.js 20
- **Memory Footprint**: ~100MB – 180MB RAM
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- Runs all 10+ core strategies (`gold_alpha`, `scalping_1m`, `power_breakout`, `smc_liquidity`, `rsi_reversion`, `ma_crossover`, etc.) with in-process ONNX inference.

### Option B: Docker Container Web Service
- **Runtime**: Docker
- **Dockerfile**: `Dockerfile` (or `Dockerfile.allinone` if running both Node engine & Python ML FastAPI in one container).
- **Port**: 4000 (Voroa automatically routes HTTP/WebSocket traffic).

---

## 3. Step-by-Step Deployment Instructions

### Step 1: Push Changes to GitHub
Make sure all recent updates are committed and pushed to your repo:
```bash
git add .
git commit -m "Prepare trading bot for Voroa PaaS cloud deployment"
git push origin main
```

---

### Step 2: Create a New Web Service in Voroa
1. Log in to [getvoroa.com](https://getvoroa.com) and go to your **Dashboard**.
2. Click **Create New** / **New Service** → **Web Service**.
3. Select **GitHub** and choose your repository: `vits465/Treadiiiio`.
4. Configure service settings:
   - **Name**: `treadiiiio-engine`
   - **Branch**: `main`
   - **Root Directory**: `/`
   - If using **Node.js runtime**:
     - **Build Command**: `npm install && npm run build`
     - **Start Command**: `npm start`
   - If using **Docker runtime**:
     - Select **Docker** (Voroa will use the root `Dockerfile`).

---

### Step 3: Configure Environment Variables in Voroa
In the **Environment Variables** tab of your service, add the following key-value pairs:

| Variable Name | Example Value | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Production mode |
| `PORT` | `4000` | HTTP port (Voroa injects this automatically if left blank) |
| `DB_PATH` | `./data/forex_bot.db` | Local SQLite database file |
| `TWELVE_DATA_API_KEY` | `your_actual_twelve_data_key` | Twelve Data market feed key |
| `USE_SIMULATOR` | `true` (or `false` for live) | Paper tick simulator vs real feed |
| `USE_REAL_PRICES` | `false` (or `true` if market open) | Use live real pricing candles |
| `CURRENCY_PAIRS` | `EUR/USD,GBP/USD,USD/JPY,XAU/USD` | Active currency & gold pairs |
| `STARTING_BALANCE` | `1000` | Account starting balance (USD) |
| `RISK_MODE` | `conservative` | conservative / standard / aggressive |
| `RISK_MAX_POSITION_SIZE_PCT` | `2` | Hard risk ceiling per trade |
| `API_SECRET_KEY` | `your_secret_key_min_16_chars` | Min 16-char secret key for dashboard auth |
| `CORS_ALLOWED_ORIGIN` | `https://treadiiiio.vercel.app` | Your Vercel frontend URL or `*` |
| `TELEGRAM_BOT_TOKEN` | *(optional)* | Telegram bot token for trade alerts |
| `TELEGRAM_CHAT_ID` | *(optional)* | Telegram chat ID for trade alerts |

---

### Step 4: Deploy and Verify
1. Click **Deploy**.
2. Watch the live build logs. Once complete, the service status turns **Live** / **Healthy**.
3. Voroa provides a public URL (e.g., `https://treadiiiio-engine.getvoroa.com`).
4. Test the health endpoint in your browser:
   ```
   https://<your-voroa-app-url>/api/health
   ```
   You should receive:
   ```json
   {
     "status": "ok",
     "enginePaused": false,
     "dbConnected": true,
     "uptime": 12.4
   }
   ```

---

## 4. Connecting Your Vercel Dashboard

Your frontend dashboard is hosted on Vercel at `https://treadiiiio.vercel.app`. Connect it to your live Voroa URL:

1. Go to your **Vercel Project Settings** → **Environment Variables**.
2. Update:
   - `NEXT_PUBLIC_BOT_API_URL` = `https://treadiiiio-engine.getvoroa.com`
   - `NEXT_PUBLIC_BOT_WS_URL` = `wss://treadiiiio-engine.getvoroa.com/ws`
3. Click **Save** and trigger a **Redeploy** on Vercel.

---

## 5. Dashboard Security & Operator Gateway

The web terminal hosted on Vercel is secured with a strict operator authentication gate:

- **Dashboard URL**: `https://treadiiiio.vercel.app/login`
- **Master Operator Username**: `AdiVish`
- **Master Password**: `VISHA@2611`
- **Clearance Level**: Master Operator Clearance (Institutional Terminal Access)
- **Features**:
  - Full route protection preventing unauthorized access
  - Session persistence with 256-bit hashed tokens and SameSite cookies
  - Cloud Infrastructure & Network Links matrix displaying Voroa Mumbai engine health, real-time latency ping, live market price stream, and SQLite WAL database uptime
  - 100% responsive layout on mobile, tablet, and widescreen desktop with slide-down navigation drawer

🎉 **Done!** Your bot is now operating 24/7 on Voroa in Mumbai, streaming real-time trade signals to your Vercel dashboard without requiring your local PC or localtunnel.
