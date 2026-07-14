import { config } from '../config';
import { logger } from '../logger';
import { db } from '../db';
import { PositionInfo } from '../strategy/strategy.interface';

type RiskMode = 'conservative' | 'standard' | 'aggressive';

export class RiskManager {
  /**
   * Checks if we can open a new position based on concurrent position limits.
   */
  public static checkPositionLimit(currentOpenCount: number): boolean {
    if (currentOpenCount >= config.RISK_MAX_CONCURRENT_POSITIONS) {
      logger.warn(`Risk Management: Position count limit reached (${currentOpenCount}/${config.RISK_MAX_CONCURRENT_POSITIONS}). Rejects signal.`);
      return false;
    }
    return true;
  }

  /**
   * Checks if the daily loss limit has been breached.
   * Compares today's realized + unrealized PnL against starting equity.
   */
  public static checkDailyLossLimit(currentBalance: number, currentUnrealized: number): boolean {
    const todayStr = new Date().toISOString().substring(0, 10); // YYYY-MM-DD
    
    // Sum realized PnL of trades closed today
    const row = db.prepare(`
      SELECT SUM(pnl) as realizedToday
      FROM trades
      WHERE exit_time LIKE ? AND status = 'CLOSED'
    `).get(`${todayStr}%`) as { realizedToday: number | null };

    const realizedToday = row?.realizedToday || 0;
    const totalTodayPnL = realizedToday + currentUnrealized;
    const limitAmount = config.STARTING_BALANCE * (config.RISK_DAILY_LOSS_LIMIT_PCT / 100);

    if (totalTodayPnL <= -limitAmount) {
      logger.warn(`Risk Management: Daily loss limit breached (PnL: $${totalTodayPnL.toFixed(2)}, Limit: -$${limitAmount.toFixed(2)}). Halted trading for today.`);
      return false;
    }
    return true;
  }

  public static checkWeeklyLossLimit(currentBalance: number, currentUnrealized: number): boolean {
    const today = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 7);
    const startStr = sevenDaysAgo.toISOString();

    const row = db.prepare(`
      SELECT SUM(pnl) as realizedWeek
      FROM trades
      WHERE exit_time >= ? AND status = 'CLOSED'
    `).get(startStr) as { realizedWeek: number | null };

    const realizedWeek = row?.realizedWeek || 0;
    const totalWeekPnL = realizedWeek + currentUnrealized;
    const limitAmount = config.STARTING_BALANCE * (config.RISK_WEEKLY_LOSS_LIMIT_PCT / 100);

    if (totalWeekPnL <= -limitAmount) {
      logger.warn(`Risk Management: Weekly loss limit breached (PnL: $${totalWeekPnL.toFixed(2)}, Limit: -$${limitAmount.toFixed(2)}).`);
      return false;
    }
    return true;
  }

  public static getEffectiveRiskPct(balance: number, mode: RiskMode | string): number {
    // Small accounts get a lower % risk floor, scaling up as equity grows
    if (balance < 150) return mode === 'aggressive' ? 1.0 : 0.5;
    if (balance < 500)  return mode === 'aggressive' ? 1.5 : 1.0;
    return config.RISK_BASE_PCT_PER_TRADE;
  }

  /**
   * Calculates optimal units to trade based on risk percentage of balance and stop loss distance.
   * Formula: Units = (Balance * Risk%) / (Stop Loss in Pips * Pip Value)
   */
  public static calculatePositionSize(
    instrument: string,
    stopLossPips: number,
    currentBalance: number
  ): number {
    const isJpy = instrument.includes('JPY');
    const pipSize = isJpy ? 0.01 : 0.0001;
    const riskPct = this.getEffectiveRiskPct(currentBalance, config.RISK_MODE) / 100;
    
    const amountToRisk = currentBalance * riskPct;
    
    // Use tight 15-pip default SL for low losses
    const slPips = stopLossPips || 15;
    const slDistance = slPips * pipSize;

    let units = amountToRisk / slDistance;
    units = Math.round(units);

    // Min lot check (0.01 lot = 1,000 units)
    const minLotUnits = 1000;
    const minLotRisk = minLotUnits * slDistance;

    if (minLotRisk > amountToRisk) {
      logger.warn(`Risk budget too small for minimum lot size (0.01 lot) at this SL distance - widen SL or skip. Budget: $${amountToRisk.toFixed(2)}, Min Risk: $${minLotRisk.toFixed(2)}. Rejected.`);
      return 0;
    }

    // Limit leverage to 30:1 (standard retail limit)
    const maxLeverage = 30;
    const maxUnits = currentBalance * maxLeverage;
    if (units > maxUnits) {
      units = maxUnits;
    }

    return units;
  }

  public static checkTotalOpenRisk(currentBalance: number, openPositions: PositionInfo[], newPositionRiskPct: number = 0): boolean {
    let totalRiskDollars = 0;

    for (const pos of openPositions) {
      if (pos.stopLoss) {
        const riskDollars = pos.units * Math.abs(pos.entryPrice - pos.stopLoss);
        totalRiskDollars += riskDollars;
      }
    }

    const maxRiskDollars = currentBalance * (config.RISK_MAX_TOTAL_OPEN_RISK_PCT / 100);
    const riskWithNew = totalRiskDollars + (currentBalance * newPositionRiskPct / 100);

    if (riskWithNew > maxRiskDollars) {
      logger.warn(`Risk Management: Total open risk limit breached. (Current: $${totalRiskDollars.toFixed(2)}, Max: $${maxRiskDollars.toFixed(2)}). Rejects signal.`);
      return false;
    }

    return true;
  }

  private static getUsdDirection(instrument: string, action: 'BUY' | 'SELL'): 'LONG_USD' | 'SHORT_USD' | 'NEUTRAL' {
    if (instrument.endsWith('USD')) {
      return action === 'BUY' ? 'SHORT_USD' : 'LONG_USD';
    } else if (instrument.startsWith('USD')) {
      return action === 'BUY' ? 'LONG_USD' : 'SHORT_USD';
    }
    return 'NEUTRAL';
  }

  public static checkCorrelationExposure(instrument: string, openPositions: PositionInfo[], action: 'BUY' | 'SELL'): boolean {
    const groups = config.CORRELATION_GROUPS || ["USD:EUR/USD,GBP/USD,USD/JPY,AUD/USD,USD/CHF"];

    for (const group of groups) {
      const parts = group.split(':');
      if (parts.length !== 2) continue;
      const [_, pairsStr] = parts;
      const pairs = pairsStr.split(',').map(p => p.trim());

      if (pairs.includes(instrument)) {
        const newDirection = this.getUsdDirection(instrument, action);

        for (const pos of openPositions) {
          if (pos.instrument !== instrument && pairs.includes(pos.instrument)) {
            const existingDirection = this.getUsdDirection(pos.instrument, pos.action);
            if (newDirection === existingDirection && newDirection !== 'NEUTRAL') {
               logger.warn(`Risk Management: Correlation limit. Blocking ${action} ${instrument} due to existing correlated exposure in ${pos.instrument}.`);
               return false;
            }
          }
        }
      }
    }

    return true;
  }
}
