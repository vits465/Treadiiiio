import { RiskManager } from '../src/risk/riskManager';
import { CorrelationManager } from '../src/risk/correlationManager';
import { initDb, db } from '../src/db';
import { Candle } from '../src/data/priceFeed';
import { PositionInfo } from '../src/strategy/strategy.interface';

describe('Phase 5 — Advanced Risk Management & Sizing Controls', () => {
  beforeAll(() => {
    initDb();
  });

  describe('1. Volatility Circuit Breaker (ATR 95th Percentile Gate)', () => {
    test('allows trading under normal market volatility', () => {
      // Generate 120 synthetic candles with steady small ranges
      const candles: Candle[] = [];
      let price = 2000;
      const baseTime = Date.now() - 120 * 60000;

      for (let i = 0; i < 120; i++) {
        candles.push({
          instrument: 'XAU/USD',
          granularity: '1m',
          time: new Date(baseTime + i * 60000).toISOString(),
          open: price,
          high: price + 1.0,
          low: price - 1.0,
          close: price + 0.2,
          volume: 100,
        });
        price += 0.2;
      }

      const allowed = RiskManager.checkVolatilityCircuitBreaker('XAU/USD', candles, 0.95);
      expect(allowed).toBe(true);
    });

    test('pauses new entries when ATR spikes above 95th percentile', () => {
      // 100 calm candles followed by 20 candles with 10x volatility spike
      const candles: Candle[] = [];
      let price = 2000;
      const baseTime = Date.now() - 120 * 60000;

      for (let i = 0; i < 100; i++) {
        candles.push({
          instrument: 'XAU/USD',
          granularity: '1m',
          time: new Date(baseTime + i * 60000).toISOString(),
          open: price,
          high: price + 0.5,
          low: price - 0.5,
          close: price + 0.1,
          volume: 100,
        });
        price += 0.1;
      }

      for (let i = 100; i < 120; i++) {
        candles.push({
          instrument: 'XAU/USD',
          granularity: '1m',
          time: new Date(baseTime + i * 60000).toISOString(),
          open: price,
          high: price + 25.0,
          low: price - 25.0,
          close: price + 5.0,
          volume: 500,
        });
        price += 5.0;
      }

      const allowed = RiskManager.checkVolatilityCircuitBreaker('XAU/USD', candles, 0.95);
      expect(allowed).toBe(false);
    });
  });

  describe('2. Equity-Curve Throttle (0.5x Sizing Below 20-Trade MA)', () => {
    beforeEach(() => {
      db.prepare(`DELETE FROM equity_snapshots`).run();
    });

    test('returns 1.0x when equity is above the moving average', () => {
      const now = Date.now();
      for (let i = 0; i < 15; i++) {
        db.prepare(`
          INSERT INTO equity_snapshots (time, balance, equity, unrealized_pnl, drawdown)
          VALUES (?, ?, ?, ?, ?)
        `).run(new Date(now - (15 - i) * 60000).toISOString(), 1000, 1000, 0, 0);
      }

      const mult = RiskManager.getEquityCurveThrottleMultiplier(1050);
      expect(mult).toBe(1.0);
    });

    test('returns 0.5x when current equity is depressed below 20-trade MA', () => {
      const now = Date.now();
      for (let i = 0; i < 15; i++) {
        db.prepare(`
          INSERT INTO equity_snapshots (time, balance, equity, unrealized_pnl, drawdown)
          VALUES (?, ?, ?, ?, ?)
        `).run(new Date(now - (15 - i) * 60000).toISOString(), 1000, 1000, 0, 0);
      }

      const mult = RiskManager.getEquityCurveThrottleMultiplier(920);
      expect(mult).toBe(0.5);
    });
  });

  describe('3. Per-Strategy Quarantine (Rolling 30-Trade PF < 1.0)', () => {
    const testStrategy = 'test_quarantine_strategy';

    beforeEach(() => {
      RiskManager.reEnableStrategy(testStrategy);
      db.prepare(`DELETE FROM trades WHERE strategy = ?`).run(testStrategy);
    });

    test('auto-quarantines a losing strategy when rolling PF drops below 1.0', () => {
      const now = Date.now();
      // Insert 16 trades: 4 small wins ($2 each), 12 losses ($5 each) => PF = 8 / 60 = 0.133 < 1.0
      for (let i = 0; i < 16; i++) {
        const isWin = i < 4;
        const pnl = isWin ? 2.0 : -5.0;
        db.prepare(`
          INSERT INTO trades (id, instrument, action, units, entry_price, status, pnl, strategy, entry_time, exit_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `test-trade-${i}`,
          'EUR/USD',
          'BUY',
          1000,
          1.1000,
          'CLOSED',
          pnl,
          testStrategy,
          new Date(now - (20 - i) * 3600000).toISOString(),
          new Date(now - (20 - i) * 3600000 + 1800000).toISOString()
        );
      }

      const allowed = RiskManager.checkStrategyQuarantine(testStrategy, 'EUR/USD');
      expect(allowed).toBe(false);
      expect(RiskManager.getQuarantinedStrategies()).toContain(testStrategy);

      // Subsequent check should reject immediately from set
      expect(RiskManager.checkStrategyQuarantine(testStrategy, 'EUR/USD')).toBe(false);
    });

    test('manual re-enable restores trading eligibility for the strategy', () => {
      RiskManager.reEnableStrategy(testStrategy);
      expect(RiskManager.getQuarantinedStrategies()).not.toContain(testStrategy);
    });
  });

  describe('4. Correlation Group Net Directional Exposure Guard', () => {
    test('caps directional group exposure to at most 2 same-side positions', () => {
      const openPositions = [
        { instrument: 'EUR/USD', action: 'BUY' },
        { instrument: 'GBP/USD', action: 'BUY' },
      ] as any;

      // 3rd LONG in USD group should be rejected
      const allowed3rdLong = RiskManager.checkCorrelationGroupExposure('AUD/USD', openPositions, 'BUY');
      expect(allowed3rdLong).toBe(false);

      // SHORT in USD group balances the exposure and is allowed
      const allowedShort = RiskManager.checkCorrelationGroupExposure('AUD/USD', openPositions, 'SELL');
      expect(allowedShort).toBe(true);

      // Position in independent asset (e.g. BTC) is allowed
      const allowedBtc = RiskManager.checkCorrelationGroupExposure('BTC/USD', openPositions, 'BUY');
      expect(allowedBtc).toBe(true);
    });
  });

  describe('5. Margin & Leverage Guard for MT5 Orders', () => {
    test('blocks orders that would exceed max leverage (20:1)', () => {
      const balance = 100;
      const equity = 100;
      const openPositions: PositionInfo[] = [];

      // Attempting to buy 2.0 lots of EUR/USD = 200,000 units @ 1.10 = $220,000 notional
      // 220,000 / 100 = 2200:1 leverage!
      const allowed = RiskManager.checkMarginLeverageGuard(
        balance,
        equity,
        200000,
        'EUR/USD',
        1.10,
        openPositions
      );
      expect(allowed).toBe(false);
    });

    test('blocks orders when free margin buffer is below 30%', () => {
      const balance = 100;
      const equity = 100;
      // Existing position taking most of the margin
      const openPositions: PositionInfo[] = [
        {
          id: 'pos1',
          instrument: 'EUR/USD',
          action: 'BUY',
          units: 15000,
          entryPrice: 1.10,
          unrealizedPnL: 0,
          entryTime: new Date().toISOString(),
          strategy: 'test',
        }
      ];

      // Proposed order that pushes margin over 70% utilized
      const allowed = RiskManager.checkMarginLeverageGuard(
        balance,
        equity,
        5000,
        'EUR/USD',
        1.10,
        openPositions
      );
      expect(allowed).toBe(false);
    });

    test('permits orders within safe margin and leverage limits', () => {
      const balance = 1000;
      const equity = 1000;
      const openPositions: PositionInfo[] = [];

      // 0.01 lot EUR/USD = 1,000 units @ 1.10 = $1,100 notional.
      // Leverage: 1.1:1, required margin ~$55, free margin ~94.5% > 30%.
      const allowed = RiskManager.checkMarginLeverageGuard(
        balance,
        equity,
        1000,
        'EUR/USD',
        1.10,
        openPositions
      );
      expect(allowed).toBe(true);
    });
  });
});
