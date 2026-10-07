# Treadiiiio — Phase 0 Repository Audit

> **Date:** 2026-10-08  
> **Auditor:** Antigravity Quant Engineer  
> **Scope:** Full codebase (`src/`, `dashboard/`, `ml-service/`, `tests/`), config, runtime behavior

---

## 1. File Map

### `src/` — Node.js/TypeScript Trading Engine

| File | Purpose |
|------|---------|
| `index.ts` | Main bootstrap & execution loop (polling, strategy evaluation, ML signals) |
| `config/index.ts` | Zod-validated environment config with 90+ parameters |
| `db/index.ts` | SQLite init, schema creation, JSON→SQLite migration |
| `db/redis.ts` | Redis client (imported but **never used** in any hot path) |
| `engine/tradingEngine.ts` | Core order execution, position management, SL/TP/trailing stop, circuit breakers |
| `data/priceFeed.ts` | Multi-source price feed (GoldAPI, Massive/Polygon, AlphaVantage, TwelveData, simulator) |
| `data/wsClient.ts` | WebSocket manager for real-time data streams |
| `broker/mt5Client.ts` | MT5 Python bridge HTTP client (placeOrder, closeOrder, modify, getPositions) |
| `broker/mt5Broker.ts` | MT5 broker adapter (wraps mt5Client into BrokerAdapter interface) |
| `broker/mockBroker.ts` | Mock broker for paper trading |
| `broker/brokerAdapter.interface.ts` | BrokerAdapter interface definition |
| `broker/brokerFactory.ts` | Factory selecting mock vs MT5 broker |
| `strategy/strategy.interface.ts` | Strategy, Signal, MarketContext, PositionInfo interfaces |
| `strategy/registry.ts` | Strategy registry — static initialization of all 11 strategies |
| `strategy/goldAlpha.ts` | Gold institutional alpha (EMA200/20/50 + VWAP + RSI + ADX + ATR) |
| `strategy/scalper1m.ts` | 1-minute EMA ribbon + RSI + VWAP scalper |
| `strategy/maCrossover.ts` | Triple EMA crossover trend strategy |
| `strategy/rsiMeanReversion.ts` | RSI mean-reversion (oversold/overbought) |
| `strategy/bollingerBands.ts` | Bollinger Band squeeze/breakout |
| `strategy/smartMoneyConcepts.ts` | Smart money concepts (order blocks, liquidity sweeps) |
| `strategy/powerBreakout.ts` | Donchian breakout + ADX trend filter |
| `strategy/asianKillZone.ts` | Asian session range sweep & breakout |
| `strategy/volatilityArbitrage.ts` | ATR-based volatility expansion trades |
| `strategy/gridOverlay.ts` | Grid trading overlay |
| `strategy/lossRecovery.ts` | Bounded loss recovery (controlled averaging) |
| `risk/riskManager.ts` | Confidence-tiered position sizing, circuit breakers, all risk gates |
| `risk/kellySizing.ts` | Half-Kelly criterion for dynamic risk % |
| `risk/confirmations.ts` | ML gate rule-confirmation checks (SMA, RSI, Bollinger) |
| `risk/rejectionLogger.ts` | Filter rejection audit trail to SQLite |
| `risk/volatility.ts` | ATR computation + ATR percentile ranking |
| `risk/timeFilter.ts` | Session-based trade gating (London, NY, Asian) |
| `risk/newsFilter.ts` | News event blackout window & sentiment alignment |
| `risk/correlationManager.ts` | Cross-pair correlation cap enforcement |
| `risk/portfolioHeat.ts` | Portfolio-level heat/risk exposure tracking |
| `risk/strategyAllocator.ts` | Per-strategy risk budget allocation + monthly loss auto-pause |
| `analytics/backtestEngine.ts` | Rich backtest engine with performance metrics |
| `analytics/regimeDetector.ts` | Market regime detection (CALM/NORMAL/VOLATILE) |
| `analytics/regimeRouter.ts` | ADX-based regime routing + ADX calculation |
| `analytics/walkforward.ts` | Walk-forward validation engine |
| `analytics/runWalkForward.ts` | CLI runner for walk-forward studies |
| `analytics/kellySizing.ts` | Duplicate Kelly module (also at `risk/kellySizing.ts`) |
| `analytics/scalingRoadmap.ts` | Capital scaling roadmap generator |
| `analytics/demoLiveSimulator.ts` | Demo/live simulation harness |
| `backtest/engine.ts` | Event-driven backtest engine (simpler, older version) |
| `backtest.ts` | Top-level backtest runner script |
| `notifier/telegram.ts` | Telegram bot polling, 20+ commands, trade notifications |
| `api/server.ts` | Express API server (REST + WebSocket SSE) |
| `ml-client/index.ts` | ML microservice HTTP client |
| `logger/index.ts` | Winston logger setup |
| `utils/scheduler.ts` | Engine scheduling utilities |

### `dashboard/` — Next.js Frontend

| Path | Purpose |
|------|---------|
| `app/` | Next.js app directory with pages |
| `app/backtest/page.tsx` | Backtest analysis dashboard with AI suggestions |
| `lib/` | Shared utilities and API client |

### `ml-service/` — Python FastAPI ML Service

| File | Purpose |
|------|---------|
| `main.py` | FastAPI app entry point |
| `database.py` | SQLite connection for ML models |
| `api/` | API route handlers (predict, train, MT5 bridge) |
| `features/` | Feature engineering modules |
| `models/` | Trained model persistence |
| `data/` | Data loading utilities |
| `tests/` | Python unit tests |

### `tests/` — Jest Test Suite (26 files)

| File | Status |
|------|--------|
| `strategyAllocator.test.ts` | FAILING (2 tests) — budget count & risk multiplier mismatch |
| `dynamicSizing.test.ts` | FAILING — test expectations drift from code changes |
| `correlationManager.test.ts` | FAILING — correlation calculation mismatch |
| `partialProfit.test.ts` | FAILING — SL price off by 0.2 (pipSize mismatch) |
| 21 other test files | PASSING (127 tests pass) |

---

## 2. Strategy Inventory — Code vs Config

### Strategies Implemented in Code (11 total)

| Registry Name | Class | File |
|---------------|-------|------|
| `ma_crossover` | MaCrossoverStrategy | `maCrossover.ts` |
| `rsi_reversion` | RsiMeanReversionStrategy | `rsiMeanReversion.ts` |
| `bollinger_bands` | BollingerBandsStrategy | `bollingerBands.ts` |
| `loss_recovery` | LossRecoveryStrategy | `lossRecovery.ts` |
| `smc_liquidity` | SmartMoneyConceptsStrategy | `smartMoneyConcepts.ts` |
| `asian_killzone` | AsianKillZoneStrategy | `asianKillZone.ts` |
| `grid_overlay` | GridOverlayStrategy | `gridOverlay.ts` |
| `volatility_arbitrage` | VolatilityArbitrageStrategy | `volatilityArbitrage.ts` |
| `power_breakout` | PowerBreakoutStrategy | `powerBreakout.ts` |
| `scalping_1m` | Scalper1mStrategy | `scalper1m.ts` |
| `gold_alpha` | GoldAlphaStrategy | `goldAlpha.ts` |

### `.env` ENABLED_STRATEGIES (12 entries)

```
scalping_1m, gold_alpha, volatility_arbitrage, power_breakout, smc_liquidity,
rsi_reversion, bollinger_bands, asian_killzone, ml_signal, ma_crossover,
grid_overlay, loss_recovery
```

### `.env.example` ENABLED_STRATEGIES (9 entries — OUTDATED)

```
ma_crossover, rsi_reversion, bollinger_bands, loss_recovery, smc_liquidity,
ml_signal, volatility_arbitrage, grid_overlay, asian_killzone
```

> **Findings:**
> - `ml_signal` is in both configs but has no Strategy class — handled as special case in main loop via `MLClient.predict()`. Correct by design but breaks strategy interface contract.
> - `.env.example` is missing `scalping_1m`, `gold_alpha`, and `power_breakout` — fresh installs will skip these.
> - `loss_recovery` has no entry in `DEFAULT_BUDGETS` in `strategyAllocator.ts` — gets fallback 0.25 budget.

---

## 3. Critical Bugs — Prioritized Issue List

### CRITICAL

#### C-1: XAU/USD pip size inconsistency (ACTIVELY CAUSING OVERSIZED TRADES)

**Root cause:** Three different pipSize values for Gold across the codebase:

| Location | pipSize | Effect |
|----------|---------|--------|
| `riskManager.ts:229` | `0.01` | Position sizing uses this — **100x too small stop distance** |
| `tradingEngine.ts:270` | `0.10` | SL/TP price calculation uses this |
| `backtest/engine.ts:48` | `0.10` | Backtest uses this |
| `goldAlpha.ts:22` | `0.01` | Strategy uses this for SL/TP pips calculation |

**Impact:** When `riskManager.calculatePositionSize()` computes the stop-loss distance at line 314 (`slDistance = slPips * pipSize`), it uses `pipSize = 0.01` for Gold. But when the trading engine applies the same SL, it uses `pipSize = 0.10`. This means the risk manager thinks the stop is 10x tighter than it actually is, resulting in positions sized 10x too large.

**Evidence from user logs:** Live demo trades showed 3.75 oz (~0.04 lot) when config says 0.01 lot and `risk_pct=1.5`. Risk log showed open risk $6.75 vs cap $3.06-$3.23.

**Fix:** Gold pip value for MT5/CFD Gold is $0.10 per pip (1 pip = 0.10 price movement). Set `pipSize = 0.10` in `riskManager.ts:229` to match the engine and backtester.

---

#### C-2: goldAlpha.ts pipSize also 0.01 — SL/TP pips are 10x inflated

`goldAlpha.ts:22` uses `pipSize = 0.01`, so when it computes `stopLossPips = Math.round((effectiveAtr * 1.2) / pipSize)`, a typical Gold ATR of ~8.0 becomes:
- With 0.01: `Math.round(9.6 / 0.01) = 960 pips`
- Correct with 0.10: `Math.round(9.6 / 0.10) = 96 pips`

The hardcoded clamp in `tradingEngine.ts:290` (`slPips = Math.min(18, Math.max(12, slPips))`) catches this, but that makes the dynamic ATR-based SL completely pointless — always 12-18 pips regardless of volatility.

---

#### C-3: `RISK_MAX_POSITION_SIZE_PCT` hard cap is 5.0% — violates safety invariant #1

Master Prompt mandates 2% hard cap enforced in code, but:
- `.env:35` sets `RISK_MAX_POSITION_SIZE_PCT=5.0`
- `riskManager.ts:286`: `const hardCap = Math.max(config.RISK_MAX_POSITION_SIZE_PCT, config.RISK_STRETCH_CAP_PCT)` — takes the LARGER of the two, meaning `max(5.0, 2.25) = 5.0%`.

**Fix:** Change to `Math.min(...)` and set env to `RISK_MAX_POSITION_SIZE_PCT=2.0`.

---

#### C-4: `RISK_CONFIDENCE_MIN_THRESHOLD=0.40` makes confidence gating useless

With threshold at 0.40, virtually any signal passes (most strategies hard-code confidence >= 0.78). The tiered sizing system effectively never discards.

---

### HIGH

#### H-1: `checkTotalOpenRisk` ceiling too tight for $50 accounts

`RISK_CUMULATIVE_OPEN_RISK_CEILING_PCT=6.0%` on $50 = $3.00 ceiling. A single Gold 0.01 lot with 15-pip stop uses $1.50. Max 2 positions before all signals are rejected.

#### H-2: Lot size bounds inconsistent (0.07 in code vs 0.05 in Telegram UI)

#### H-3: `requestedLots` bypass ignores risk sizing entirely

#### H-4: Duplicate Kelly module files (`risk/` and `analytics/`)

#### H-5: Weekend guard uses hardcoded UTC times, conflicts with stop-at-*.js scripts

#### H-6: Redis imported but never used

#### H-7: `ecosystem.config.js` hardcodes MT5 credentials

---

### MEDIUM

#### M-1: 4 test suites failing (6 tests) — expectations drifted from code

#### M-2: Two backtest engines exist and may give different results

#### M-3: No candle validation (NaN, gaps, duplicates)

#### M-4: `STARTING_BALANCE` always used as `dayStartEquity` — not actual equity at market open

#### M-5: No symbol normalization module — Gold referenced as XAU/USD, XAUUSD across codebase

#### M-6: README describes OANDA, port 3000 — actual system uses Polygon/GoldAPI, port 4000

#### M-7: Profit target $15 on $50 account requires 30% daily return (unrealistic)

#### M-8: `riskMultiplier=0` falls through to 0.01 lot minimum instead of blocking

---

### LOW

#### L-1: Simulator Gold price hardcoded to $4,146

#### L-2: `run_backtest_check.ts` banner says "100 simulations" but runs 10

#### L-3: ForceExit in Jest — open handles not cleaned up

#### L-4: `CORS_ALLOWED_ORIGIN=*` in production env

#### L-5: No rate limiting on API routes

#### L-6: Multiple hardcoded stop scripts should be consolidated

---

## 4. Data Path Trace

```
GoldAPI/Massive/TwelveData/AlphaVantage/Simulator
        |
  PriceFeed.fetchCandles() / fetchLatestQuotes()
        | (cached 15min for candles, 30s for quotes)
  Main Loop (index.ts) — every POLL_INTERVAL_SECONDS (5s)
        |
  +- TradingEngine.syncWithBroker()    <- MT5 position sync
  +- TradingEngine.updatePositionsAndCheckSLTP() <- SL/TP/trailing
  +- TradingEngine.checkCircuitBreakers()  <- equity drawdown
  |
  +- For each CURRENCY_PAIR:
       +- PriceFeed.fetchCandles(pair, 100, '1m')
       +- PriceFeed.fetchCandles(pair, 30, '1day')  <- macro MTF
       +- RegimeDetector.detectRegime()
       |
       +- For each enabled Strategy:
            +- strategy.onCandle(candle, context)
            +- MTF Trend Gate check
            +- Hedge Guard check
            |
            +- TradingEngine.executeOrder()
                 +- TimeFilter.canTrade()
                 +- NewsFilter.canTrade()
                 +- RiskManager.checkPositionLimit()
                 +- RiskManager.checkDailyMaxTrades()
                 +- RiskManager.checkDailyProfitLock()
                 +- RiskManager.checkDailyLossLimit()
                 +- RiskManager.checkWeeklyLossLimit()
                 +- RiskManager.checkCorrelationExposure()
                 +- RiskManager.calculateSizedOrder()  <- C-1 BUG
                 +- RiskManager.checkTotalOpenRisk()
                 |
                 +- MT5Client.placeOrder()  <- or simulator
                 +- INSERT INTO positions
                 +- INSERT INTO trades (status=OPEN)
                 |
                 +- engineEvents.emit('position_update')
                      +- WebSocket broadcast + Telegram
```

### State Inconsistency Risks

1. **Crash mid-trade:** If process crashes after `MT5Client.placeOrder()` succeeds but before `INSERT INTO positions` — MT5 position exists but local DB doesn't know. `syncWithBroker()` reconciliation loop handles this.

2. **Duplicate signals:** Multiple strategies can fire for same pair in same tick. Same-pair guard limits concurrent positions, hedge guard prevents opposite-direction. But two strategies can both open BUY on same pair in same tick.

3. **Restart with open positions:** Positions table is persistent. `max_favorable_price` for trailing stop may be stale after downtime.

---

## 5. Build & Test Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Clean (0 errors) |
| `npm test` | 4 suites fail, 6 tests fail, 127 pass |
| Python tests | Not run |

---

## 6. API Rate Limits

| Provider | Rate Limit | Handling |
|----------|------------|----------|
| Massive/Polygon | 5 req/min | 2.5s throttle (correct) |
| TwelveData | 8 req/min | No throttle (fallback only) |
| AlphaVantage | 5 req/min | No throttle (fallback) |
| GoldAPI.io | 10 req/day | 5s cache |

No explicit 429 retry-after handling for any provider.

---

## 7. Redis Usage

`src/db/redis.ts` exists but is not imported or used anywhere. Dead dependency — safe to remove.

---

## 8. Immediate Fix Plan

| ID | Fix | Risk |
|----|-----|------|
| C-1 | Set `pipSize = 0.10` for Gold in `riskManager.ts` | Low |
| C-2 | Set `pipSize = 0.10` for Gold in `goldAlpha.ts` | Low |
| C-3 | `Math.max` -> `Math.min` for hard cap, env -> 2.0 | Low |
| C-4 | Raise `RISK_CONFIDENCE_MIN_THRESHOLD` to 0.60 | Low |
| H-7 | Move MT5 creds to env vars in ecosystem.config | Low |
| M-1 | Update 4 failing test suites | Low |

**Proceed to Phase 1?**
