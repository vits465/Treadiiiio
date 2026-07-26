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
    const defaultRisk = Math.min(config.RISK_MAX_POSITION_SIZE_PCT, 2.0);

    // Get last 50 closed trades (exit_time column name in SQLite schema)
    const rows = db.prepare(`
      SELECT pnl FROM trades WHERE status = 'CLOSED' ORDER BY exit_time DESC LIMIT 50
    `).all() as Array<{ pnl: number }>;

    if (rows.length < 10) {
      return defaultRisk; // Not enough trades, use default risk percentage (e.g. 2.0%)
    }

    const wins = rows.filter(r => r.pnl > 0);
    const losses = rows.filter(r => r.pnl <= 0);

    const winRate = wins.length / rows.length;
    const avgWin = wins.length > 0 ? wins.reduce((acc, r) => acc + r.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((acc, r) => acc + r.pnl, 0)) / losses.length : 1;

    if (avgLoss === 0 || winRate === 0) return defaultRisk;

    const winLossRatio = avgWin / avgLoss;
    
    // Half-Kelly formula for safer capital preservation (converted to percentage)
    const rawKellyPct = (winRate - ((1 - winRate) / winLossRatio)) * 100;
    const halfKellyPct = rawKellyPct * 0.5;

    if (halfKellyPct <= 0) {
      logger.info(`Kelly Criterion suggested <= 0% risk (WinRate: ${(winRate * 100).toFixed(1)}%). Using minimum floor 0.5%.`);
      return 0.5; // 0.5% floor
    }

    // Cap between 0.5% and max config risk (e.g. 2.0%)
    const finalRisk = Math.min(Math.max(halfKellyPct, 0.5), defaultRisk);
    logger.info(`Kelly Criterion calculated optimal risk: ${finalRisk.toFixed(2)}% (WinRate: ${(winRate * 100).toFixed(1)}%, W/L Ratio: ${winLossRatio.toFixed(2)})`);

    return finalRisk;
  } catch (err: any) {
    logger.error(`Error calculating Kelly sizing: ${err.message}`);
    return Math.min(config.RISK_MAX_POSITION_SIZE_PCT, 2.0);
  }
}
