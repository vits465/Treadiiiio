import { RiskManager } from '../src/risk/riskManager';

describe('Dynamic Spread Sanity Guard', () => {
  test('allows trade when current spread is within 2x median spread', () => {
    const allowed = RiskManager.checkSpreadSanity('EUR/USD', 1.5, 1.2);
    expect(allowed).toBe(true);
  });

  test('rejects trade when current spread > 2x median spread', () => {
    const allowed = RiskManager.checkSpreadSanity('EUR/USD', 4.5, 1.5);
    expect(allowed).toBe(false);
  });
});
