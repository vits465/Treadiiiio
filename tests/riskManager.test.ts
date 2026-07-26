import { RiskManager } from '../src/risk/riskManager';
import { initDb } from '../src/db';

describe('RiskManager — Risk-Capped Adaptive Position Sizing Module', () => {
  beforeAll(() => {
    initDb();
  });

  beforeEach(() => {
    RiskManager.resetDailyCircuitBreaker();
  });

  describe('1. Hard Risk Constraints & Per-Trade Cap', () => {
    it('enforces a maximum per-trade risk cap of 1.5% of current equity', () => {
      const result = RiskManager.calculatePositionSize(100, 30, 0.80, 0, 'EUR/USD');
      expect(result.effectiveRiskPct).toBeLessThanOrEqual(1.5);
      expect(result.riskUsdAtStop).toBeCloseTo(1.50, 2);
      expect(result.sizeTier).toBe('NORMAL');
    });

    it('calculates dollar risk at stop accurately for micro accounts ($100 equity)', () => {
      // For $100 equity, 1.5% risk = $1.50. 15 pips SL on 1,000 units (0.01 lot) = $1.50
      const result = RiskManager.calculatePositionSize(100, 15, 0.75, 0, 'EUR/USD');
      expect(result.riskUsdAtStop).toBe(1.50);
      expect(result.lots).toBe(0.01);
    });
  });

  describe('2. Confidence-Gated Scaling Tiers', () => {
    it('discards signals with confidence below minimum threshold (< 0.35 for EUR/USD)', () => {
      const result = RiskManager.calculatePositionSize(100, 30, 0.28, 0, 'EUR/USD');
      expect(result.sizeTier).toBe('DISCARDED');
      expect(result.lots).toBe(0);
      expect(result.effectiveRiskPct).toBe(0);
    });

    it('assigns REDUCED tier (60% of cap) for confidence between 0.60 and 0.75', () => {
      const result = RiskManager.calculatePositionSize(100, 30, 0.68, 0, 'EUR/USD');
      expect(result.sizeTier).toBe('REDUCED');
      expect(result.effectiveRiskPct).toBe(0.9); // 1.5% * 0.60 = 0.9%
      expect(result.riskUsdAtStop).toBe(0.90);
    });

    it('assigns NORMAL tier (100% of cap) for confidence between 0.75 and 0.85', () => {
      const result = RiskManager.calculatePositionSize(100, 30, 0.80, 0, 'EUR/USD');
      expect(result.sizeTier).toBe('NORMAL');
      expect(result.effectiveRiskPct).toBe(1.5);
      expect(result.riskUsdAtStop).toBe(1.50);
    });

    it('assigns STRETCH tier (up to 2.25%) for confidence >= 0.85', () => {
      const result = RiskManager.calculatePositionSize(100, 30, 0.90, 0, 'EUR/USD');
      expect(result.sizeTier).toBe('STRETCH');
      expect(result.effectiveRiskPct).toBe(2.25);
      expect(result.riskUsdAtStop).toBe(2.25);
    });

    it('scales down STRETCH tier to respect cumulative open risk ceiling (6%)', () => {
      // 5.0% open risk already used -> available capacity is 6.0% - 5.0% = 1.0%
      const result = RiskManager.calculatePositionSize(100, 30, 0.92, 5.0, 'EUR/USD');
      expect(result.effectiveRiskPct).toBeLessThanOrEqual(1.0);
      expect(result.sizeTier).toBe('REDUCED');
    });
  });

  describe('3. Daily Circuit Breaker & Lockout', () => {
    it('triggers circuit breaker when daily loss reaches 5% of starting equity', () => {
      const dayStartEquity = 100;
      const currentEquity = 94.5; // -$5.50 loss = 5.5% loss
      const status = RiskManager.checkDailyCircuitBreaker(dayStartEquity, currentEquity, 0);

      expect(status.breached).toBe(true);
      expect(status.dailyPnlPct).toBe(-5.5);
    });

    it('prevents new trade sizing after circuit breaker is breached same-day', () => {
      const dayStartEquity = 100;
      RiskManager.checkDailyCircuitBreaker(dayStartEquity, 94.0, 0); // Breached!

      const result = RiskManager.calculatePositionSize(100, 30, 0.90, 0, 'EUR/USD');
      expect(result.sizeTier).toBe('DISCARDED');
      expect(result.lots).toBe(0);
      expect(result.effectiveRiskPct).toBe(0);
    });
  });

  describe('4. Proof of No Martingale / Revenge Sizing', () => {
    it('proves a losing trade outcome does NOT increase next trade position size', () => {
      // Baseline trade at 0.75 confidence
      const initialSizing = RiskManager.calculatePositionSize(100, 30, 0.75, 0, 'EUR/USD');

      // Record a major losing trade outcome
      RiskManager.recordTradeOutcome({
        id: 'trade_loss_1',
        instrument: 'EUR/USD',
        pnl: -1.50,
        exitTime: new Date().toISOString(),
        strategy: 'rsi_reversion',
      });

      // Next trade sizing at identical 0.75 confidence
      const nextSizing = RiskManager.calculatePositionSize(98.5, 30, 0.75, 0, 'EUR/USD');

      // Sizing must NOT increase after a loss
      expect(nextSizing.effectiveRiskPct).toBeLessThanOrEqual(initialSizing.effectiveRiskPct);
      expect(nextSizing.riskUsdAtStop).toBeLessThanOrEqual(initialSizing.riskUsdAtStop);
    });
  });
});
