import { RegimeRouter } from '../src/analytics/regimeRouter';
import { Candle } from '../src/data/priceFeed';

function makeCandle(c: number, h?: number, l?: number): Candle {
  return {
    time: new Date().toISOString(),
    instrument: 'EUR/USD',
    granularity: '15min',
    open: c,
    high: h ?? c + 0.0010,
    low: l ?? c - 0.0010,
    close: c,
    volume: 100,
  };
}

describe('RegimeRouter Module', () => {
  test('calculates ADX accurately for trend series', () => {
    const candles: Candle[] = [];
    let price = 1.0500;
    for (let i = 0; i < 40; i++) {
      price += 0.0015; // Strong uptrend
      candles.push(makeCandle(price, price + 0.0010, price - 0.0005));
    }

    const adx = RegimeRouter.calculateADX(candles, 14);
    expect(adx).toBeGreaterThan(20);
  });

  test('classifies trending market when ADX >= 25', () => {
    const candles: Candle[] = [];
    let price = 1.1000;
    for (let i = 0; i < 50; i++) {
      price += 0.0020;
      candles.push(makeCandle(price, price + 0.0015, price - 0.0005));
    }

    const result = RegimeRouter.evaluateRegime(candles, 'EUR/USD');
    expect(['TRENDING', 'HIGH_VOLATILITY']).toContain(result.regime);
  });

  test('routes trend strategies in TRENDING regime and blocks in HIGH_VOLATILITY', () => {
    expect(RegimeRouter.isStrategyAllowedForRegime('ma_crossover', 'TRENDING')).toBe(true);
    expect(RegimeRouter.isStrategyAllowedForRegime('power_breakout', 'TRENDING')).toBe(true);
    expect(RegimeRouter.isStrategyAllowedForRegime('rsi_reversion', 'RANGING')).toBe(true);
    expect(RegimeRouter.isStrategyAllowedForRegime('ma_crossover', 'HIGH_VOLATILITY')).toBe(false);
  });
});
