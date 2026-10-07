import { StrategyAllocator } from '../src/risk/strategyAllocator';
import { VolatilityArbitrageStrategy } from '../src/strategy/volatilityArbitrage';
import { GridOverlayStrategy } from '../src/strategy/gridOverlay';
import { Candle, MarketContext } from '../src/strategy/strategy.interface';

describe('StrategyAllocator & Overlay Strategies', () => {

  it('should return default strategy budget allocations for all registered strategies', () => {
    const allocations = StrategyAllocator.getStrategyAllocations(1000);
    expect(allocations.length).toBe(12);

    const scalp = allocations.find(a => a.name === 'scalping_1m');
    const gold = allocations.find(a => a.name === 'gold_alpha');
    const ml = allocations.find(a => a.name === 'ml_signal');
    const rsi = allocations.find(a => a.name === 'rsi_reversion');
    const vol = allocations.find(a => a.name === 'volatility_arbitrage');
    const grid = allocations.find(a => a.name === 'grid_overlay');
    const rec = allocations.find(a => a.name === 'loss_recovery');

    expect(scalp?.budgetPct).toBe(35);
    expect(gold?.budgetPct).toBe(35);
    expect(ml?.budgetPct).toBe(25);
    expect(rsi?.budgetPct).toBe(15);
    expect(vol?.budgetPct).toBe(25);
    expect(grid?.budgetPct).toBe(5);
    expect(rec?.budgetPct).toBe(15);
  });

  it('should allow trading when strategy monthly loss is within threshold', () => {
    const check = StrategyAllocator.isStrategyAllowed('ml_signal', 1000, -8.0);
    expect(check.allowed).toBe(true);
  });

  it('should calculate relative strategy risk multipliers correctly', () => {
    expect(StrategyAllocator.getStrategyRiskMultiplier('ml_signal')).toBeCloseTo(0.625, 3);
    expect(StrategyAllocator.getStrategyRiskMultiplier('volatility_arbitrage')).toBeCloseTo(0.625, 3);
    expect(StrategyAllocator.getStrategyRiskMultiplier('grid_overlay')).toBeCloseTo(0.125, 3);
  });

  describe('VolatilityArbitrageStrategy', () => {
    it('should return null when candle history is insufficient', () => {
      const strat = new VolatilityArbitrageStrategy();
      const mockCandle: Candle = { instrument: 'EUR/USD', time: '2026-01-01', granularity: '1h', open: 1.1, high: 1.11, low: 1.09, close: 1.105, volume: 100 };
      const mockContext: MarketContext = {
        historicalCandles: [mockCandle],
        currentQuote: { instrument: 'EUR/USD', bid: 1.104, ask: 1.106, time: '2026-01-01' },
        activePosition: null,
        accountEquity: 1000,
        openPositionsCount: 0
      };

      const signal = strat.onCandle(mockCandle, mockContext);
      expect(signal).toBeNull();
    });
  });

  describe('GridOverlayStrategy', () => {
    it('should return null when price range is not sideways', () => {
      const strat = new GridOverlayStrategy();
      const mockCandles: Candle[] = Array(20).fill(0).map((_, i) => ({
        instrument: 'EUR/USD', time: '2026-01-01', granularity: '1h', open: 1.1 + i*0.01, high: 1.11 + i*0.01, low: 1.09 + i*0.01, close: 1.105 + i*0.01, volume: 100
      }));
      const mockContext: MarketContext = {
        historicalCandles: mockCandles,
        currentQuote: { instrument: 'EUR/USD', bid: 1.25, ask: 1.26, time: '2026-01-01' },
        activePosition: null,
        accountEquity: 1000,
        openPositionsCount: 0
      };

      const signal = strat.onCandle(mockCandles[19], mockContext);
      expect(signal).toBeNull(); // Trending market, range > 1.2%
    });
  });

});
