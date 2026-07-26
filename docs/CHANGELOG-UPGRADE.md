# Treadiiiio — Upgrade Changelog

## Phase 1 — Correctness Fixes (Completed July 26, 2026)

### 1. Risk Management & Position Sizing Math
- **[FIXED] 200% Risk Multiplier Bug in Position Sizing:**
  - *Files modified:* [src/risk/riskManager.ts](file:///d:/Frerlancing/Treding%20Bot/src/risk/riskManager.ts#L194-L245)
  - Standardized Kelly sizing return values to percentages, removing the extra `* 100` multiplier bug.
  - Enforced Safety Invariant #1: All per-trade risk is hard-capped at $\le 2.0\%$ (`config.RISK_MAX_POSITION_SIZE_PCT`).

- **[FIXED] Database Schema Column Mismatch in Kelly Sizing:**
  - *Files modified:* [src/risk/kellySizing.ts](file:///d:/Frerlancing/Treding%20Bot/src/risk/kellySizing.ts#L17)
  - Fixed SQL query in `calculateKellyRiskPct()` from `ORDER BY closeTime DESC` to `ORDER BY exit_time DESC`.

- **[FIXED] Small Account Protection & Min-Lot Budget Allocation:**
  - *Files modified:* [src/risk/riskManager.ts](file:///d:/Frerlancing/Treding%20Bot/src/risk/riskManager.ts#L280-L295)
  - Enforced strict risk budget checks: if minimum lot size (0.01 lots) exceeds the allocated risk budget, trades are cancelled (`units: 0`) instead of being forcibly rounded up.

### 2. Symbol Normalization Module
- **[NEW] Central Symbol Normalization Module:**
  - *Files created:* [src/utils/symbolNormalizer.ts](file:///d:/Frerlancing/Treding%20Bot/src/utils/symbolNormalizer.ts)

### 3. Execution Engine & Timezone Scheduler
- **[NEW] UTC Engine Cron Scheduler:**
  - *Files created:* [src/utils/scheduler.ts](file:///d:/Frerlancing/Treding%20Bot/src/utils/scheduler.ts)

---

## Phase 2 — Strategy Layer Upgrade (Completed July 26, 2026)

### 1. Unified Strategy Registry & Regime Router
- *Files created:* [src/strategy/registry.ts](file:///d:/Frerlancing/Treding%20Bot/src/strategy/registry.ts), [src/analytics/regimeRouter.ts](file:///d:/Frerlancing/Treding%20Bot/src/analytics/regimeRouter.ts)

### 2. Power Breakout & Scalper Strategies
- *Files created:* [src/strategy/powerBreakout.ts](file:///d:/Frerlancing/Treding%20Bot/src/strategy/powerBreakout.ts), [src/strategy/scalper1m.ts](file:///d:/Frerlancing/Treding%20Bot/src/strategy/scalper1m.ts)

---

## Phase 3 — ML Microservice Upgrades (Completed July 26, 2026)

### 1. Triple-Barrier Method Labeling & PSI Drift Detection
- *Files modified/created:* [ml-service/features/engineering.py](file:///d:/Frerlancing/Treding%20Bot/ml-service/features/engineering.py), [ml-service/models/drift.py](file:///d:/Frerlancing/Treding%20Bot/ml-service/models/drift.py), [src/ml-client/onnxFallback.ts](file:///d:/Frerlancing/Treding%20Bot/src/ml-client/onnxFallback.ts)

---

## Phase 4 — Risk, Capital & Safety Layer (Completed July 26, 2026)

### 1. Portfolio Heat Cap & Dynamic Spread Guard
- *Files created/modified:* [src/risk/portfolioHeat.ts](file:///d:/Frerlancing/Treding%20Bot/src/risk/portfolioHeat.ts), [src/risk/riskManager.ts](file:///d:/Frerlancing/Treding%20Bot/src/risk/riskManager.ts)

---

## Phase 5 — Execution Engine & Broker Integration (Completed July 26, 2026)

### 1. Abstract Broker Adapter Interface & State Machine
- *Files created/modified:* [src/broker/brokerAdapter.interface.ts](file:///d:/Frerlancing/Treding%20Bot/src/broker/brokerAdapter.interface.ts), [src/broker/mockBroker.ts](file:///d:/Frerlancing/Treding%20Bot/src/broker/mockBroker.ts), [src/broker/mt5Broker.ts](file:///d:/Frerlancing/Treding%20Bot/src/broker/mt5Broker.ts), [src/db/index.ts](file:///d:/Frerlancing/Treding%20Bot/src/db/index.ts)

---

## Phase 6 — Backtesting & Walk-Forward Optimization Engine (Completed July 26, 2026)

### 1. Event-Driven Backtest Engine & Walk-Forward Optimizer
- *Files created:* [src/backtest/engine.ts](file:///d:/Frerlancing/Treding%20Bot/src/backtest/engine.ts), [src/backtest/metrics.ts](file:///d:/Frerlancing/Treding%20Bot/src/backtest/metrics.ts), [src/backtest/walkForward.ts](file:///d:/Frerlancing/Treding%20Bot/src/backtest/walkForward.ts), [src/backtest/monteCarlo.ts](file:///d:/Frerlancing/Treding%20Bot/src/backtest/monteCarlo.ts)

---

## Phase 7 — Dashboard & Control Panel Upgrades (Completed July 26, 2026)

### 1. Rejection Audit Log & Strategy Lab REST APIs
- **[NEW] Extended REST Endpoints:**
  - *Files modified:* [src/api/server.ts](file:///d:/Frerlancing/Treding%20Bot/src/api/server.ts#L780-L946)
  - Exposed `/api/rejections`, `/api/strategies`, `/api/backtest/run`, and `/api/model-status` for frontend dashboard integration.

---

### Verification Summary
- **`npm run build`**: 0 TypeScript compilation errors.
- **`npm test`**: **25/25 test suites passed, 133/133 unit tests passed (100%)**.
- **`pytest` (`ml-service/`)**: **11/11 passed (100%)**.
