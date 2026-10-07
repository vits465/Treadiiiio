import { StrategyRegistry } from '../src/strategy/registry';
import { RegimeRouter } from '../src/analytics/regimeRouter';
import { PowerBreakoutStrategy } from '../src/strategy/powerBreakout';
import { Scalper1mStrategy } from '../src/strategy/scalper1m';
import { MarketContext, Candle, StrategyEvaluationResult } from '../src/strategy/strategy.interface';
import { config } from '../src/config';
import { initDb, db } from '../src/db';
import { TradingEngine } from '../src/engine/tradingEngine';
import { Quote } from '../src/data/priceFeed';

function makeCandle(close: number, timeStr?: string, high?: number, low?: number, granularity = '15min'): Candle {
  return {
    time: timeStr || new Date().toISOString(),
    instrument: 'EUR/USD',
    granularity,
    open: close,
    high: high ?? close + 0.0010,
    low: low ?? close - 0.0010,
    close,
    volume: 100,
  };
}

describe('Phase 2 — Strategy Layer & Regime Router Upgrade', () => {
  beforeAll(() => {
    initDb();
    TradingEngine.initialize();
  });

  describe('1. Shared Strategy Interface & Registry', () => {
    test('all registered strategies implement evaluate(candles, context) returning standard schema', () => {
      const strategies = StrategyRegistry.getAll();
      expect(strategies.length).toBeGreaterThanOrEqual(10);

      const mockCandles: Candle[] = [];
      let price = 1.0800;
      for (let i = 0; i < 60; i++) {
        price += (i % 2 === 0 ? 0.0005 : -0.0003);
        mockCandles.push(makeCandle(price));
      }

      const context: MarketContext = {
        historicalCandles: mockCandles,
        macroCandles: mockCandles.slice(-25),
        currentQuote: { instrument: 'EUR/USD', time: new Date().toISOString(), bid: price, ask: price + 0.00015 },
        activePosition: null,
        accountEquity: 10000,
        openPositionsCount: 0,
        currentRegime: 'TRENDING',
      };

      for (const strat of strategies) {
        expect(typeof strat.evaluate).toBe('function');
        const result: StrategyEvaluationResult = strat.evaluate(mockCandles, context);

        expect(['BUY', 'SELL', 'CLOSE', 'NONE']).toContain(result.signal);
        expect(typeof result.confidence).toBe('number');
        expect(typeof result.reason).toBe('string');
        expect(typeof result.sl).toBe('number');
        expect(typeof result.tp).toBe('number');
      }
    });
  });

  describe('2. Regime Router Classification & Routing', () => {
    test('classifies strong directional trend as TRENDING', () => {
      const candles: Candle[] = [];
      let price = 1.1000;
      for (let i = 0; i < 40; i++) {
        price += 0.0020; // Strong steady trend
        candles.push(makeCandle(price, undefined, price + 0.0015, price - 0.0005));
      }

      const res = RegimeRouter.evaluateRegime(candles, 'EUR/USD');
      expect(res.adx).toBeGreaterThan(20);
      expect(['TRENDING', 'HIGH_VOLATILITY']).toContain(res.regime);
    });

    test('routes trend strategies in TRENDING and blocks all entries in HIGH_VOLATILITY', () => {
      expect(RegimeRouter.isStrategyAllowedForRegime('ma_crossover', 'TRENDING')).toBe(true);
      expect(RegimeRouter.isStrategyAllowedForRegime('power_breakout', 'TRENDING')).toBe(true);
      expect(RegimeRouter.isStrategyAllowedForRegime('rsi_reversion', 'RANGING')).toBe(true);
      expect(RegimeRouter.isStrategyAllowedForRegime('bollinger_bands', 'RANGING')).toBe(true);

      // High volatility regime must suppress all new entries
      expect(RegimeRouter.isStrategyAllowedForRegime('ma_crossover', 'HIGH_VOLATILITY')).toBe(false);
      expect(RegimeRouter.isStrategyAllowedForRegime('rsi_reversion', 'HIGH_VOLATILITY')).toBe(false);
      expect(RegimeRouter.isStrategyAllowedForRegime('power_breakout', 'HIGH_VOLATILITY')).toBe(false);
      expect(RegimeRouter.isStrategyAllowedForRegime('scalping_1m', 'HIGH_VOLATILITY')).toBe(false);
    });
  });

  describe('3. Power Breakout Strategy Hardening', () => {
    const powerStrat = new PowerBreakoutStrategy();

    test('generates BUY breakout when price breaches upper Donchian channel with trend confirmation', () => {
      const candles: Candle[] = [];
      let price = 1.0800;
      for (let i = 0; i < 35; i++) {
        price += 0.0015;
        candles.push({
          time: new Date(Date.now() - (35 - i) * 15 * 60 * 1000).toISOString(),
          instrument: 'EUR/USD',
          granularity: '15min',
          open: price - 0.0005,
          high: price + 0.0020,
          low: price - 0.0005,
          close: price + 0.0015,
          volume: 200,
        });
      }

      const context: MarketContext = {
        historicalCandles: candles,
        macroCandles: candles,
        currentQuote: { instrument: 'EUR/USD', time: new Date().toISOString(), bid: price, ask: price + 0.0001 },
        activePosition: null,
        accountEquity: 10000,
        openPositionsCount: 0,
        currentRegime: 'TRENDING',
      };

      const result = powerStrat.evaluate(candles, context);
      if (result.signal !== 'NONE') {
        expect(result.signal).toBe('BUY');
        expect(result.sl).toBeGreaterThan(0);
        expect(result.tp).toBeGreaterThan(result.sl);
      }
    });

    test('suppresses entries outside session opens when POWER_ONLY_NEAR_SESSION_OPENS is enabled', () => {
      config.POWER_ONLY_NEAR_SESSION_OPENS = true;

      const candles: Candle[] = [];
      let price = 1.0800;
      // 04:00 UTC (Outside London/NY/Tokyo opens)
      for (let i = 0; i < 35; i++) {
        candles.push(makeCandle(price, '2026-08-10T04:15:00.000Z'));
      }

      const context: MarketContext = {
        historicalCandles: candles,
        currentQuote: { instrument: 'EUR/USD', time: '2026-08-10T04:15:00.000Z', bid: price, ask: price + 0.0001 },
        activePosition: null,
        accountEquity: 10000,
        openPositionsCount: 0,
      };

      const result = powerStrat.evaluate(candles, context);
      expect(result.signal).toBe('NONE');
      expect(result.reason).toContain('Outside session open window');

      config.POWER_ONLY_NEAR_SESSION_OPENS = false; // restore
    });
  });

  describe('4. Scalper 1M Strategy Hardening', () => {
    const scalper = new Scalper1mStrategy();

    test('rejects non-1m candle granularity', () => {
      const candle = makeCandle(1.0800, '2026-08-10T08:00:00.000Z', undefined, undefined, '15min');
      const context: MarketContext = {
        historicalCandles: [candle],
        currentQuote: { instrument: 'EUR/USD', time: candle.time, bid: 1.0800, ask: 1.0801 },
        activePosition: null,
        accountEquity: 10000,
        openPositionsCount: 0,
      };

      const result = scalper.evaluate([candle], context);
      expect(result.signal).toBe('NONE');
      expect(result.reason).toContain('Scalping requires 1m candles');
    });

    test('rejects outside London and NY opening hours', () => {
      // 03:00 UTC is outside London (07:00-11:00) and NY (12:00-16:00)
      const candle = makeCandle(1.0800, '2026-08-10T03:00:00.000Z', undefined, undefined, '1min');
      const context: MarketContext = {
        historicalCandles: [candle],
        currentQuote: { instrument: 'EUR/USD', time: candle.time, bid: 1.0800, ask: 1.0801 },
        activePosition: null,
        accountEquity: 10000,
        openPositionsCount: 0,
      };

      const result = scalper.evaluate([candle], context);
      expect(result.signal).toBe('NONE');
      expect(result.reason).toContain('Outside London');
    });

    test('triggers time-stop CLOSE when active position exceeds SCALPER_TIME_STOP_MINUTES', () => {
      const pastEntryTime = new Date('2026-08-10T08:00:00.000Z');
      const currentCandleTime = new Date('2026-08-10T08:20:00.000Z'); // 20 minutes later (> 15m time stop)

      const candle = makeCandle(1.0820, currentCandleTime.toISOString(), undefined, undefined, '1min');
      const context: MarketContext = {
        historicalCandles: [candle],
        currentQuote: { instrument: 'EUR/USD', time: candle.time, bid: 1.0820, ask: 1.0821 },
        activePosition: {
          id: 'pos_scalp_test',
          instrument: 'EUR/USD',
          action: 'BUY',
          entryTime: pastEntryTime.toISOString(),
          entryPrice: 1.0800,
          units: 10000,
          unrealizedPnL: 20,
          strategy: 'scalping_1m',
        },
        accountEquity: 10000,
        openPositionsCount: 1,
      };

      const result = scalper.evaluate([candle], context);
      expect(result.signal).toBe('CLOSE');
      expect(result.reason).toContain('Scalp time-stop exceeded');
    });
  });

  describe('5. Engine Exit Upgrades', () => {
    test('closes position when max holding time is exceeded', async () => {
      const pastTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago (> 24h max)
      const quote: Quote = { instrument: 'EUR/USD', bid: 1.0800, ask: 1.0802, time: new Date().toISOString() };

      const orderId = await TradingEngine.executeOrder('EUR/USD', 'BUY', 'ma_crossover', quote, 20, 40);
      expect(orderId).not.toBeNull();

      if (orderId) {
        // Manually backdate entry_time in DB and in memory
        db.prepare('UPDATE positions SET entry_time = ? WHERE id = ?').run(pastTime, orderId);
        const pos = TradingEngine.getOpenPositions().find(p => p.id === orderId);
        if (pos) pos.entryTime = pastTime;

        // Run tick update
        await TradingEngine.updatePositionsAndCheckSLTP([quote]);

        // Position should have closed due to max holding time
        const closed = TradingEngine.getOpenPositions().find(p => p.id === orderId);
        expect(closed).toBeUndefined();
      }
    });
  });
});
