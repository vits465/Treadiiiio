import { AuditLogger } from '../src/utils/auditLogger';
import { RiskManager } from '../src/risk/riskManager';
import { runBacktestEngine } from '../src/analytics/backtestEngine';
import { initDb, db } from '../src/db';

describe('Phase 6 — Operator Remote Controls & Dashboard Live Interaction', () => {
  beforeAll(() => {
    initDb();
  });

  describe('1. Operator Action Audit Trail', () => {
    beforeEach(() => {
      db.prepare(`DELETE FROM audit_actions`).run();
    });

    test('logs actions from TELEGRAM, DASHBOARD, and SYSTEM with timestamps and details', () => {
      AuditLogger.log('TELEGRAM', 'PAUSE', 'Engine paused via remote command');
      AuditLogger.log('DASHBOARD', 'START', 'Engine resumed via web UI');
      AuditLogger.log('TELEGRAM', 'STRATEGY_REENABLE', 'Strategy ma_crossover unquarantined');

      const recent = AuditLogger.getRecent(10);
      expect(recent.length).toBe(3);
      expect(recent[0].action).toBe('STRATEGY_REENABLE');
      expect(recent[0].source).toBe('TELEGRAM');
      expect(recent[1].action).toBe('START');
      expect(recent[1].source).toBe('DASHBOARD');
      expect(recent[2].action).toBe('PAUSE');
      expect(recent[2].source).toBe('TELEGRAM');
    });
  });

  describe('2. Strategy Quarantine Management & Manual Re-Enable', () => {
    const testStrat = 'smc_liquidity_test';

    beforeEach(() => {
      RiskManager.reEnableStrategy(testStrat);
    });

    test('allows querying and restoring quarantined strategies', () => {
      // Simulate quarantine
      const stratSet = (RiskManager as any).quarantinedStrategies as Set<string>;
      stratSet.add(testStrat);

      expect(RiskManager.getQuarantinedStrategies()).toContain(testStrat);
      expect(RiskManager.checkStrategyQuarantine(testStrat)).toBe(false);

      // Re-enable
      RiskManager.reEnableStrategy(testStrat);
      expect(RiskManager.getQuarantinedStrategies()).not.toContain(testStrat);
    });
  });

  describe('3. On-Demand Backtest Invocation', () => {
    test('executes realistic backtest with friction model and quant grade', async () => {
      const result = await runBacktestEngine({
        strategyName: 'ma_crossover',
        instrument: 'EUR/USD',
        candleCount: 300,
        initialCapital: 50.0,
        lotSize: 0.01,
      });

      expect(result).toHaveProperty('profitFactor');
      expect(result).toHaveProperty('sharpeRatio');
      expect(result).toHaveProperty('winRate');
      expect(result).toHaveProperty('maxDrawdown');
      expect(result).toHaveProperty('botSuggestion');
      expect(result.botSuggestion).toHaveProperty('grade');
    });
  });
});
