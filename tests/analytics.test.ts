import { DemoLiveSimulator, TradeRecord } from '../src/analytics/demoLiveSimulator';
import { KellySizing } from '../src/analytics/kellySizing';
import { RegimeDetector } from '../src/analytics/regimeDetector';
import { ScalingRoadmap } from '../src/analytics/scalingRoadmap';

describe('Analytics & Scaling Modules', () => {

  describe('KellySizing', () => {
    it('should assign 1/8 Kelly for micro accounts (<$1000) regardless of confidence', () => {
      const result = KellySizing.calculatePositionSize({
        winRate: 0.60,
        profitFactor: 1.5,
        confidenceTier: 'HIGH',
        currentEquity: 500
      });
      expect(result.fractionUsed).toBe('1/8');
      expect(result.theoreticalKellyPct).toBeGreaterThan(0);
      expect(result.fractionalKellyPct).toBeCloseTo(result.theoreticalKellyPct / 8);
    });

    it('should assign 1/6 Kelly for mid accounts ($1000+) on HIGH confidence', () => {
      const result = KellySizing.calculatePositionSize({
        winRate: 0.65,
        profitFactor: 1.5,
        confidenceTier: 'HIGH',
        currentEquity: 2000
      });
      expect(result.fractionUsed).toBe('1/6');
      // Due to the 5% cap, it will be 5.0 instead of 6.94
      expect(result.fractionalKellyPct).toBe(5.0);
    });

    it('should assign 1/4 Kelly for mature accounts ($5000+) on HIGH confidence', () => {
      const result = KellySizing.calculatePositionSize({
        winRate: 0.70,
        profitFactor: 1.5,
        confidenceTier: 'HIGH',
        currentEquity: 6000
      });
      expect(result.fractionUsed).toBe('1/4');
      // Note: Cap might kick in if it exceeds 5%, but for 0.7 * 1.5 = 1.05 - 0.3 / 1.5 = 0.5 (50%). 
      // 50% / 4 = 12.5%. It should be capped at 5%.
      expect(result.fractionalKellyPct).toBe(5.0); // Capped!
    });

    it('should fallback to 1/8 for LOW confidence on mature accounts', () => {
      const result = KellySizing.calculatePositionSize({
        winRate: 0.55,
        profitFactor: 1.2,
        confidenceTier: 'LOW',
        currentEquity: 10000
      });
      expect(result.fractionUsed).toBe('1/8');
    });

    it('should return 0 if no mathematical edge exists', () => {
      const result = KellySizing.calculatePositionSize({
        winRate: 0.40, // Losing system
        profitFactor: 1.2,
        confidenceTier: 'HIGH',
        currentEquity: 1000
      });
      expect(result.fractionUsed).toBe('NONE');
      expect(result.fractionalKellyPct).toBe(0);
      expect(result.riskUsd).toBe(0);
    });
  });

  describe('RegimeDetector', () => {
    it('should detect CALM regime when ATR is low and metrics are good', () => {
      const result = RegimeDetector.detectRegime({
        atr20Day: 8,
        atrThresholdNormal: 10,
        atrThresholdVolatile: 20,
        rollingWinRate20Day: 0.65,
        rollingSharpe20Day: 1.2
      });
      expect(result.regime).toBe('CALM');
      expect(result.recommendedThreshold).toBe(0.60);
    });

    it('should detect VOLATILE regime and raise threshold when ATR is high and edge weakens', () => {
      const result = RegimeDetector.detectRegime({
        atr20Day: 25,
        atrThresholdNormal: 10,
        atrThresholdVolatile: 20,
        rollingWinRate20Day: 0.52,
        rollingSharpe20Day: 0.4
      });
      expect(result.regime).toBe('VOLATILE');
      expect(result.recommendedThreshold).toBe(0.80);
    });

    it('should remain NORMAL if ATR is normal', () => {
      const result = RegimeDetector.detectRegime({
        atr20Day: 15,
        atrThresholdNormal: 10,
        atrThresholdVolatile: 20,
        rollingWinRate20Day: 0.58,
        rollingSharpe20Day: 0.9
      });
      expect(result.regime).toBe('NORMAL');
      expect(result.recommendedThreshold).toBe(0.70);
    });
  });

  describe('ScalingRoadmap', () => {
    it('should correctly mark milestones up to current month', () => {
      const result = ScalingRoadmap.generateProjection(3, 500);
      
      expect(result.currentMonth).toBe(3);
      expect(result.currentCapital).toBe(500);
      expect(result.isPaceGood).toBe(true);

      const m1 = result.milestones.find(m => m.month === 1);
      const m3 = result.milestones.find(m => m.month === 3);
      const m4 = result.milestones.find(m => m.month === 4);

      expect(m1?.status).toBe('COMPLETED');
      expect(m3?.status).toBe('IN_PROGRESS');
      expect(m4?.status).toBe('PENDING');
    });

    it('should flag pace as bad if capital is >20% below expected', () => {
      const result = ScalingRoadmap.generateProjection(6, 800); // Expected is 1200
      expect(result.isPaceGood).toBe(false);
    });

    it('should generate transition checklist for Demo -> Live Phase 1', () => {
      const checklist = ScalingRoadmap.getTransitionChecklist('DEMO', 'LIVE_PHASE_1');
      expect(checklist.length).toBeGreaterThan(3);
      expect(checklist[0]).toContain('Win rate');
    });
  });

  describe('DemoLiveSimulator', () => {
    it('should process a set of trades and degrade performance correctly', () => {
      const mockTrades: TradeRecord[] = [
        { pnl: 10, entryPrice: 1.1000, exitPrice: 1.1010, action: 'BUY', instrument: 'EUR/USD', units: 10000 },
        { pnl: -5, entryPrice: 1.1010, exitPrice: 1.1005, action: 'SELL', instrument: 'EUR/USD', units: 10000 },
        { pnl: 15, entryPrice: 1.1020, exitPrice: 1.1035, action: 'BUY', instrument: 'EUR/USD', units: 10000 },
        { pnl: 12, entryPrice: 1.1040, exitPrice: 1.1052, action: 'BUY', instrument: 'EUR/USD', units: 10000 },
        { pnl: -8, entryPrice: 1.1050, exitPrice: 1.1058, action: 'SELL', instrument: 'EUR/USD', units: 10000 },
      ];

      const report = DemoLiveSimulator.runSimulation(mockTrades, 100);

      // Demo results should exactly match input PnL sums since slippage is 0
      const expectedDemoPnl = 10 - 5 + 15 + 12 - 8;
      expect(report.demoResults.totalPnl).toBe(expectedDemoPnl);
      expect(report.demoResults.winPct).toBe(60); // 3 wins out of 5

      // Realistic should have lower PnL due to 0.7 entry + 0.3 exit slippage + rejection rate
      expect(report.simulatedRealistic.totalPnl).toBeLessThan(report.demoResults.totalPnl);
      
      // Pessimistic should be even lower
      expect(report.simulatedPessimistic.totalPnl).toBeLessThan(report.simulatedRealistic.totalPnl);
    });
    
    it('should return not enough data recommendation if trades < 30', () => {
        const mockTrades: TradeRecord[] = [
            { pnl: 50, entryPrice: 1.1000, exitPrice: 1.1050, action: 'BUY', instrument: 'EUR/USD', units: 10000 },
            { pnl: 40, entryPrice: 1.1050, exitPrice: 1.1090, action: 'BUY', instrument: 'EUR/USD', units: 10000 },
        ];
        const report = DemoLiveSimulator.runSimulation(mockTrades, 100);
        expect(report.recommendation).toContain('sample size is too small');
    });
  });

});
