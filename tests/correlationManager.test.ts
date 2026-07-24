import { CorrelationManager, ActivePosition } from '../src/risk/correlationManager';
import { RiskManager } from '../src/risk/riskManager';

describe('CorrelationManager & Portfolio Correlation Risk', () => {

  it('should normalize instruments and sides correctly', () => {
    expect(CorrelationManager.normalizeInstrument('eur_usd')).toBe('EUR/USD');
    expect(CorrelationManager.normalizeSide('BUY')).toBe('LONG');
    expect(CorrelationManager.normalizeSide('SELL')).toBe('SHORT');
  });

  it('should correctly fetch baseline pair correlations', () => {
    expect(CorrelationManager.getPairCorrelation('EUR/USD', 'GBP/USD')).toBe(0.85);
    expect(CorrelationManager.getPairCorrelation('EUR/USD', 'USD/CHF')).toBe(-0.90);
    expect(CorrelationManager.getPairCorrelation('EUR/USD', 'EUR/USD')).toBe(1.0);
    expect(CorrelationManager.getPairCorrelation('EUR/USD', 'UNKNOWN')).toBe(0.0);
  });

  it('should calculate directional correlation taking trade sides into account', () => {
    const pos1: ActivePosition = { instrument: 'EUR/USD', side: 'LONG' };
    const pos2: ActivePosition = { instrument: 'GBP/USD', side: 'LONG' };
    const pos3: ActivePosition = { instrument: 'GBP/USD', side: 'SHORT' };

    // Same direction on positively correlated pairs = positive directional risk
    expect(CorrelationManager.getDirectionalCorrelation(pos1, pos2)).toBe(0.85);

    // Opposite direction on positively correlated pairs = negative (hedged) risk
    expect(CorrelationManager.getDirectionalCorrelation(pos1, pos3)).toBe(-0.85);
  });

  it('should allow trades within the portfolio correlation cap of 1.5', () => {
    const openPositions: ActivePosition[] = [
      { instrument: 'EUR/USD', side: 'LONG' }
    ];

    // Adding AUD/USD (0.70 correlation with EUR/USD) -> total sum = 0.70 <= 1.5
    const check = CorrelationManager.checkCorrelationCap(openPositions, 'AUD/USD', 'LONG', 1.5);
    expect(check.exceeded).toBe(false);
    expect(check.totalCorrelationSum).toBe(0.70);
  });

  it('should REJECT trades that exceed the portfolio correlation sum cap of 1.5', () => {
    const openPositions: ActivePosition[] = [
      { instrument: 'EUR/USD', side: 'LONG' },
      { instrument: 'GBP/USD', side: 'LONG' } // EUR/USD + GBP/USD = 0.85
    ];

    // Candidate: AUD/USD long
    // Pairs:
    // (EUR/USD, GBP/USD) = 0.85
    // (EUR/USD, AUD/USD) = 0.70
    // (GBP/USD, AUD/USD) = 0.65
    // Total sum = 0.85 + 0.70 + 0.65 = 2.20 > 1.5!
    const check = CorrelationManager.checkCorrelationCap(openPositions, 'AUD/USD', 'LONG', 1.5);
    expect(check.exceeded).toBe(true);
    expect(check.totalCorrelationSum).toBe(2.20);

    // Verify RiskManager integration
    const allowed = RiskManager.checkCorrelationCap(openPositions, 'AUD/USD', 'LONG');
    expect(allowed).toBe(false);
  });

  it('should allow hedged trades even when adding multiple instruments', () => {
    const openPositions: ActivePosition[] = [
      { instrument: 'EUR/USD', side: 'LONG' },
      { instrument: 'USD/CHF', side: 'LONG' } // EUR/USD & USD/CHF are -0.90 correlated -> directional = -0.90 (hedged)
    ];

    const check = CorrelationManager.checkCorrelationCap(openPositions, 'GBP/USD', 'SHORT', 1.5);
    expect(check.exceeded).toBe(false);
  });

});
