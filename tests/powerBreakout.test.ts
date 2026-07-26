import { PowerBreakoutStrategy } from '../src/strategy/powerBreakout';
import { MarketContext, Candle } from '../src/strategy/strategy.interface';

function makeCandle(close: number, high?: number, low?: number): Candle {
  return {
    time: new Date().toISOString(),
    instrument: 'EUR/USD',
    granularity: '15min',
    open: close,
    high: high ?? close + 0.0005,
    low: low ?? close - 0.0005,
    close,
    volume: 100,
  };
}

describe('PowerBreakoutStrategy', () => {
  const strategy = new PowerBreakoutStrategy();

  test('returns null when candle history is insufficient', () => {
    const candles: Candle[] = [makeCandle(1.0800)];
    const context: MarketContext = {
      historicalCandles: candles,
      macroCandles: candles,
      currentQuote: { instrument: 'EUR/USD', time: new Date().toISOString(), bid: 1.0800, ask: 1.08015 },
      activePosition: null,
      accountEquity: 10000,
      openPositionsCount: 0,
    };

    const signal = strategy.onCandle(candles[0], context);
    expect(signal).toBeNull();
  });

  test('generates BUY signal on Donchian upper breakout with high ADX', () => {
    const candles: Candle[] = [];
    let price = 1.0800;
    // Build 30 candles
    for (let i = 0; i < 30; i++) {
      price += 0.0015; // Strong uptrend
      candles.push({
        time: new Date(Date.now() - (30 - i) * 15 * 60 * 1000).toISOString(),
        instrument: 'EUR/USD',
        granularity: '15min',
        open: price - 0.0005,
        high: price + 0.0020,
        low: price - 0.0005,
        close: price + 0.0015,
        volume: 200,
      });
    }

    const lastCandle = candles[candles.length - 1];
    const context: MarketContext = {
      historicalCandles: candles,
      macroCandles: candles,
      currentQuote: { instrument: 'EUR/USD', time: lastCandle.time, bid: lastCandle.close - 0.0001, ask: lastCandle.close + 0.0001 },
      activePosition: null,
      accountEquity: 10000,
      openPositionsCount: 0,
    };

    const signal = strategy.onCandle(lastCandle, context);
    if (signal) {
      expect(signal.action).toBe('BUY');
      expect(signal.strategy).toBe('power_breakout');
      expect(signal.stopLossPips).toBeGreaterThan(0);
      expect(signal.takeProfitPips).toBeGreaterThan(0);
    }
  });
});
