import { PositionInfo } from '../strategy/strategy.interface';
import { config } from '../config';
import { logger } from '../logger';

export class PortfolioHeatMonitor {
  /**
   * Calculates current portfolio open risk percentage.
   */
  public static calculateOpenRiskPct(openPositions: PositionInfo[], accountEquity: number): number {
    if (accountEquity <= 0 || openPositions.length === 0) return 0;

    let totalRiskUsd = 0;
    for (const pos of openPositions) {
      if (pos.stopLoss && pos.entryPrice) {
        const slDist = Math.abs(pos.entryPrice - pos.stopLoss);
        const isJpy = pos.instrument.includes('JPY');
        const isXau = pos.instrument.includes('XAU');
        const contractSize = isXau ? 100 : 100000;
        const lots = pos.units / contractSize;
        const riskUsd = pos.units * slDist;
        totalRiskUsd += riskUsd;
      } else {
        // Fallback estimate if SL not present (1.5% of position value)
        totalRiskUsd += (pos.units * pos.entryPrice) * 0.015;
      }
    }

    return (totalRiskUsd / accountEquity) * 100;
  }

  /**
   * Verifies if adding proposed trade risk will exceed the portfolio heat cap.
   */
  public static checkHeatCap(openPositions: PositionInfo[], accountEquity: number, proposedRiskPct: number): boolean {
    const currentHeatPct = this.calculateOpenRiskPct(openPositions, accountEquity);
    const maxHeatCap = config.RISK_MAX_TOTAL_OPEN_RISK_PCT || 3.0;

    if (currentHeatPct + proposedRiskPct > maxHeatCap) {
      logger.warn(`[PORTFOLIO HEAT] Trade rejected: Current Heat ${(currentHeatPct).toFixed(2)}% + Proposed ${proposedRiskPct.toFixed(2)}% exceeds Cap of ${maxHeatCap.toFixed(2)}%`);
      return false;
    }

    return true;
  }
}
