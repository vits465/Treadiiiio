import { WalkForwardOptimizer } from '../src/backtest/walkForward';
import { MaCrossoverStrategy } from '../src/strategy/maCrossover';
import { Candle } from '../src/data/priceFeed';

describe('WalkForwardOptimizer', () => {
  test('calculates Walk-Forward Efficiency (WFE) score', () => {
    const candles: Candle[] = [];
    let price = 1.0800;
    const baseTime = new Date('2026-01-01T00:00:00Z').getTime();

    for (let i = 0; i < 120; i++) {
      price += (i % 3 === 0 ? 0.0030 : -0.0010);
      const timeStr = new Date(baseTime + i * 3600 * 1000).toISOString();
      candles.push({
        time: timeStr,
        instrument: 'EUR/USD',
        granularity: '1h',
        open: price,
        high: price + 0.0020,
        low: price - 0.0010,
        close: price,
        volume: 100,
      });
    }

    const wfoResult = WalkForwardOptimizer.optimize(new MaCrossoverStrategy(), candles, 3);
    expect(wfoResult.overallWfeScore).toBeGreaterThanOrEqual(0);
    expect(wfoResult.foldsCount).toBe(3);
  });
});
