# Treadiiiio — Master Upgrade Changelog

## Phase 0 — Comprehensive Architecture Audit
- Complete codebase audit documented in [docs/AUDIT.md](file:///d:/Frerlancing/Treding%20Bot/docs/AUDIT.md).
- Detailed inventory of position sizing math, strategy interfaces, ML feature engineering, backtest frictions, and safety invariants.

---

## Phase 1 — Correctness Fixes & Sizing Hardening
- **Position Sizing Math**: Enforced hard-cap $\le 2.0\%$ per trade (`config.RISK_MAX_POSITION_SIZE_PCT`). Corrected Kelly sizing return scale.
- **Small Account Guard**: Capped micro-account ($50–$200) sizing at 0.01 micro-lots; rejects trades if dollar risk at SL exceeds risk budget instead of rounding up.
- **Symbol Normalization**: Central [src/utils/symbolNormalizer.ts](file:///d:/Frerlancing/Treding%20Bot/src/utils/symbolNormalizer.ts) with pip size, JPY/Gold scaling, and contract sizes.
- **UTC Market Hours**: Central [src/utils/scheduler.ts](file:///d:/Frerlancing/Treding%20Bot/src/utils/scheduler.ts) enforcing Asian/London/NY sessions, Friday 20:00 UTC weekend liquidation, and bank rollover widened spreads.
- **Tests**: 17 tests passed in [tests/phase1Correctness.test.ts](file:///d:/Frerlancing/Treding%20Bot/tests/phase1Correctness.test.ts).

---

## Phase 2 — Unified Strategy Layer & Regime Routing
- **Unified Strategy Interface**: Standardized `evaluate(candles, context)` across all 11 strategies in [src/strategy/strategy.interface.ts](file:///d:/Frerlancing/Treding%20Bot/src/strategy/strategy.interface.ts) and [src/strategy/registry.ts](file:///d:/Frerlancing/Treding%20Bot/src/strategy/registry.ts).
- **Regime Router**: Created [src/analytics/regimeRouter.ts](file:///d:/Frerlancing/Treding%20Bot/src/analytics/regimeRouter.ts) classifying pairs into `TRENDING`, `RANGING`, or `HIGH_VOLATILITY` using ADX and rolling ATR percentile.
- **Multi-Timeframe Trend Confirmation**: Daily and 1-hour macro trend gating preventing counter-trend entries.
- **Engine-Managed Exits**: 1:1 R break-even stop loss moves, 1:2 R partial profit scaling, and ATR-based trailing stops.
- **Tests**: 9 tests passed in [tests/phase2StrategyLayer.test.ts](file:///d:/Frerlancing/Treding%20Bot/tests/phase2StrategyLayer.test.ts).

---

## Phase 3 — ML Microservice Upgrades
- **Purged/Embargoed Walk-Forward CV**: Implemented in [ml-service/models/purged_cv.py](file:///d:/Frerlancing/Treding%20Bot/ml-service/models/purged_cv.py) eliminating lookahead leakage across training/validation folds.
- **Triple-Barrier Labeling**: Implemented in [ml-service/features/engineering.py](file:///d:/Frerlancing/Treding%20Bot/ml-service/features/engineering.py) (2=BUY, 0=SELL, 1=HOLD) matching engine ATR multipliers (`sl_mult=1.5`, `tp_mult=3.0`, `holding_period=24`).
- **Stationary & Regime Features**: Added `adx_14`, rolling 100-bar `atr_percentile`, stationary ratios `price_to_sma21_atr`, `sma_diff_atr`, and session one-hots.
- **Calibrated Probabilities**: Integrated Platt scaling via `FrozenEstimator` / `CalibratedClassifierCV` in [ml-service/models/xgboost_model.py](file:///d:/Frerlancing/Treding%20Bot/ml-service/models/xgboost_model.py).
- **ONNX Export & In-Process Serving**: Automated ONNX export (`.onnx`) with SHA256 model hashing; implemented in-process ONNX inference via `onnxruntime-node` with heuristic fallback in [src/ml-client/onnxFallback.ts](file:///d:/Frerlancing/Treding%20Bot/src/ml-client/onnxFallback.ts).
- **Drift Monitoring**: Implemented Population Stability Index (PSI) and Kolmogorov-Smirnov 2-sample tests in [ml-service/models/drift.py](file:///d:/Frerlancing/Treding%20Bot/ml-service/models/drift.py) and `POST /drift` endpoint.
- **Model Versioning**: Added DB columns (`model_hash`, `training_window`, `calibration_data`, `onnx_path`) in SQLite and trade attribution in `tradingEngine.ts`.
- **Tests**: 18/18 Pytest tests passed in `ml-service/tests`.

---

## Phase 4 — Backtest Engine Realism & Validation
- **Shared Friction Model**: Created [src/analytics/frictionModel.ts](file:///d:/Frerlancing/Treding%20Bot/src/analytics/frictionModel.ts) (dynamic session spreads, bank rollover widening, stop-loss gap slippage, commissions, overnight swap with 3x Wednesday multiplier).
- **Historical Data Downloader & Cache**: Created [src/data/historicalDataCache.ts](file:///d:/Frerlancing/Treding%20Bot/src/data/historicalDataCache.ts) caching multi-year datasets to disk (`data/cache/`) and SQLite.
- **Quant Reporting & Persistence**: Upgraded [src/analytics/backtestEngine.ts](file:///d:/Frerlancing/Treding%20Bot/src/analytics/backtestEngine.ts) calculating Profit Factor, Sharpe, Sortino, Max Drawdown, Expectancy, and Regime breakdown; saves to `data/backtest_results/latest_report.json` and SQLite `backtest_runs`.
- **Monte Carlo Robustness & Overfit Guard**: Trade-order bootstrap reshuffling and parameter perturbation (±20% on key parameters) flagging overfitted strategies.
- **Tests**: 6 tests passed in [tests/phase4BacktestValidation.test.ts](file:///d:/Frerlancing/Treding%20Bot/tests/phase4BacktestValidation.test.ts).

---

## Phase 5 — Advanced Risk & Sizing Controls
- **Volatility Circuit Breaker**: Added `checkVolatilityCircuitBreaker` in [src/risk/riskManager.ts](file:///d:/Frerlancing/Treding%20Bot/src/risk/riskManager.ts) pausing new entries when ATR spikes above 95th percentile.
- **Equity-Curve Throttle**: Added `getEquityCurveThrottleMultiplier` in [src/risk/riskManager.ts](file:///d:/Frerlancing/Treding%20Bot/src/risk/riskManager.ts) cutting base risk to 0.5x when equity is below its 20-trade moving average.
- **Strategy Quarantine**: Added `checkStrategyQuarantine` auto-disabling strategies whose rolling 30-trade PF < 1.0; alerts sent to Telegram & dashboard; manual re-enable required.
- **Correlation Group Net Exposure**: Added `CORRELATION_GROUPS` and `checkGroupNetExposure` in [src/risk/correlationManager.ts](file:///d:/Frerlancing/Treding%20Bot/src/risk/correlationManager.ts) capping same-direction exposure.
- **Margin & Leverage Guard**: Added `checkMarginLeverageGuard` in [src/risk/riskManager.ts](file:///d:/Frerlancing/Treding%20Bot/src/risk/riskManager.ts) enforcing 20:1 max leverage and 30% free margin buffer before every live order.
- **Tests**: 10 tests passed in [tests/phase5RiskAdditions.test.ts](file:///d:/Frerlancing/Treding%20Bot/tests/phase5RiskAdditions.test.ts).

---

## Phase 6 — Operator Remote Controls & Dashboard Live Interaction
- **Comprehensive Telegram Command Center**:
  - `/status`, `/balance`, `/account`, `/price`, `/positions`, `/today`, `/targets`, `/history`, `/rejections`, `/config`.
  - Manual execution: `/buy`, `/sell`, `/close <ticket>`, `/closeall`, `/breakeven`.
  - Safety & Risk controls: `/pause`, `/resume`, `/reset`, `/kill`, `/kill_confirm`, `/quarantine`, `/reenable <strategy>`, `/backtest <strategy>`, `/regime`, `/models`, `/drift`, `/audit`.
- **Operator Action Audit Trail**: Created SQLite table `audit_actions` and [src/utils/auditLogger.ts](file:///d:/Frerlancing/Treding%20Bot/src/utils/auditLogger.ts) logging all remote commands and dashboard actions with timestamps and details.
- **Dashboard API Integration**:
  - Endpoints: `GET /api/quarantine`, `POST /api/quarantine/reenable`, `POST /api/backtest/run`, `GET /api/backtest/latest`, `GET /api/drift`, `GET /api/models`, `GET /api/audit-actions`.
  - Strategy Lab UI: Real-time quarantine banner and one-click strategy restoration.
- **Tests**: 3 tests passed in [tests/phase6ControlsAndLiveSync.test.ts](file:///d:/Frerlancing/Treding%20Bot/tests/phase6ControlsAndLiveSync.test.ts).

---

## Phase 7 & 8 — Ops, Containerization & Go-Live Readiness
- **Production Dockerization**: Created multi-stage `Dockerfile` (Node trading engine), `ml-service/Dockerfile` (FastAPI ML service), `dashboard/Dockerfile` (Next.js dashboard), and unified `docker-compose.yml`.
- **Go-Live Checklist**: Published in [docs/GO-LIVE-CHECKLIST.md](file:///d:/Frerlancing/Treding%20Bot/docs/GO-LIVE-CHECKLIST.md).

---

## Final Verification Summary
- **TypeScript**: 0 compiler errors (`npx tsc --noEmit`).
- **Jest Unit & Integration Tests**: **30/30 test suites passed, 178/178 tests passed (100%)**.
- **Pytest ML Service Tests**: **18/18 tests passed (100%)**.
