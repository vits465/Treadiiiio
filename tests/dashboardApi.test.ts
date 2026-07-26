import { StrategyRegistry } from '../src/strategy/registry';
import { RejectionLogger } from '../src/risk/rejectionLogger';
import { db, initDb } from '../src/db';

describe('Dashboard API Backend Helpers', () => {
  beforeAll(() => {
    initDb();
  });

  test('StrategyRegistry returns registered strategies for Strategy Lab panel', () => {
    const strats = StrategyRegistry.getAll();
    expect(strats.length).toBeGreaterThanOrEqual(6);
    const names = strats.map(s => s.name);
    expect(names).toContain('power_breakout');
    expect(names).toContain('scalping_1m');
  });

  test('RejectionLogger writes to filter_rejections for Rejection Audit panel', () => {
    RejectionLogger.log(
      'TestFilter',
      'WIDE_SPREAD',
      'EUR/USD',
      'BUY',
      'power_breakout',
      'Test rejection details'
    );

    const row = db.prepare(`
      SELECT * FROM filter_rejections WHERE filter_name = 'TestFilter' ORDER BY timestamp DESC LIMIT 1
    `).get() as any;

    expect(row).toBeDefined();
    expect(row.reason_code).toBe('WIDE_SPREAD');
    expect(row.instrument).toBe('EUR/USD');
  });
});
