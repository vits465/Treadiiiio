import { EventDrivenBacktestEngine } from '../src/backtest/engine';
import { MaCrossoverStrategy } from '../src/strategy/maCrossover';
import { Candle } from '../src/data/priceFeed';

function makeCandle(price: number, timeStr: string): Candle {
  return {
    time: timeStr,
    instrument: 'EUR/USD',
    granularity: '1h',
    open: price,
    high: price + 0.0020,
    low: price - 0.0010,
    close: price,
    volume: 100,
  };
}

describe('EventDrivenBacktestEngine & Metrics', () => {
  test('runs backtest and computes quant performance metrics', () => {
    const candles: Candle[] = [];
    let price = 1.0800;
    const baseTime = new Date('2026-01-01T00:00:00Z').getTime();

    for (let i = 0; i < 60; i++) {
      price += (i % 2 === 0 ? 0.0020 : -0.0010);
      const timeStr = new Date(baseTime + i * 3600 * 1000).toISOString();
      candles.push(makeCandle(price, timeStr));
    }

    const result = EventDrivenBacktestEngine.runBacktest(new MaCrossoverStrategy(), candles, {
      startingBalance: 10000,
      spreadPips: 1.5,
      commissionPerLotUsd: 7.0,
    });

    expect(result.metrics).toBeDefined();
    expect(result.metrics.winRate).toBeGreaterThanOrEqual(0);
    expect(result.metrics.winRate).toBeLessThanOrEqual(100);
    expect(result.equityCurve.length).toBeGreaterThan(0);
  });
});
