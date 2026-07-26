import { MonteCarloTester } from '../src/backtest/monteCarlo';
import { BacktestTrade } from '../src/backtest/metrics';

describe('MonteCarloTester', () => {
  test('evaluates 1,000 resampled trade sequences and computes 95th percentile max drawdown', () => {
    const mockTrades: BacktestTrade[] = [
      { id: '1', instrument: 'EUR/USD', action: 'BUY', entryPrice: 1.0800, exitPrice: 1.0850, entryTime: '', exitTime: '', units: 10000, pnl: 50, strategy: 'ma' },
      { id: '2', instrument: 'EUR/USD', action: 'SELL', entryPrice: 1.0850, exitPrice: 1.0820, entryTime: '', exitTime: '', units: 10000, pnl: 30, strategy: 'ma' },
      { id: '3', instrument: 'EUR/USD', action: 'BUY', entryPrice: 1.0820, exitPrice: 1.0800, entryTime: '', exitTime: '', units: 10000, pnl: -20, strategy: 'ma' },
      { id: '4', instrument: 'EUR/USD', action: 'BUY', entryPrice: 1.0800, exitPrice: 1.0860, entryTime: '', exitTime: '', units: 10000, pnl: 60, strategy: 'ma' },
      { id: '5', instrument: 'EUR/USD', action: 'SELL', entryPrice: 1.0860, exitPrice: 1.0890, entryTime: '', exitTime: '', units: 10000, pnl: -30, strategy: 'ma' },
    ];

    const res = MonteCarloTester.test(mockTrades, 10000, 100);
    expect(res.iterations).toBe(100);
    expect(res.worstCaseDrawdown95Pct).toBeGreaterThanOrEqual(0);
    expect(typeof res.isRobust).toBe('boolean');
  });
});
