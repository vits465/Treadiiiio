import { AsianKillZoneStrategy } from '../src/strategy/asianKillZone';
import { Candle, MarketContext } from '../src/strategy/strategy.interface';

describe('AsianKillZoneStrategy', () => {
  let strategy: AsianKillZoneStrategy;

  beforeEach(() => {
    strategy = new AsianKillZoneStrategy();
  });

  function generateCandle(
    timeStr: string,
    open: number,
    high: number,
    low: number,
    close: number
  ): Candle {
    return {
      time: timeStr,
      instrument: 'XAU/USD',
      granularity: '5m',
      open,
      high,
      low,
      close,
      volume: 1000,
    };
  }

  it('should not generate signal before 11:30 AM IST (06:00 UTC)', () => {
    const candles: Candle[] = [];
    const baseDate = '2026-07-24';

    // Asian session candles (00:00 to 05:55 UTC)
    for (let h = 0; h < 6; h++) {
      for (let m = 0; m < 60; m += 5) {
        const timeStr = `${baseDate}T${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00.000Z`;
        candles.push(generateCandle(timeStr, 2000, 2010, 1990, 2005));
      }
    }

    const context: MarketContext = {
      historicalCandles: candles,
      currentQuote: { instrument: 'XAU/USD', bid: 2005, ask: 2005.5, time: new Date().toISOString() },
      activePosition: null,
      accountEquity: 10000,
      openPositionsCount: 0,
    };

    const signal = strategy.onCandle(candles[candles.length - 1], context);
    expect(signal).toBeNull();
  });

  it('should generate BUY signal on Asian Low sweep + 50 EMA bullish rejection after 11:30 AM IST', () => {
    const candles: Candle[] = [];
    const baseDate = '2026-07-24';

    // 00:00 to 07:55 UTC Asian range (Low = 2000, High = 2020)
    for (let h = 0; h < 8; h++) {
      for (let m = 0; m < 60; m += 5) {
        const timeStr = `${baseDate}T${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00.000Z`;
        const lowVal = (h === 4 && m === 0) ? 2000 : 2005;
        const highVal = (h === 2 && m === 0) ? 2020 : 2015;
        candles.push(generateCandle(timeStr, 2010, highVal, lowVal, 2010));
      }
    }

    // Post 08:00 UTC candles hovering around 2010 (50 EMA around 2010)
    for (let h = 8; h < 10; h++) {
      for (let m = 0; m < 60; m += 5) {
        const timeStr = `${baseDate}T${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00.000Z`;
        candles.push(generateCandle(timeStr, 2010, 2012, 2008, 2010));
      }
    }

    // At 10:00 UTC (well after 06:00 UTC / 11:30 AM IST): low sweeps Asian Low (1998 <= 2000 + 2.5), close = 2015 (above 50 EMA & open)
    const sweepTime = `${baseDate}T10:05:00.000Z`;
    const sweepCandle = generateCandle(sweepTime, 2005, 2016, 1998, 2015);
    candles.push(sweepCandle);

    const context: MarketContext = {
      historicalCandles: candles,
      currentQuote: { instrument: 'XAU/USD', bid: 2015, ask: 2015.5, time: new Date().toISOString() },
      activePosition: null,
      accountEquity: 10000,
      openPositionsCount: 0,
    };

    const signal = strategy.onCandle(sweepCandle, context);
    expect(signal).not.toBeNull();
    expect(signal?.action).toBe('BUY');
    expect(signal?.requestedLots).toBe(0.02);
    expect(signal?.stopLossPips).toBe(200);
    expect(signal?.tp1Pips).toBe(400); // 1:2 RRR
    expect(signal?.tp2Pips).toBe(600); // 1:3 RRR
  });
});
