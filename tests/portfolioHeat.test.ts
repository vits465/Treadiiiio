import { PortfolioHeatMonitor } from '../src/risk/portfolioHeat';
import { PositionInfo } from '../src/strategy/strategy.interface';

describe('PortfolioHeatMonitor', () => {
  test('calculates zero open risk when no open positions', () => {
    const riskPct = PortfolioHeatMonitor.calculateOpenRiskPct([], 10000);
    expect(riskPct).toBe(0);
  });

  test('calculates accurate open risk percentage for active positions', () => {
    const mockPositions: PositionInfo[] = [
      {
        id: '1',
        instrument: 'EUR/USD',
        action: 'BUY',
        entryTime: new Date().toISOString(),
        entryPrice: 1.0800,
        stopLoss: 1.0770, // 30 pips SL
        units: 50000,
        unrealizedPnL: 0,
        strategy: 'ma_crossover',
      },
    ];

    const riskPct = PortfolioHeatMonitor.calculateOpenRiskPct(mockPositions, 10000);
    expect(riskPct).toBeGreaterThan(0);
    expect(riskPct).toBeLessThan(2.0);
  });

  test('rejects new trade when cumulative open risk + proposed risk breaches heat cap (3.0%)', () => {
    const mockPositions: PositionInfo[] = [
      {
        id: '1',
        instrument: 'EUR/USD',
        action: 'BUY',
        entryTime: new Date().toISOString(),
        entryPrice: 1.0800,
        stopLoss: 1.0700, // 100 pips SL
        units: 250000, // Large position
        unrealizedPnL: 0,
        strategy: 'ma_crossover',
      },
    ];

    const allowed = PortfolioHeatMonitor.checkHeatCap(mockPositions, 10000, 1.5);
    expect(allowed).toBe(false);
  });
});
