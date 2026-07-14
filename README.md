# Forex Paper Trading Bot (Node.js / TypeScript & Python ML)

This is a complete paper trading forex bot written in Node.js & TypeScript, paired with a Python FastAPI machine learning microservice (XGBoost). It aggregates price data, executes mock orders with spread/slippage, runs multiple rule-based and ML strategies side-by-side, tracks portfolio equity, and exposes REST APIs for reporting.

---

## Project Structure

```
forex-paper-bot/
├── src/
│   ├── config/          # Zod env schema & validation
│   ├── data/            # OANDA / Simulator price quotes & candles aggregator
│   ├── strategy/        # Rule-based strategies (SMA Cross, RSI Reversion, BB Bands)
│   ├── ml-client/       # HTTP client calling Python service
│   ├── engine/          # Paper Trading Engine (execution, PnL, SL/TP checks)
│   ├── risk/            # Risk limits (max positions, sizing, daily loss)
│   ├── db/              # SQLite database schema
│   ├── api/             # Express API server for state exposure
│   └── index.ts         # Bootstraps price polling & loop
├── ml-service/          # Python FastAPI ML microservice
│   ├── features/        # Technical indicator engineer calculations (Pandas)
│   ├── models/          # XGBoost model training & validation workflow
│   ├── tests/           # Feature engineering unit tests
│   └── main.py          # FastAPI application server
├── tests/               # Jest tests for Trading Engine & Risk Manager
├── package.json         # Node config & dependencies
├── tsconfig.json        # TypeScript compiler options
├── jest.config.js       # Jest test configuration
└── README.md
```

---

## Getting Started

### Prerequisites
- Node.js (version 20+)
- Python (version 3.11+)

---

### Step 1: Install Node.js Dependencies

In the root directory, install npm packages:
```bash
npm install
```

---

### Step 2: Configure Environment Variables

Create your environment configuration:
- Copy the `.env.example` in the root directory to `.env`.
- Copy the `ml-service/.env.example` to `ml-service/.env`.

#### Simulator Mode (Out of the Box)
By default, `USE_SIMULATOR=true` in `.env`. This allows you to run, test, and retrain the bot offline using synthetic random-walk prices without requiring OANDA API credentials.

#### Live/Practice Price Feed (OANDA API)
To use real price feeds:
1. Create a free demo account on [OANDA](https://www.oanda.com/).
2. Generate an API Key (Personal Access Token) and find your account ID in the OANDA portal.
3. Edit the `.env` file to set:
   ```env
   USE_SIMULATOR=false
   OANDA_API_KEY=your_oanda_personal_token
   OANDA_ACCOUNT_ID=your_oanda_practice_account_id
   ```

---

### Step 3: Install & Start Python ML Service

Navigate to `ml-service` directory, create a virtual environment, install dependencies, and run:

```bash
cd ml-service
python -m venv venv
# Activate virtualenv:
# Windows:
.\venv\Scripts\activate
# Unix/Mac:
source venv/bin/activate

pip install -r requirements.txt
python main.py
```
The ML Service will start on `http://127.0.0.1:8000`.

---

### Step 4: Run Node.js Bot

Open a new terminal in the project root:

- **Run in development mode (auto-reload)**:
  ```bash
  npm run dev
  ```
- **Run in production mode**:
  ```bash
  npm run build
  npm start
  ```

*On startup, if the ML service is active, the bot automatically checks if a trained XGBoost model exists. If not, it pulls historical data, sends it to FastAPI, trains the model, and stores validation metrics in the database.*

---

## Running Unit Tests

### Node.js (Trading Engine & Risk Limits)
```bash
npm run test
```

### Python (Feature Calculations)
```bash
cd ml-service
python -m unittest tests/test_features.py
```

---

## API Documentation

The Express server exposes the following endpoints (default port `3000`):

### 1. Account Summary
- **Endpoint**: `GET /api/summary`
- **Description**: Returns realized PnL, win rate, total trades, Max Drawdown, Sharpe ratio, and breakdown by strategy source (realized PnL, win rate, count).

### 2. Live Portfolio Status
- **Endpoint**: `GET /api/status`
- **Description**: Returns active balances, current equity, unrealized PnL, and simulation status.

### 3. Active Positions
- **Endpoint**: `GET /api/positions`
- **Description**: Returns all currently open positions with entries, stop-loss, take-profit levels, and unrealized PnL.

### 4. Trade Log
- **Endpoint**: `GET /api/trades?limit=100`
- **Description**: Returns chronological trade log (both OPEN and CLOSED positions).

### 5. Equity Curve snapshots
- **Endpoint**: `GET /api/equity`
- **Description**: Returns historical equity curve snapshots over time.

### 6. Retrain Models
- **Endpoint**: `POST /api/train`
- **Payload**: `{"instrument": "EUR_USD", "count": 1000}`
- **Description**: Manually triggers historical candle download, time-series training validation split, and model persistence on the Python service.
