import { Scalper1mStrategy } from '../src/strategy/scalper1m';
import { MarketContext, Candle } from '../src/strategy/strategy.interface';

describe('Scalper1mStrategy', () => {
  const strategy = new Scalper1mStrategy();

  test('returns null for non-1m granularity candles', () => {
    const candle: Candle = {
      time: '2026-07-26T08:00:00.000Z', // 08:00 UTC (London session)
      instrument: 'EUR/USD',
      granularity: '15min', // 15m candle passed to 1m scalper
      open: 1.0800,
      high: 1.0810,
      low: 1.0790,
      close: 1.0805,
      volume: 100,
    };

    const context: MarketContext = {
      historicalCandles: [candle],
      macroCandles: [candle],
      currentQuote: { instrument: 'EUR/USD', time: candle.time, bid: 1.0804, ask: 1.0806 },
      activePosition: null,
      accountEquity: 10000,
      openPositionsCount: 0,
    };

    const signal = strategy.onCandle(candle, context);
    expect(signal).toBeNull();
  });

  test('returns null outside London and NY opening hours', () => {
    const candle: Candle = {
      time: '2026-07-26T03:00:00.000Z', // 03:00 UTC (Outside open hours)
      instrument: 'EUR/USD',
      granularity: '1min',
      open: 1.0800,
      high: 1.0810,
      low: 1.0790,
      close: 1.0805,
      volume: 100,
    };

    const context: MarketContext = {
      historicalCandles: [candle],
      macroCandles: [candle],
      currentQuote: { instrument: 'EUR/USD', time: candle.time, bid: 1.0804, ask: 1.0806 },
      activePosition: null,
      accountEquity: 10000,
      openPositionsCount: 0,
    };

    const signal = strategy.onCandle(candle, context);
    expect(signal).toBeNull();
  });
});
