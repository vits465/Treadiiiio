process.env.DB_PATH = ':memory:';
process.env.USE_SIMULATOR = 'true';
process.env.CURRENCY_PAIRS = 'EUR_USD';
process.env.STARTING_BALANCE = '10000';
process.env.RISK_MAX_CONCURRENT_POSITIONS = '5';
process.env.CORRELATION_GROUPS = 'USD:EUR_USD,GBP_USD,USD_JPY,AUD_USD,USD_CHF';
process.env.API_SECRET_KEY = 'test_api_key_for_unit_tests_1234';
process.env.CORS_ALLOWED_ORIGIN = 'http://localhost:3000';

import { initDb, db } from '../src/db';
import { RiskManager } from '../src/risk/riskManager';

// Mock TelegramNotifier to avoid actual API calls in tests
jest.mock('../src/notifier/telegram', () => ({
  TelegramNotifier: {
    sendMessage: jest.fn(),
    initialize: jest.fn(),
  }
}));

describe('RiskManager Unit Tests', () => {
  beforeEach(() => {
    try {
      db.prepare('DELETE FROM positions').run();
      db.prepare('DELETE FROM trades').run();
      db.prepare('DELETE FROM equity_snapshots').run();
      db.prepare('DELETE FROM filter_rejections').run();
    } catch (e) {}
    initDb();
  });

  afterAll(() => {
    db.close();
  });

  test('should enforce concurrent position limits', () => {
    // max position limit is 5 by default (env sets RISK_MAX_CONCURRENT_POSITIONS default)
    expect(RiskManager.checkPositionLimit(4)).toBe(true);
    expect(RiskManager.checkPositionLimit(5)).toBe(false);
  });

  test('should calculate position sizing based on tiered risk percentage and SL', () => {
    // Config: mode='conservative'. Effective risk for $10000 is 1.0% = $100.
    // SL = 40 pips, EUR_USD pip = 0.0001 -> 0.0040 distance
    // units = 100 / 0.0040 = 25000 units
    const units = RiskManager.calculatePositionSize('EUR_USD', 40, 10000);
    expect(units).toBe(25000);
  });

  test('should reject sizing if minimum lot risk exceeds budget', () => {
    // $70 balance, conservative = 0.5% risk = $0.35.
    // SL = 40 pips -> 0.0040 distance.
    // Minimum lot is 1000 units. Risk of 1000 units = 1000 * 0.0040 = $4.00.
    // $4.00 > $0.35 budget, so it should return 0 units.
    const units = RiskManager.calculatePositionSize('EUR_USD', 40, 70);
    expect(units).toBe(0);
  });

  test('should check total open risk correctly', () => {
    // max total open risk pct is 3.0%
    const openPositions: any[] = [
      { instrument: 'EUR_USD', stopLoss: 1.0760, entryPrice: 1.0800, units: 10000 } // Risk: 0.0040 * 10000 = $40
    ];
    // Balance 10000 -> 3% = $300 limit. Current risk = $40.
    expect(RiskManager.checkTotalOpenRisk(10000, openPositions, 0)).toBe(true);

    // If new position adds 2.7% risk -> total 3.1% > 3% -> reject
    expect(RiskManager.checkTotalOpenRisk(10000, openPositions, 2.7)).toBe(false);
  });

  test('should block correlated pairs in same direction', () => {
    const openPositions: any[] = [
      { instrument: 'EUR_USD', action: 'BUY' } // Long EUR vs USD -> Short USD
    ];
    
    // GBP/USD BUY -> Short USD (Same)
    expect(RiskManager.checkCorrelationExposure('GBP_USD', openPositions, 'BUY')).toBe(false);
    
    // USD/JPY BUY -> Long USD (Opposite, should be fine)
    expect(RiskManager.checkCorrelationExposure('USD_JPY', openPositions, 'BUY')).toBe(true);
  });

  test('should halt trading if daily loss limit is breached', () => {
    // Limit is 5% of 10000 = $500.
    
    // Test case 1: healthy portfolio
    expect(RiskManager.checkDailyLossLimit(10000, -200)).toBe(true);

    // Test case 2: unrealized loss exceeds limit
    expect(RiskManager.checkDailyLossLimit(10000, -600)).toBe(false);

    // Test case 3: realized loss closed today exceeds limit
    // Insert a closed trade with -$600 PnL closed today
    const exitTime = new Date().toISOString();
    db.prepare(`
      INSERT INTO trades (id, instrument, action, entry_time, exit_time, entry_price, exit_price, units, pnl, strategy, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('t1', 'EUR_USD', 'BUY', '2026-07-10T10:00:00Z', exitTime, 1.0800, 1.0740, 10000, -600.0, 'ma_crossover', 'CLOSED');

    expect(RiskManager.checkDailyLossLimit(9400, 0)).toBe(false);
  });

  test('should halt trading if weekly loss limit is breached', () => {
    // Limit is 12% of 10000 = $1200.
    const exitTime = new Date().toISOString();
    db.prepare(`
      INSERT INTO trades (id, instrument, action, entry_time, exit_time, entry_price, exit_price, units, pnl, strategy, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('t2', 'EUR_USD', 'BUY', '2026-07-10T10:00:00Z', exitTime, 1.0800, 1.0740, 10000, -1300.0, 'ma_crossover', 'CLOSED');

    expect(RiskManager.checkWeeklyLossLimit(8700, 0)).toBe(false);
  });

  test('should log rejections into filter_rejections table', () => {
    // Trigger a position limit rejection
    RiskManager.checkPositionLimit(5, 'EUR_USD');

    // Check that a rejection was logged
    const rejections = db.prepare('SELECT * FROM filter_rejections').all() as any[];
    expect(rejections.length).toBe(1);
    expect(rejections[0].filter_name).toBe('RiskManager.checkPositionLimit');
    expect(rejections[0].reason_code).toBe('POSITION_LIMIT');
    expect(rejections[0].instrument).toBe('EUR_USD');
  });
});
