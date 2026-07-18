import { Strategy, Signal, MarketContext } from './strategy.interface';
import { db } from '../db';
import { logger } from '../logger';
import { config } from '../config';
import { RiskManager } from '../risk/riskManager';
import { RejectionLogger } from '../risk/rejectionLogger';

/**
 * LossRecoveryStrategy — Realistic Edge Edition
 *
 * Recovery mode is bounded in four independent ways and remains strictly
 * non-martingale (standard risk sizing; the % is never increased after a loss):
 *
 *  1. Cumulative 24h risk budget:   sums actual trades.risk_pct from DB
 *     (falls back to configured risk for legacy rows that predate the column).
 *  2. Per-instrument attempt cap:   max 2 attempts since the last winning exit
 *     on that instrument — derived from DB, survives process restarts.
 *  3. Auto-disable:                 after RECOVERY_MAX_CONSECUTIVE_LOSSES
 *     consecutive losing recovery trades, recovery mode disables itself for
 *     RECOVERY_COOLDOWN_HOURS, logging RECOVERY_DISABLED once per streak.
 *  4. Global concurrent-position cap of 3 recovery positions.
 */
export class LossRecoveryStrategy implements Strategy {
  name = 'loss_recovery';

  onCandle(candle: any, context: MarketContext): Signal | null {
    const instrument = context.currentQuote.instrument;

    // Do nothing if we already have an active position for this strategy
    if (context.activePosition) return null;

    if (context.historicalCandles.length < 14) return null;

    // ------------------------------------------------------------------
    // Bound 3: Auto-disable check — query DB for consecutive losing
    // recovery trades and respect the cooldown period.
    // ------------------------------------------------------------------
    if (this.isAutoDisabled(instrument)) return null;

    // ------------------------------------------------------------------
    // Bound 4: Global cap of 3 concurrent recovery-sourced trades
    // ------------------------------------------------------------------
    const openRecoveryTrades = db.prepare(`
      SELECT COUNT(*) as count
      FROM positions
      WHERE strategy = 'loss_recovery'
    `).get() as { count: number };
    if (openRecoveryTrades.count >= 3) return null;

    // ------------------------------------------------------------------
    // Bound 1: Cumulative 24h risk check — use actual risk_pct from DB
    // (falls back to configured risk for rows that predate the column).
    // ------------------------------------------------------------------
    const prospectiveRisk = RiskManager.getEffectiveRiskPct(context.accountEquity, config.RISK_MODE);
    if (!this.hasCumulativeBudget(prospectiveRisk, instrument)) return null;

    // ------------------------------------------------------------------
    // 1. Check the last closed trade for this instrument
    // ------------------------------------------------------------------
    const lastTradeRow = db.prepare(`
      SELECT id, pnl, strategy
      FROM trades
      WHERE instrument = ? AND status = 'CLOSED'
      ORDER BY exit_time DESC
      LIMIT 1
    `).get(instrument) as { id: string; pnl: number; strategy: string } | undefined;

    // If there is no previous trade, or the last trade was a WIN, do nothing.
    if (!lastTradeRow || lastTradeRow.pnl >= 0) return null;

    const lossAmount = Math.abs(lastTradeRow.pnl);

    // ------------------------------------------------------------------
    // Bound 2: Per-instrument attempt cap (DB-derived, restart-safe)
    // Count recovery trades placed on this instrument AFTER the last
    // non-negative exit (i.e. win or break-even).
    // ------------------------------------------------------------------
    const attempts = this.countRecoveryAttemptsSinceLastWin(instrument);
    if (attempts >= 2) return null;

    // ------------------------------------------------------------------
    // 3. Entry signal — short-term RSI(7) for faster reaction
    // ------------------------------------------------------------------
    const closes = context.historicalCandles.map((c) => c.close);
    const rsi = this.calculateRSI(closes, 7);
    const currentRsi = rsi[rsi.length - 1];

    let action: 'BUY' | 'SELL' | null = null;
    if (currentRsi < 30) action = 'BUY';   // Oversold — potential bounce up
    else if (currentRsi > 70) action = 'SELL'; // Overbought — potential bounce down

    if (action) {
      logger.info(
        `[${this.name}] ${instrument} triggering recovery attempt ${attempts + 1}/2 ` +
        `for a $${lossAmount.toFixed(2)} loss. RSI=${currentRsi.toFixed(1)}`
      );

      return {
        action,
        instrument,
        strategy: this.name,
        amountToRecover: lossAmount,
      };
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Bound 1: Cumulative 24h budget using actual risk_pct values
  // --------------------------------------------------------------------------
  private hasCumulativeBudget(prospectiveRiskPct: number, instrument: string): boolean {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const fallback = RiskManager.getEffectiveRiskPct(
      config.STARTING_BALANCE,
      config.RISK_MODE
    );

    const rows = db.prepare(`
      SELECT risk_pct
      FROM trades
      WHERE strategy = 'loss_recovery' AND entry_time >= ?
    `).all(oneDayAgo) as { risk_pct: number | null }[];

    const cumulativeRiskPct = rows.reduce(
      (sum, r) => sum + (r.risk_pct !== null ? r.risk_pct : fallback),
      0
    );

    // Pre-add the prospective trade's risk before comparing
    if (cumulativeRiskPct + prospectiveRiskPct > config.RISK_MAX_RECOVERY_CUMULATIVE_PCT) {
      logger.debug(
        `[${this.name}] ${instrument} cumulative 24h recovery risk budget exhausted ` +
        `(${(cumulativeRiskPct + prospectiveRiskPct).toFixed(2)}% > ${config.RISK_MAX_RECOVERY_CUMULATIVE_PCT}%)`
      );
      return false;
    }
    return true;
  }

  // --------------------------------------------------------------------------
  // Bound 2: DB-derived per-instrument attempt count since last win
  // --------------------------------------------------------------------------
  private countRecoveryAttemptsSinceLastWin(instrument: string): number {
    // Find the most recent non-negative exit (win or break-even) for this instrument
    const lastWin = db.prepare(`
      SELECT exit_time
      FROM trades
      WHERE instrument = ? AND status = 'CLOSED' AND pnl >= 0
      ORDER BY exit_time DESC
      LIMIT 1
    `).get(instrument) as { exit_time: string } | undefined;

    let countQuery: string;
    let params: any[];

    if (lastWin) {
      countQuery = `
        SELECT COUNT(*) as count
        FROM trades
        WHERE instrument = ? AND strategy = 'loss_recovery'
          AND status IN ('OPEN', 'CLOSED')
          AND entry_time > ?
      `;
      params = [instrument, lastWin.exit_time];
    } else {
      // No win ever — count all recovery attempts for this instrument
      countQuery = `
        SELECT COUNT(*) as count
        FROM trades
        WHERE instrument = ? AND strategy = 'loss_recovery'
          AND status IN ('OPEN', 'CLOSED')
      `;
      params = [instrument];
    }

    const row = db.prepare(countQuery).get(...params) as { count: number };
    return row?.count || 0;
  }

  // --------------------------------------------------------------------------
  // Bound 3: Auto-disable — consecutive losing recovery trades
  // --------------------------------------------------------------------------
  private isAutoDisabled(instrument: string): boolean {
    const maxLosses = config.RECOVERY_MAX_CONSECUTIVE_LOSSES;
    const cooldownHours = config.RECOVERY_COOLDOWN_HOURS;

    // Fetch the most recent recovery trades
    const recent = db.prepare(`
      SELECT pnl, exit_time
      FROM trades
      WHERE strategy = 'loss_recovery' AND status = 'CLOSED'
      ORDER BY exit_time DESC
      LIMIT ?
    `).all(maxLosses) as { pnl: number; exit_time: string }[];

    if (recent.length < maxLosses) return false;

    const allLosses = recent.every((t) => t.pnl < 0);
    if (!allLosses) return false;

    // All consecutive — check cooldown
    const lastLossTime = new Date(recent[0].exit_time);
    const cooldownUntil = new Date(lastLossTime.getTime() + cooldownHours * 60 * 60 * 1000);
    const now = new Date();

    if (now < cooldownUntil) {
      logger.debug(
        `[${this.name}] Auto-disabled for ${instrument}: ${maxLosses} consecutive recovery losses. ` +
        `Cooldown until ${cooldownUntil.toISOString()}.`
      );
      RejectionLogger.log(
        'LossRecoveryStrategy',
        'RECOVERY_DISABLED',
        instrument,
        undefined,
        this.name,
        `${maxLosses} consecutive recovery losses. Cooldown until ${cooldownUntil.toISOString()}`
      );
      return true;
    }

    return false;
  }

  // --------------------------------------------------------------------------
  // RSI calculation (simple, not Wilder's)
  // --------------------------------------------------------------------------
  private calculateRSI(closes: number[], period: number): number[] {
    const rsi = new Array(closes.length).fill(0);
    if (closes.length < period) return rsi;

    let sumGains = 0;
    let sumLosses = 0;

    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) sumGains += diff;
      else sumLosses -= diff;
    }

    let avgGain = sumGains / period;
    let avgLoss = sumLosses / period;

    for (let i = period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      if (avgLoss === 0) {
        rsi[i] = 100;
      } else {
        const rs = avgGain / avgLoss;
        rsi[i] = 100 - (100 / (1 + rs));
      }
    }

    return rsi;
  }
}
