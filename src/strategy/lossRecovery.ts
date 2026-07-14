import { Strategy, Signal, MarketContext } from './strategy.interface';
import { db } from '../db';
import { logger } from '../logger';
import { config } from '../config';
import { RiskManager } from '../risk/riskManager';

export class LossRecoveryStrategy implements Strategy {
  name = 'loss_recovery';
  
  // Tracks consecutive attempts per instrument to enforce the 2-attempt safety cap
  private recoveryAttempts: Record<string, number> = {};

  onCandle(candle: any, context: MarketContext): Signal | null {
    const instrument = context.currentQuote.instrument;
    
    // Do nothing if we already have an active position for this strategy
    if (context.activePosition) return null;

    if (context.historicalCandles.length < 14) return null;

    // Global cap of 3 concurrent recovery-sourced trades
    const openRecoveryTrades = db.prepare(`
      SELECT COUNT(*) as count
      FROM positions
      WHERE strategy = 'loss_recovery'
    `).get() as { count: number };
    if (openRecoveryTrades.count >= 3) {
      return null;
    }

    // Cumulative 24h risk check
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentRecoveryTradesRow = db.prepare(`
      SELECT COUNT(*) as count 
      FROM trades 
      WHERE strategy = 'loss_recovery' AND entry_time >= ?
    `).get(oneDayAgo) as { count: number };
    
    const currentRiskPct = RiskManager.getEffectiveRiskPct(context.accountEquity, config.RISK_MODE);
    const cumulativeRiskPct = (recentRecoveryTradesRow?.count || 0) * currentRiskPct;
    
    if (cumulativeRiskPct >= config.RISK_MAX_RECOVERY_CUMULATIVE_PCT) {
      return null;
    }

    // 1. Check the last closed trade for this instrument
    const lastTradeRow = db.prepare(`
      SELECT id, pnl, strategy
      FROM trades
      WHERE instrument = ? AND status = 'CLOSED'
      ORDER BY exit_time DESC
      LIMIT 1
    `).get(instrument) as { id: string; pnl: number; strategy: string } | undefined;

    // If there is no previous trade, or the last trade was a WIN, we do nothing.
    if (!lastTradeRow || lastTradeRow.pnl >= 0) {
      this.recoveryAttempts[instrument] = 0; // reset attempts on win
      return null;
    }

    const lossAmount = Math.abs(lastTradeRow.pnl);

    // 2. Enforce the 2-attempt safety cap
    const attempts = this.recoveryAttempts[instrument] || 0;
    if (attempts >= 2) {
      // Don't warn every tick, just return null
      return null;
    }

    // 3. Find a recovery entry signal using short-term RSI (Period 7 for faster signals)
    const closes = context.historicalCandles.map(c => c.close);
    const rsi = this.calculateRSI(closes, 7);
    const currentRsi = rsi[rsi.length - 1];

    // Wait for RSI to show a strong pullback condition to increase win probability
    let action: 'BUY' | 'SELL' | null = null;
    
    if (currentRsi < 30) {
      // Oversold - potential bounce up
      action = 'BUY';
    } else if (currentRsi > 70) {
      // Overbought - potential bounce down
      action = 'SELL';
    }

    if (action) {
      logger.info(`[${this.name}] ${instrument} triggering recovery attempt ${attempts + 1}/2 for a $${lossAmount.toFixed(2)} loss.`);
      this.recoveryAttempts[instrument] = attempts + 1;
      
      return {
        action,
        instrument,
        strategy: this.name,
        amountToRecover: lossAmount,
      };
    }

    return null;
  }

  /**
   * Simple RSI Calculation
   */
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
