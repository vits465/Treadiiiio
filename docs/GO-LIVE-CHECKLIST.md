# Treadiiiio — Go-Live Safety & Deployment Checklist

Before transitioning the Treadiiiio bot from Demo / Simulator mode to Live Trading with real capital, the operator must complete and verify every item below.

---

## 1. Safety & Sizing Invariants
- [ ] **Account Capital Check**: Minimum recommended capital is $50.00 – $100.00.
- [ ] **Risk Sizing Cap**: Hard risk cap `RISK_MAX_POSITION_SIZE_PCT=2` is active and hard-coded in position sizing.
- [ ] **Micro-Lot Enforcement**: Minimum lot size is strictly 0.01 micro-lots. Small-account budget guard cancels orders if 0.01 lot dollar risk exceeds the allocated budget.
- [ ] **Zero Martingale**: Unbounded recovery sizing is disabled. All position sizing is fractional-Kelly bounded by 0.5x–2.0%.
- [ ] **Correlation Group Guard**: Maximum net directional exposure per group (e.g. `USD_EXPOSURE`) is strictly capped at 2 positions.
- [ ] **Leverage & Margin Buffer**: Effective leverage cap of 20:1 and 30% minimum free-margin buffer are actively enforced on every order.

---

## 2. Circuit Breakers & Auto-Protection
- [ ] **Daily Loss Breaker**: Realized + floating daily drawdown $\ge 5\%$ trips the circuit breaker, halts new entries for the remainder of the UTC day, and requires manual reset (`/reset` or `/start`).
- [ ] **Weekly Drawdown Guard**: 12% weekly loss limit halts all trading until the start of the next week.
- [ ] **Strategy Auto-Quarantine**: Any strategy whose rolling 30-trade Profit Factor drops below 1.0 is automatically quarantined. Telegram alert sent; manual restore required (`/reenable <strategy>` or via Strategy Lab).
- [ ] **Volatility Breaker**: If 14-period ATR spikes above its 95th percentile, new trade entries are paused automatically.
- [ ] **Equity-Curve Throttle**: If equity falls below its 20-trade moving average, position sizing is automatically halved (0.5x).
- [ ] **Weekend Guard**: Engine auto-liquidates open positions at Friday 20:00 UTC and pauses until Sunday 22:00 UTC.

---

## 3. Remote Control & Operator Operations
- [ ] **Telegram Bot Token & Chat ID**: Configured in `.env` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`).
- [ ] **Bot Responsiveness**: Tested `/status`, `/balance`, `/positions`, `/targets`, and `/account`.
- [ ] **Emergency Controls**:
  - `/pause` halts automated scanners.
  - `/resume` restarts automated scanners.
  - `/close <ticket>` closes a specific ticket.
  - `/closeall` closes all active positions immediately.
  - `/kill` & `/kill_confirm` triggers full emergency flatten.
  - `/breakeven` locks current profitable positions at entry.
- [ ] **Audit Trail**: All manual operator actions are logged to SQLite (`audit_actions`) and visible via `/audit` or the web dashboard.

---

## 4. Machine Learning & Model Serving
- [ ] **Purged & Embargoed Cross-Validation**: Validated with zero lookahead leakage across train/validation folds.
- [ ] **Triple-Barrier Labeling**: Aligned with actual SL (1.5 ATR) and TP (3.0 ATR) execution boundaries.
- [ ] **In-Process ONNX Inference**: `onnxruntime-node` fallback evaluates models in-process if Python ML microservice is unreachable.
- [ ] **Drift Monitoring**: Population Stability Index (PSI) and Kolmogorov-Smirnov (KS) tests verified via `/drift` and `POST /drift`.

---

## 5. Deployment Options
### A. PM2 Process Manager (Local / VPS)
```bash
# Start all microservices
pm2 start ecosystem.config.js
pm2 save
```

### B. Docker Compose (Containerized Production)
```bash
# Build and launch trading-engine, ml-service, and dashboard
docker compose up -d --build

# Inspect logs
docker compose logs -f
```

---

## 6. Verification Sign-Off
- [x] TypeScript build: 0 errors (`npx tsc --noEmit`).
- [x] Jest test suites: 100% passed (30/30 suites, 178+ tests).
- [x] Python Pytest: 100% passed (18/18 tests in `ml-service/tests`).
