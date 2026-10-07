import { WalkForwardBacktester } from './walkforward';
import { PowerBreakoutStrategy } from '../strategy/powerBreakout';
import { Scalper1mStrategy } from '../strategy/scalper1m';
import { MaCrossoverStrategy } from '../strategy/maCrossover';
import { RsiMeanReversionStrategy } from '../strategy/rsiMeanReversion';
import { Candle } from '../strategy/strategy.interface';

// Seeded RNG for reproducible multi-regime historical synthetic dataset (1000 candles)
function mulberry32(seed: number) {
  return function (): number {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(101);

function generateMultiRegimeCandles(count: number = 1000): Candle[] {
  const candles: Candle[] = [];
  let price = 1.0850;
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    // Alternate market regimes: Trending (0-300), Ranging (300-700), Volatile Spikes (700-1000)
    let drift = 0.0001;
    let wave = Math.sin(i / 15) * 0.0008;
    let noiseScale = 0.0005;

    if (i >= 300 && i < 700) {
      // Ranging regime
      drift = 0;
      wave = Math.sin(i / 8) * 0.0006;
      noiseScale = 0.0003;
    } else if (i >= 700) {
      // Volatile regime
      drift = Math.sin(i / 50) * 0.0002;
      wave = Math.sin(i / 5) * 0.0020;
      noiseScale = 0.0015;
    }

    const open = price;
    const close = price + drift + wave + (rng() - 0.5) * noiseScale;
    const high = Math.max(open, close) + rng() * noiseScale;
    const low = Math.min(open, close) - rng() * noiseScale;

    candles.push({
      time: new Date(now - (count - i) * 3600 * 1000).toISOString(),
      open,
      high,
      low,
      close,
      volume: Math.floor(rng() * 1000) + 100,
      instrument: 'EUR/USD',
      granularity: '1h',
    });

    price = close;
  }
  return candles;
}

function runAnalysis() {
  console.log('\n========================================================================================');
  console.log('              TREADIIIIO — COST-AWARE WALK-FORWARD BACKTEST RESULTS TABLE                ');
  console.log('========================================================================================\n');

  const candles = generateMultiRegimeCandles(1000);
  const backtester = new WalkForwardBacktester({
    spreadPips: 1.5,
    entrySlippagePips: 0.5,
    stopSlippagePips: 0.5,
    commissionPerLotUsd: 7.0,
  });

  const powerStrat = new PowerBreakoutStrategy();
  const scalperStrat = new Scalper1mStrategy();
  const maStrat = new MaCrossoverStrategy(5, 20);
  const rsiStrat = new RsiMeanReversionStrategy(14, 30, 70);

  const strategies = [
    { name: 'Power Breakout (H1)', instance: powerStrat },
    { name: 'Scalper 1m (M1/M5)', instance: scalperStrat },
    { name: 'MA Crossover (5/20)', instance: maStrat },
    { name: 'RSI Reversion (14)', instance: rsiStrat },
  ];

  const resultsTable = [];

  for (const s of strategies) {
    const wfResult = backtester.runWalkForwardValidation(s.instance, candles, 0.60);
    const oos = wfResult.outOfSampleReport;
    const is = wfResult.inSampleReport;

    resultsTable.push({
      'Strategy Name': s.name,
      'Total Trades (OOS)': oos.totalTrades,
      'Win Rate %': `${oos.winRatePct}%`,
      'Profit Factor': oos.profitFactor,
      'Expectancy $/Trade': `$${oos.expectancyUsdPerTrade}`,
      'Expectancy Pips': `${oos.expectancyPipsPerTrade} pips`,
      'Max Drawdown %': `${oos.maxDrawdownPct}%`,
      'Sharpe Ratio': oos.sharpeRatio,
      'Avg Hold Time': `${oos.avgHoldingTimeMinutes} min`,
      'Cost Impact': `$${oos.costImpactUsd}`,
      'WFE Index': wfResult.stabilityIndex,
    });
  }

  console.table(resultsTable);
  console.log('\n* Note: OOS = Out-of-Sample (40% unseen test window). Costs modeled: 1.5 pip spread, 1.0 pip slippage, $7/lot commission.\n');
}

runAnalysis();
