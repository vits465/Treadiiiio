import { FrictionModel } from '../src/analytics/frictionModel';
import { HistoricalDataCache } from '../src/data/historicalDataCache';
import { runBacktestEngine, runMonteCarloRobustness } from '../src/analytics/backtestEngine';
import { initDb, db } from '../src/db';
import * as fs from 'fs';
import * as path from 'path';

describe('Phase 4 — Backtesting Realism & Statistical Validation', () => {
  beforeAll(() => {
    initDb();
  });

  describe('1. Friction Realism Module', () => {
    test('widens spread during Asian session and daily bank rollover', () => {
      const londonTime = '2026-10-07T14:00:00Z'; // London / NY overlap
      const asianTime = '2026-10-07T03:00:00Z';  // Asian session
      const rolloverTime = '2026-10-07T22:00:00Z'; // Daily rollover

      const londonSpread = FrictionModel.getDynamicSpreadPips('EUR/USD', londonTime);
      const asianSpread = FrictionModel.getDynamicSpreadPips('EUR/USD', asianTime);
      const rolloverSpread = FrictionModel.getDynamicSpreadPips('EUR/USD', rolloverTime);

      expect(asianSpread).toBeGreaterThan(londonSpread);
      expect(rolloverSpread).toBeGreaterThan(asianSpread);
    });

    test('adds adverse slippage on Stop-Loss market fills', () => {
      const normalSlip = FrictionModel.getSlippagePips(false);
      const stopSlip = FrictionModel.getSlippagePips(true);

      expect(stopSlip).toBeGreaterThan(normalSlip);
    });

    test('calculates overnight swap financing and charges 3x on Wednesday', () => {
      const normalNightEntry = '2026-10-06T20:00:00Z'; // Tuesday
      const normalNightExit = '2026-10-07T06:00:00Z';  // Wednesday morning

      const wedNightEntry = '2026-10-07T20:00:00Z'; // Wednesday evening
      const wedNightExit = '2026-10-08T06:00:00Z';  // Thursday morning

      const normalSwap = FrictionModel.calculateSwapCostUsd('EUR/USD', 'BUY', 100000, normalNightEntry, normalNightExit);
      const wedSwap = FrictionModel.calculateSwapCostUsd('EUR/USD', 'BUY', 100000, wedNightEntry, wedNightExit);

      expect(normalSwap).not.toBe(0);
      expect(Math.abs(wedSwap)).toBeGreaterThan(Math.abs(normalSwap));
    });
  });

  describe('2. Historical Data Cache', () => {
    test('loads and caches multi-year candles to disk', async () => {
      const candles = await HistoricalDataCache.getHistoricalCandles('EUR/USD', '15m', 300);
      expect(candles.length).toBeGreaterThanOrEqual(300);
      expect(candles[0]).toHaveProperty('time');
      expect(candles[0]).toHaveProperty('open');
      expect(candles[0]).toHaveProperty('close');

      const cacheFile = path.resolve(process.cwd(), 'data', 'cache', 'eur_usd_15m.json');
      expect(fs.existsSync(cacheFile)).toBe(true);
    });
  });

  describe('3. Event-Driven Backtester with Real Frictions', () => {
    test('computes complete quant performance metrics and saves JSON report', async () => {
      const result = await runBacktestEngine({
        strategyName: 'power_breakout',
        instrument: 'EUR/USD',
        granularity: '15m',
        candleCount: 300,
        initialCapital: 100.0,
        lotSize: 0.01
      });

      expect(result).toHaveProperty('totalTrades');
      expect(result).toHaveProperty('profitFactor');
      expect(result).toHaveProperty('winRate');
      expect(result).toHaveProperty('sharpeRatio');
      expect(result).toHaveProperty('sortinoRatio');
      expect(result).toHaveProperty('maxDrawdown');
      expect(result).toHaveProperty('totalCommissionsPaid');
      expect(result).toHaveProperty('totalSlippagePaid');
      expect(result).toHaveProperty('equityCurve');
      expect(result).toHaveProperty('botSuggestion');

      // Verify report was written to disk
      const reportFile = path.resolve(process.cwd(), 'data', 'backtest_results', 'latest_report.json');
      expect(fs.existsSync(reportFile)).toBe(true);

      // Verify recorded in SQLite backtest_runs table
      const row = db.prepare('SELECT id, strategy, instrument FROM backtest_runs ORDER BY timestamp DESC LIMIT 1').get() as any;
      expect(row).toBeDefined();
      expect(row.strategy).toBe('power_breakout');
      expect(row.instrument).toBe('EUR/USD');
    });
  });

  describe('4. Monte Carlo Robustness & Parameter Perturbation', () => {
    test('runs trade-order bootstrap reshuffling and parameter perturbation', async () => {
      const report = await runMonteCarloRobustness({
        strategyName: 'ma_crossover',
        instrument: 'EUR/USD',
        candleCount: 200,
        initialCapital: 100.0,
        lotSize: 0.01
      }, 50);

      expect(report.simulations).toBe(50);
      expect(report).toHaveProperty('medianReturnPct');
      expect(report).toHaveProperty('worstCaseReturnPct');
      expect(report).toHaveProperty('medianMaxDrawdown');
      expect(report.parameterPerturbation).toHaveProperty('perturbedRuns');
      expect(report.parameterPerturbation).toHaveProperty('isOverfit');
    });
  });
});
