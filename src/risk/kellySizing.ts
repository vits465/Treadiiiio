// src/risk/kellySizing.ts
import { db } from '../db';
import { config } from '../config';
import { logger } from '../logger';

/**
 * Calculates optimal position risk percentage using Kelly Criterion:
 * Kelly % = W - ((1 - W) / R)
 * where W = Win Rate, R = Win/Loss Ratio
 */
export function calculateKellyRiskPct(): number {
  try {
    const defaultRisk = config.RISK_MAX_POSITION_SIZE_PCT;

    // Get last 50 closed trades
    const rows = db.prepare(`
      SELECT pnl FROM trades WHERE status = 'CLOSED' ORDER BY closeTime DESC LIMIT 50
    `).all() as Array<{ pnl: number }>;

    if (rows.length < 10) {
      return defaultRisk; // Not enough trades, use default risk
    }

    const wins = rows.filter(r => r.pnl > 0);
    const losses = rows.filter(r => r.pnl <= 0);

    const winRate = wins.length / rows.length;
    const avgWin = wins.length > 0 ? wins.reduce((acc, r) => acc + r.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((acc, r) => acc + r.pnl, 0)) / losses.length : 1;

    if (avgLoss === 0 || winRate === 0) return defaultRisk;

    const winLossRatio = avgWin / avgLoss;
    
    // Half-Kelly formula for safer capital preservation
    const rawKelly = winRate - ((1 - winRate) / winLossRatio);
    const halfKelly = rawKelly * 0.5;

    if (halfKelly <= 0) {
      logger.info(`Kelly Criterion suggested 0% risk (WinRate: ${(winRate * 100).toFixed(1)}%). Using minimum floor 0.5%.`);
      return 0.005; // 0.5% floor
    }

    // Cap between 0.5% and max config risk (e.g. 2%)
    const finalRisk = Math.min(Math.max(halfKelly, 0.005), config.RISK_MAX_POSITION_SIZE_PCT);
    logger.info(`Kelly Criterion calculated optimal risk: ${(finalRisk * 100).toFixed(2)}% (WinRate: ${(winRate * 100).toFixed(1)}%, W/L Ratio: ${winLossRatio.toFixed(2)})`);

    return finalRisk;
  } catch (err: any) {
    logger.error(`Error calculating Kelly sizing: ${err.message}`);
    return config.RISK_MAX_POSITION_SIZE_PCT;
  }
}
