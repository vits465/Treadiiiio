import { MaCrossoverStrategy } from './strategy/maCrossover';
import { Candle, MarketContext, PositionInfo, Signal } from './strategy/strategy.interface';
import { initDb, db } from './db/index';
import { config } from './config';
import { RiskManager } from './risk/riskManager';

// ---------------------------------------------------------------------------
// Seeded RNG — mulberry32 (seed 42) for deterministic reproducibility
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  return function (): number {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(42);

// ---------------------------------------------------------------------------
// Synthetic candle generator — mild drift + amplitude-modulated wave so both
// TP and SL/adverse-exit paths are exercised.  A 100%-win run validates nothing.
// ---------------------------------------------------------------------------
function generateMockCandles(count: number, intervalSeconds: number = 3600): Candle[] {
  const candles: Candle[] = [];
  let price = 1.1000;
  const now = Date.now();
  const granularity = intervalSeconds === 3600 ? '1h' : intervalSeconds === 900 ? '15min' : '1h';

  for (let i = 0; i < count; i++) {
    // Mild drift with amplitude-modulated wave (slow and fast components)
    // ensures both profitable and adverse candle sequences appear
    const drift = 0.00005;
    const slowWave = Math.sin(i / 40) * 0.0012 * (1 + 0.4 * Math.sin(i / 120));
    const fastWave = Math.sin(i / 8)  * 0.0004;
    const noise = (rng() - 0.5) * 0.0008;

    const open = price;
    const close = price + drift + slowWave + fastWave + noise;
    const high = Math.max(open, close) + rng() * 0.0006;
    const low  = Math.min(open, close) - rng() * 0.0006;

    candles.push({
      time: new Date(now - (count - i) * intervalSeconds * 1000).toISOString(),
      open,
      high,
      low,
      close,
      volume: Math.floor(rng() * 1000) + 100,
      instrument: 'EUR/USD',
      granularity,
    });

    price = close;
  }
  return candles;
}

// ---------------------------------------------------------------------------
// Friction model (matches live engine env vars)
// ---------------------------------------------------------------------------
const HALF_SPREAD_PIPS = config.SPREAD_PIPS / 2;
const ENTRY_SLIPPAGE_PIPS = config.SLIPPAGE_PIPS + config.ALERT_SLIPPAGE_PIPS; // latency + fill
const STOP_SLIPPAGE_PIPS = config.SLIPPAGE_PIPS;  // stops slip against trader
const PIP_SIZE = 0.0001; // EUR/USD

function bidAdjust(price: number, pips: number): number {
  return price - pips * PIP_SIZE;
}
function askAdjust(price: number, pips: number): number {
  return price + pips * PIP_SIZE;
}

// ---------------------------------------------------------------------------
// Backtest runner
// ---------------------------------------------------------------------------
async function runBacktest() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Treadiiiio — Realistic Edge Backtest Engine             ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('⚠  IMPORTANT: This backtest runs on SYNTHETIC (simulated) candles.');
  console.log('   Its output validates engine mechanics — fills, frictions,');
  console.log('   sizing, stop handling — NOT real-market edge or expectancy.');
  console.log('   Run against real historical data before drawing conclusions.');
  console.log('');

  initDb();

  // 1. Generate deterministic synthetic data
  const candles = generateMockCandles(500, 3600); // 500 hourly candles
  console.log(`📊 Generated ${candles.length} deterministic synthetic candles (seed=42)`);

  // 2. Friction report
  console.log(`\n⚙  Friction model:`);
  console.log(`   Half-spread  : ${HALF_SPREAD_PIPS} pips`);
  console.log(`   Entry slip   : ${ENTRY_SLIPPAGE_PIPS} pips (SLIPPAGE_PIPS + ALERT_SLIPPAGE_PIPS)`);
  console.log(`   Stop slip    : ${STOP_SLIPPAGE_PIPS} pips (against trader)`);
  console.log(`   Latency      : Signal fills at next candle open (subsumes ALERT_LATENCY_MS)`);
  console.log(`   Starting bal : $${config.STARTING_BALANCE}`);

  // 3. Initialize strategy
  const strategy = new MaCrossoverStrategy(3, 8);
  console.log(`\n📈 Strategy: ${strategy.name}`);

  // 4. Engine state
  let accountEquity = config.STARTING_BALANCE;

  interface BacktestPosition {
    id: string;
    instrument: string;
    action: 'BUY' | 'SELL';
    entryTime: string;
    entryPrice: number;
    units: number;
    stopLossPrice: number;   // actual price level
    takeProfitPrice: number; // actual price level
    slPips: number;
    tpPips: number;
    riskPctUsed: number;
  }

  interface TradeResult {
    id: string;
    instrument: string;
    action: 'BUY' | 'SELL';
    entryTime: string;
    exitTime: string;
    entryPrice: number;
    exitPrice: number;
    units: number;
    pnl: number;
    rMultiple: number;
    reason: string;
    riskPctUsed: number;
  }

  let activePosition: BacktestPosition | null = null;
  const tradeHistory: TradeResult[] = [];
  let minLotRejections = 0;

  // 5. Main simulation loop
  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i];
    const prevCandles = candles.slice(0, i);
    const latestCandle = prevCandles[prevCandles.length - 1]; // signal detected on previous close

    // --- Intrabar SL/TP evaluation ---
    if (activePosition) {
      const isBuy = activePosition.action === 'BUY';

      // Bid/ask adjusted intrabar high and low
      const intrbarBid = bidAdjust(candle.high, HALF_SPREAD_PIPS);
      const intrbarAsk = askAdjust(candle.low, HALF_SPREAD_PIPS);

      let stopHit = false;
      let tpHit = false;
      let stopFillPrice = 0;
      let tpFillPrice = 0;

      if (isBuy) {
        // BUY: stop below, TP above
        if (candle.low <= activePosition.stopLossPrice) {
          stopHit = true;
          // Stop slips against the trader
          stopFillPrice = Math.min(activePosition.stopLossPrice - STOP_SLIPPAGE_PIPS * PIP_SIZE, candle.low);
        }
        if (candle.high >= activePosition.takeProfitPrice) {
          tpHit = true;
          tpFillPrice = activePosition.takeProfitPrice; // TP fills at level
        }
      } else {
        // SELL: stop above, TP below
        if (candle.high >= activePosition.stopLossPrice) {
          stopHit = true;
          stopFillPrice = Math.max(activePosition.stopLossPrice + STOP_SLIPPAGE_PIPS * PIP_SIZE, candle.high);
        }
        if (candle.low <= activePosition.takeProfitPrice) {
          tpHit = true;
          tpFillPrice = activePosition.takeProfitPrice;
        }
      }

      // Conservative same-bar rule: if both touched, stop fills first
      let exitPrice = 0;
      let reason = '';

      if (stopHit && tpHit) {
        exitPrice = stopFillPrice;
        reason = 'StopLoss (same-bar conservative)';
        stopHit = true; tpHit = false;
      } else if (stopHit) {
        exitPrice = stopFillPrice;
        reason = 'StopLoss';
      } else if (tpHit) {
        exitPrice = tpFillPrice;
        reason = 'TakeProfit';
      }

      if (stopHit || tpHit) {
        const pnl = isBuy
          ? (exitPrice - activePosition.entryPrice) * activePosition.units
          : (activePosition.entryPrice - exitPrice) * activePosition.units;

        const rMultiple = pnl / (activePosition.riskPctUsed / 100 * accountEquity);

        tradeHistory.push({
          id: activePosition.id,
          instrument: activePosition.instrument,
          action: activePosition.action,
          entryTime: activePosition.entryTime,
          exitTime: candle.time,
          entryPrice: activePosition.entryPrice,
          exitPrice,
          units: activePosition.units,
          pnl,
          rMultiple,
          reason,
          riskPctUsed: activePosition.riskPctUsed,
        });

        accountEquity += pnl;
        activePosition = null;
      }
    }

    // --- Strategy signal evaluation ---
    if (!activePosition) {
      const context: MarketContext = {
        historicalCandles: prevCandles,
        currentQuote: {
          instrument: 'EUR/USD',
          bid: bidAdjust(latestCandle.close, HALF_SPREAD_PIPS),
          ask: askAdjust(latestCandle.close, HALF_SPREAD_PIPS),
          time: latestCandle.time,
        },
        activePosition: null,
        accountEquity,
        openPositionsCount: 0,
      };

      const signal: Signal | null = strategy.onCandle(latestCandle, context);

      if (signal && (signal.action === 'BUY' || signal.action === 'SELL')) {
        const slPips = signal.stopLossPips || 20;
        const tpPips = signal.takeProfitPips || (slPips * config.ATR_TP_MULTIPLIER / config.ATR_SL_MULTIPLIER);

        // Latency model: fill at NEXT candle's open (candle = candles[i])
        const fillCandle = candle;
        const isBuy = signal.action === 'BUY';

        // Entry with spread + slippage
        const entryPrice = isBuy
          ? askAdjust(fillCandle.open, HALF_SPREAD_PIPS + ENTRY_SLIPPAGE_PIPS)
          : bidAdjust(fillCandle.open, HALF_SPREAD_PIPS + ENTRY_SLIPPAGE_PIPS);

        // Dynamic sizing using the live risk manager
        const sized = RiskManager.calculateSizedOrder('EUR/USD', slPips, accountEquity);
        if (sized.units <= 0) {
          minLotRejections++;
          continue;
        }

        const stopLossPrice = isBuy
          ? entryPrice - slPips * PIP_SIZE
          : entryPrice + slPips * PIP_SIZE;
        const takeProfitPrice = isBuy
          ? entryPrice + tpPips * PIP_SIZE
          : entryPrice - tpPips * PIP_SIZE;

        activePosition = {
          id: `bt_${i}`,
          instrument: 'EUR/USD',
          action: signal.action,
          entryTime: fillCandle.time,
          entryPrice,
          units: sized.units,
          stopLossPrice,
          takeProfitPrice,
          slPips,
          tpPips,
          riskPctUsed: sized.riskPctUsed,
        };
      }
    }
  }

  // Force-close any open position at last candle close
  if (activePosition && candles.length > 0) {
    const last = candles[candles.length - 1];
    const isBuy = activePosition.action === 'BUY';
    const exitPrice = isBuy
      ? bidAdjust(last.close, HALF_SPREAD_PIPS)
      : askAdjust(last.close, HALF_SPREAD_PIPS);
    const pnl = isBuy
      ? (exitPrice - activePosition.entryPrice) * activePosition.units
      : (activePosition.entryPrice - exitPrice) * activePosition.units;
    const rMultiple = pnl / (activePosition.riskPctUsed / 100 * accountEquity);
    tradeHistory.push({
      id: activePosition.id,
      instrument: activePosition.instrument,
      action: activePosition.action,
      entryTime: activePosition.entryTime,
      exitTime: last.time,
      entryPrice: activePosition.entryPrice,
      exitPrice,
      units: activePosition.units,
      pnl,
      rMultiple,
      reason: 'EndOfData',
      riskPctUsed: activePosition.riskPctUsed,
    });
    accountEquity += pnl;
  }

  // ---------------------------------------------------------------------------
  // R-multiple metrics
  // ---------------------------------------------------------------------------
  const wins = tradeHistory.filter((t) => t.pnl > 0);
  const losses = tradeHistory.filter((t) => t.pnl <= 0);
  const rMultiples = tradeHistory.map((t) => t.rMultiple);
  const winRate = tradeHistory.length > 0 ? wins.length / tradeHistory.length : 0;

  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : wins.length > 0 ? Infinity : 0;

  const meanR = rMultiples.length > 0 ? rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length : 0;
  const EPSILON = 1e-10;
  const varR = rMultiples.length > 1
    ? rMultiples.reduce((acc, v) => acc + Math.pow(v - meanR, 2), 0) / (rMultiples.length - 1)
    : 0;
  const stdR = Math.sqrt(varR);
  const sharpeR = stdR > EPSILON ? meanR / stdR : 0;

  const downsideVar = rMultiples.filter((r) => r < 0).reduce((acc, r) => acc + r * r, 0);
  const sortinoR = rMultiples.length > 1 && downsideVar > EPSILON
    ? meanR / Math.sqrt(downsideVar / rMultiples.length)
    : 0;

  // Max drawdown
  let peak = config.STARTING_BALANCE;
  let maxDD = 0;
  let running = config.STARTING_BALANCE;
  for (const t of tradeHistory) {
    running += t.pnl;
    if (running > peak) peak = running;
    const dd = peak > 0 ? (peak - running) / peak * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }

  // ---------------------------------------------------------------------------
  // Save to DB (transactional DELETE, not DROP TABLE)
  // ---------------------------------------------------------------------------
  console.log('\n💾 Saving backtest results to database...');
  const saveToDb = db.transaction(() => {
    db.prepare('DELETE FROM trades WHERE strategy = ?').run('ma_crossover_backtest');
    db.prepare('DELETE FROM equity_snapshots').run();

    let runningEquity = config.STARTING_BALANCE;
    for (const t of tradeHistory) {
      db.prepare(`
        INSERT INTO trades (id, instrument, action, entry_time, exit_time, entry_price, exit_price, units, pnl, strategy, status, risk_pct)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        t.id, t.instrument, t.action, t.entryTime, t.exitTime,
        t.entryPrice, t.exitPrice, t.units, t.pnl,
        'ma_crossover_backtest', 'CLOSED', t.riskPctUsed
      );

      runningEquity += t.pnl;
      db.prepare(`
        INSERT OR REPLACE INTO equity_snapshots (time, balance, equity, unrealized_pnl, drawdown)
        VALUES (?, ?, ?, ?, ?)
      `).run(t.exitTime, runningEquity, runningEquity, 0, 0);
    }
  });
  saveToDb();
  console.log(`   Saved ${tradeHistory.length} trades and equity snapshots.`);

  // ---------------------------------------------------------------------------
  // Output
  // ---------------------------------------------------------------------------
  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│                    BACKTEST RESULTS                    │');
  console.log('└─────────────────────────────────────────────────────────┘');
  console.log(`  Total Trades       : ${tradeHistory.length}`);
  console.log(`  Min-lot Rejections : ${minLotRejections}`);
  console.log(`  Win Rate           : ${(winRate * 100).toFixed(1)}%  (${wins.length}W / ${losses.length}L)`);
  console.log(`  Profit Factor      : ${profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)}`);
  console.log(`  Expectancy (R)     : ${meanR.toFixed(3)} R`);
  console.log(`  Sharpe (R)         : ${sharpeR.toFixed(3)}`);
  console.log(`  Sortino (R)        : ${sortinoR.toFixed(3)}`);
  console.log(`  Max Drawdown       : ${maxDD.toFixed(2)}%`);
  console.log(`  Start Balance      : $${config.STARTING_BALANCE.toFixed(2)}`);
  console.log(`  Final Equity       : $${accountEquity.toFixed(2)}`);
  console.log(`  Net Return         : ${(((accountEquity - config.STARTING_BALANCE) / config.STARTING_BALANCE) * 100).toFixed(2)}%`);
  console.log('');
  console.log('⚠  Results above are from synthetic data — NOT a real edge estimate.');
  console.log('   Use this to verify engine mechanics, not to project real returns.');
  console.log('');
}

runBacktest().catch(console.error);
