# Treadiiiio — Master Upgrade Prompt

> **How to use:** Open Claude Code (or your AI coding agent) at the root of the Treadiiiio repository, then copy-paste everything below the line. Work through it phase by phase — do not skip Phase 0.

---

You are a senior quantitative developer and trading-systems engineer working inside the **Treadiiiio** repository: a Forex paper-trading bot with three services — a Node.js/TypeScript trading engine (`src/`), a Next.js dashboard (`dashboard/`), and a Python FastAPI + XGBoost ML microservice (`ml-service/`). It uses Twelve Data (or a built-in tick simulator) for prices, SQLite for storage, PM2 + a watchdog for process management, and has an optional MT5 Python bridge and Telegram notifications.

## Mission

Audit, fix, and upgrade this bot end-to-end so that it is:
1. **Bug-free and deterministic** in its engine, risk, and PnL logic,
2. **Statistically validated** with realistic, long-horizon backtests,
3. **Fully live-synced** with the dashboard in real time,
4. **Safe by design**, with every protection covered by tests.

**Honesty rule:** never claim or target "100% accuracy" or guaranteed profits — that is impossible in trading. Optimize for the measurable robustness targets in "Definition of Done." If any code comment, log message, or doc implies guaranteed results, correct it.

## Safety invariants (never violate, in any phase)

1. The `RISK_MAX_POSITION_SIZE_PCT` hard cap of **2%** must be enforced in code, not just config.
2. **Paper/simulator mode stays the default** (`USE_SIMULATOR=true`). Any live/MT5 path requires a separate explicit opt-in flag plus a loud startup confirmation log.
3. **Never introduce Martingale** or unbounded recovery sizing. Bounded loss recovery stays exactly as designed (max attempts, cumulative cap, auto-disable + cooldown).
4. All existing halts — daily 5% loss, weekly 12% loss, 30% peak-equity drawdown breaker, consecutive-loss cooldown, daily profit lock — must survive every refactor. Write unit tests protecting them **before** touching related code.
5. Never commit secrets. `.env` and `.env.local` stay gitignored.

---

## Phase 0 — Repository audit (do this first; report before changing code)

1. Produce a complete file map of `src/`, `dashboard/`, `ml-service/`, and `tests/` with a one-line purpose for each file.
2. List every strategy actually implemented in `src/strategy/` and compare against `ENABLED_STRATEGIES` in `.env.example` (`ma_crossover, rsi_reversion, bollinger_bands, ml_signal, loss_recovery`). **Specifically check whether a "power"/momentum strategy and a "scalping" strategy exist anywhere in the code.** Report any strategy present in code but missing from config/docs/dashboard, or vice versa.
3. Trace the full data path: price fetch → candle aggregation → strategy evaluation → risk checks → engine execution → DB write → API → dashboard. Note every place where state could become inconsistent (race conditions, crash mid-trade, restart with open positions, duplicate signals in one cycle).
4. Verify documentation drift. Known examples to confirm: the README describes OANDA, port 3000, and `EUR_USD` underscore symbols, while `.env.example` uses Twelve Data, `PORT=4000`, and `EUR/USD` slash symbols. Decide one canonical symbol format and one canonical port.
5. Run `npm run build`, `npm test`, and the Python unit tests. Record every failure and warning.
6. Check Twelve Data API usage against its plan rate limits for the configured pairs at `POLL_INTERVAL_SECONDS=60`, including behavior on HTTP 429 (back-off? crash? silent stale data?).
7. Check how `redis` (present in package.json) is actually used, and whether the deployment scripts/docs mention it.

**Output of Phase 0:** write `docs/AUDIT.md` with a prioritized issue list (Critical / High / Medium / Low). Small, safe fixes may proceed immediately; wait for approval before large structural changes.

---

## Phase 1 — Correctness fixes

1. Fix every Critical and High issue from the audit.
2. **Engine correctness checklist** (each item verified by a unit test):
   - BUY positions close at **bid**, SELL positions close at **ask**; spread is applied correctly on entry AND exit.
   - SL/TP checks use the correct side of the quote and handle **gap-through** (price jumping past SL) by filling at the gapped price, not the SL price.
   - PnL math correct per pair, including JPY pairs (pip = 0.01) vs 4-decimal pairs (pip = 0.0001), with correct pip-value conversion into the account currency.
   - Position sizing: risk % → units respecting the 0.01 minimum lot, and the small-account rule (balance < $200 forces 0.5% risk; cancel instead of rounding up when min lot exceeds budget).
   - No code path can open a trade without passing through the RiskManager (audit every call site).
   - **Restart safety:** on boot, open positions reload from SQLite and re-price correctly; duplicate or orphaned positions are impossible (idempotent order IDs).
3. **Timezone correctness:** all session logic (LONDON/NY), news blackout windows, and daily/weekly reset boundaries computed in UTC with explicit conversion. Add tests around midnight rollover, Friday close, and Sunday open. Replace the hardcoded `stop-at-7pm.js` / `stop-at-1145pm.js` scripts with one config-driven scheduler (node-cron is already a dependency) with an explicit timezone setting.
4. **Symbol normalization module:** single source of truth mapping `EUR/USD` ↔ `EUR_USD` ↔ `EURUSD` (Twelve Data / internal / MT5 formats). All services import it.
5. **Data hygiene:** validate incoming candles (no NaN, monotonic timestamps, gap detection and logging), dedupe ticks, and tag DB rows as simulator vs real data so results are never mixed.

---

## Phase 2 — Strategy layer upgrade

Goal: fewer, better trades. Every strategy must implement one shared interface:

```ts
evaluate(candles, context) → { signal: 'BUY'|'SELL'|'NONE', confidence: 0..1, reason: string, sl: number, tp: number }
```

…and register in a single strategy registry that config, the dashboard Strategy Lab, and the backtester all consume automatically (adding a strategy file = it appears everywhere).

1. **Regime router (new):** classify each pair each cycle as TRENDING / RANGING / HIGH-VOLATILITY using ADX(14) and ATR percentile. Route: trending → trend strategies (MA crossover, Power); ranging → mean reversion (RSI, Bollinger); high-vol or news window → no new entries. Log the regime with every accepted AND rejected signal so the dashboard rejection log can show it.
2. **Power (momentum/breakout) strategy — implement or harden if it already exists:** Donchian-channel or previous-session high/low breakout, ADX > 25 trend filter, ATR-expansion confirmation, entries only near session opens, ATR-based SL, trail after +1R. Make every threshold configurable.
3. **Scalping strategy — implement properly or fix the existing one:** scalping is invalid on 15m candles polled every 60s. Requirements:
   - 1-minute candles (aggregate from the fastest feed available on the current data plan),
   - active only during London and New York opening hours,
   - hard spread filter: skip entry if current spread > 25% of the TP distance,
   - small fixed TP (e.g., 5–8 pips) with SL ≤ TP distance,
   - time-stop: close the trade after N minutes if neither SL nor TP hit,
   - max-trades-per-hour throttle and a daily scalp-loss sub-limit.
   - If reliable 1m data is not available on the current API plan, still implement it but keep it disabled with a clear log line explaining exactly why.
4. **Multi-timeframe confirmation:** 15m entries must align with the 1h trend direction (configurable per strategy).
5. **Exit upgrades (engine-level, available to all strategies):** optional break-even move at +1R, ATR trailing stop, partial take-profit (close 50% at +1R, let the rest run), and max-holding-time exit. All configurable via env and visible in the dashboard.
6. Every new rule/parameter gets: a config entry with a sane default, Zod validation, dashboard visibility, and backtester support. No hidden magic numbers.

---

## Phase 3 — ML upgrades (`ml-service/`)

1. Replace the naive train/test split with **walk-forward validation** (rolling windows) and **purged/embargoed splits** to eliminate lookahead leakage.
2. **Labeling:** implement triple-barrier labels (TP hit / SL hit / time expiry) that match the engine's actual ATR-based SL/TP multipliers, instead of simple next-candle direction.
3. **Calibrate probabilities** (isotonic or Platt scaling) so `ML_MIN_CONFIDENCE=0.62` means a real 62%. Store the calibration curve in the DB for the Model Monitor panel.
4. **Drift detection:** monitor feature-distribution drift (PSI or KS test) and live accuracy vs validation accuracy; flag on threshold breach and optionally auto-retrain.
5. **Feature discipline:** document every feature; add regime features (ADX, ATR percentile, session one-hot, hour-of-day); remove anything not available at prediction time.
6. **Serving resilience:** export the trained XGBoost model to ONNX and load it in-process in Node as a fallback when the Python service is down (FastAPI remains the primary trainer/server).
7. **Model versioning:** persist model hash, training window, and metrics per version; the Model Monitor shows version history and which version made each trade.

---

## Phase 4 — Backtesting & validation

1. Extend `src/analytics/backtestEngine` to run on **real historical data**: at least 2 years of 15m data per pair (and 6+ months of 1m data for the scalper), downloaded once and cached locally. 500 synthetic candles is not a valid sample — also fix `run_backtest_check.ts`, whose banner says "100 simulations" while the code runs 10.
2. **Friction realism:** per-pair spread models (wider during Asian session and around news), slippage, commission, and nightly swap/rollover. The backtester and the paper engine must share one friction module so their numbers can never diverge.
3. **Walk-forward evaluation** for every strategy and for the combined default portfolio, with per-regime performance breakdown.
4. **Monte Carlo robustness:** trade-order reshuffling AND parameter perturbation (±20% on key parameters). Flag any strategy whose edge disappears under perturbation as overfit.
5. **Standard report per run:** total return, CAGR, max drawdown, profit factor, Sharpe/Sortino, win rate, average R, expectancy per trade, trade count, per-strategy and per-pair breakdown. Save as JSON and render in the dashboard Backtest panel.
6. **A/B guard:** a new strategy or parameter change may only become a default if it beats the current default out-of-sample, after costs.

---

## Phase 5 — Risk additions (keep 100% of the existing risk logic)

1. **Volatility circuit breaker:** pause new entries on a pair when its ATR spikes above the 95th percentile of the last N days.
2. **Equity-curve throttle:** when equity is below its own 20-trade moving average, cut base risk in half until it recovers.
3. **Per-strategy quarantine:** if a strategy's rolling 30-trade profit factor drops below 1.0, auto-disable it, notify via Telegram + dashboard, and require manual re-enable.
4. **Correlation-aware exposure:** use `CORRELATION_GROUPS` to cap net same-direction exposure per group (verify what exists; extend from position count to net direction).
5. **Margin/leverage guard** for the MT5 path: maximum effective leverage and minimum free-margin % checks before any live order.

---

## Phase 6 — Dashboard live interaction

1. **Real-time transport:** replace REST polling with WebSocket (the `ws` package is already a dependency) or SSE for prices, open-position PnL, equity ticks, new signals, and rejection events. REST remains as fallback.
2. **Security:** enforce `API_SECRET_KEY` on every REST route AND the WebSocket handshake; set `CORS_ALLOWED_ORIGIN` correctly for the deployed dashboard origin (Vercel) vs localhost; keep express-rate-limit on sensitive routes; document the tunnel (`start-tunnel.js`) exposure risks and put basic auth in front of it.
3. **Actions audit trail:** every manual action (manual BUY/SELL, kill switch, strategy toggle, config edit) is written to the DB with timestamp and source, and displayed in a dashboard "Actions log."
4. **New panels:** live regime status per pair, per-strategy equity curves, rejection-reason analytics (top reasons per day), ML model version + calibration status, and data-feed health (last tick age, API quota used, 429 counts).
5. **Config editor safety:** server-side Zod validation of every change; refuse any value violating the safety invariants; require typed confirmation for risk-increasing changes.

---

## Phase 7 — Reliability, ops, security

1. **Docker Compose** for all three services with one-command startup; keep the PM2 path working too.
2. **GitHub Actions CI:** typecheck, ESLint, Jest, Python tests, and a small smoke backtest on every push. Red build = blocked.
3. **Health endpoints** (`/health`) for all services reporting data-feed age, DB status, and ML reachability; point the watchdog at them.
4. **SQLite hardening:** WAL mode, busy timeout, daily rotating backups; document a Postgres migration path for live use.
5. **Structured logging:** one correlation ID per trade lifecycle across engine → risk → API (winston is already present; verify rotation works).
6. **Graceful shutdown:** on SIGTERM, stop accepting entries, persist state, close the DB cleanly.
7. **Secrets:** confirm `.gitignore` covers all env files; add a pre-commit secret scan; rotate the default `API_SECRET_KEY`.
8. **Fix the docs:** update README to reality (data provider, ports, symbol format, every env var, all new features) and refresh the user manual's feature list.

---

## Phase 8 — MT5 live-readiness (build it, but keep it disabled by default)

1. Harden the Python MT5 bridge: symbol mapping via the normalization module, per-symbol volume step / minimum lot from broker specs, respect stops-level and freeze-level, retry policy on requotes, full error-code handling.
2. **Reconciliation loop:** every N seconds compare engine state vs actual MT5 positions; on mismatch, alert and halt new entries.
3. **Magic numbers per strategy** so every live position is attributable to its strategy.
4. Write `docs/GO-LIVE-CHECKLIST.md`: minimum 4 weeks on a demo account, 0.1% risk in week one, collect real spread/slippage statistics and feed them back into the backtest friction module, verify Telegram alerts, and physically test the kill switch on a live demo position.

---

## Definition of Done (acceptance criteria)

- `npm run build` clean with zero TypeScript errors; ESLint clean; all Jest and Python tests pass; line coverage ≥ 70% on engine, risk, and strategy modules.
- Walk-forward backtest (≥ 2 years of real data, full costs) for the default portfolio achieves: **profit factor ≥ 1.3, max drawdown ≤ 20%, positive expectancy per trade after costs, ≥ 300 trades in sample.** If a target is not met, do **not** loosen risk limits to force it — report honestly what the data shows and which strategies were quarantined.
- A 72-hour continuous paper session (simulator or live feed) with zero crashes, zero orphaned positions, dashboard updating within 1 second of engine events, and every halt verified to fire in forced-failure tests.
- Every safety invariant is covered by an explicit test that fails if the invariant is removed.
- Deliverables present: `docs/AUDIT.md`, updated `README.md`, `docs/CHANGELOG-UPGRADE.md` listing every change with file paths, `docs/GO-LIVE-CHECKLIST.md`.

## Working rules

- Work phase by phase. After each phase: summarize changes, show diffs of the key files, and run the full test suite.
- Small, reviewable commits with clear messages (e.g., `phase-1: fix JPY pip value in PnL calc`).
- When a requirement is ambiguous, choose the **safer** interpretation and note it in the changelog.
- Never delete existing risk logic to "simplify." Never fabricate backtest results — if data is missing, say so and download/cache it first.

**Begin with Phase 0 now and present the audit report.**
