import { config } from '../config';
import { logger } from '../logger';
import { db } from '../db';
import { PositionInfo } from '../strategy/strategy.interface';
import { RejectionLogger } from './rejectionLogger';
import { TelegramNotifier } from '../notifier/telegram';

type RiskMode = 'conservative' | 'standard' | 'aggressive';

/** Return value of calculateSizedOrder — callers should persist riskPctUsed. */
export interface SizedOrder {
  units: number;          // Exact units after broker-step flooring
  riskPctUsed: number;    // Effective risk % actually used (for DB persistence)
  amountToRisk: number;   // Dollar amount risked
}

export class RiskManager {
  // Deduplication: only alert once per calendar day for daily/weekly limit
  private static dailyLimitAlertedDate: string = '';
  private static weeklyLimitAlertedDate: string = '';
  // Deduplication: only alert Telegram once per consecutive-loss streak
  private static consecutiveLossAlertedCount: number = 0;

  /**
   * Checks if we can open a new position based on concurrent position limits.
   */
  public static checkPositionLimit(currentOpenCount: number, instrument: string = 'UNKNOWN'): boolean {
    if (currentOpenCount >= config.RISK_MAX_CONCURRENT_POSITIONS) {
      logger.warn(`Risk Management: Position count limit reached (${currentOpenCount}/${config.RISK_MAX_CONCURRENT_POSITIONS}). Rejects signal.`);
      RejectionLogger.log(
        'RiskManager.checkPositionLimit',
        'POSITION_LIMIT',
        instrument,
        undefined,
        undefined,
        `${currentOpenCount}/${config.RISK_MAX_CONCURRENT_POSITIONS} positions open`
      );
      return false;
    }
    return true;
  }

  /**
   * Checks if the daily loss limit has been breached.
   * Compares today's realized + unrealized PnL against starting equity.
   */
  public static checkDailyLossLimit(currentBalance: number, currentUnrealized: number, instrument: string = 'UNKNOWN'): boolean {
    const todayStr = new Date().toISOString().substring(0, 10); // YYYY-MM-DD
    
    // Sum realized PnL of trades closed today
    const row = db.prepare(`
      SELECT SUM(pnl) as realizedToday
      FROM trades
      WHERE exit_time LIKE ? AND status = 'CLOSED'
    `).get(`${todayStr}%`) as { realizedToday: number | null };

    const realizedToday = row?.realizedToday || 0;
    const totalTodayPnL = realizedToday + currentUnrealized;
    
    // PROP FIRM MODE: Calculate strict Start of Day Balance
    const startOfDayBalance = currentBalance - realizedToday;
    const limitAmount = startOfDayBalance * (config.RISK_DAILY_LOSS_LIMIT_PCT / 100);
    const limitEquity = startOfDayBalance - limitAmount;
    const currentEquity = currentBalance + currentUnrealized;

    if (currentEquity <= limitEquity) {
      logger.warn(`Risk Management: Daily loss limit breached (Equity: $${currentEquity.toFixed(2)}, Limit Equity: $${limitEquity.toFixed(2)}). Halted trading for today.`);
      
      RejectionLogger.log(
        'RiskManager.checkDailyLossLimit',
        'DAILY_LOSS_LIMIT',
        instrument,
        undefined,
        undefined,
        `Today PnL: $${totalTodayPnL.toFixed(2)}, Limit: -$${limitAmount.toFixed(2)}`
      );

      // Alert via Telegram (once per day)
      if (this.dailyLimitAlertedDate !== todayStr) {
        this.dailyLimitAlertedDate = todayStr;
        TelegramNotifier.sendMessage(
          `⚠️ *DAILY LOSS LIMIT HIT*\nToday PnL: $${totalTodayPnL.toFixed(2)}\nLimit: -$${limitAmount.toFixed(2)}\nNo new trades until tomorrow.`
        );
      }

      return false;
    }
    return true;
  }

  public static checkWeeklyLossLimit(currentBalance: number, currentUnrealized: number, instrument: string = 'UNKNOWN'): boolean {
    const today = new Date();
    const todayStr = today.toISOString().substring(0, 10);
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
      
      RejectionLogger.log(
        'RiskManager.checkWeeklyLossLimit',
        'WEEKLY_LOSS_LIMIT',
        instrument,
        undefined,
        undefined,
        `Week PnL: $${totalWeekPnL.toFixed(2)}, Limit: -$${limitAmount.toFixed(2)}`
      );

      // Alert via Telegram (once per day)
      if (this.weeklyLimitAlertedDate !== todayStr) {
        this.weeklyLimitAlertedDate = todayStr;
        TelegramNotifier.sendMessage(
          `⚠️ *WEEKLY LOSS LIMIT HIT*\nWeek PnL: $${totalWeekPnL.toFixed(2)}\nLimit: -$${limitAmount.toFixed(2)}`
        );
      }

      return false;
    }
    return true;
  }

  /**
   * Checks if daily profit has reached the lock target. If so, trading is halted for the day.
   */
  public static checkDailyProfitLock(
    balance: number,
    currentUnrealized: number,
    instrument: string,
    confidence?: number,
    strategy?: string
  ): boolean {
    const today = new Date().toISOString().split('T')[0];
    
    const row = db.prepare(`
      SELECT SUM(pnl) as realizedToday, COUNT(*) as totalClosed
      FROM trades
      WHERE status = 'CLOSED' AND exit_time LIKE ?
    `).get(`${today}%`) as { realizedToday: number | null; totalClosed: number };

    const realizedToday = row?.realizedToday || 0;
    const totalTodayPnL = realizedToday + currentUnrealized;
    
    const targetAmountPct = config.STARTING_BALANCE * (config.RISK_DAILY_PROFIT_LOCK_PCT / 100);
    const targetAmountUsd = config.RISK_DAILY_PROFIT_TARGET_USD;

    const isPctLockMet = config.RISK_DAILY_PROFIT_LOCK_PCT > 0 && totalTodayPnL >= targetAmountPct;
    const isUsdLockMet = targetAmountUsd > 0 && totalTodayPnL >= targetAmountUsd;

    if (isPctLockMet || isUsdLockMet) {
      const targetStr = isPctLockMet 
        ? `$${targetAmountPct.toFixed(2)} (${config.RISK_DAILY_PROFIT_LOCK_PCT}%)` 
        : `$${targetAmountUsd.toFixed(2)}`;

      // High-Conviction Bonus Trade Exception: Allow max 2 bonus trades if ML Confidence >= 80% or SMC Liquidity setup
      const isHighConviction = (strategy === 'ml_signal' && (confidence ?? 0) >= 0.80) || strategy === 'smc_liquidity';
      
      const bonusRow = db.prepare(`
        SELECT COUNT(*) as bonusCount
        FROM trades
        WHERE status = 'CLOSED' AND exit_time LIKE ? AND (strategy = 'smc_liquidity' OR (strategy = 'ml_signal' AND pnl != 0))
      `).get(`${today}%`) as { bonusCount: number };

      const bonusTradesToday = bonusRow?.bonusCount || 0;

      if (isHighConviction && bonusTradesToday < 2 && instrument !== 'GLOBAL') {
        logger.info(
          `[BONUS TRADE PERMITTED] Today's profit target (${targetStr}) reached, but executing high-conviction setup ` +
          `#${bonusTradesToday + 1}/2 (${strategy}, confidence: ${((confidence || 0) * 100).toFixed(1)}%).`
        );
        return true;
      }

      RejectionLogger.log(
        'RiskManager.checkDailyProfitLock',
        'DAILY_PROFIT_LOCK',
        instrument,
        undefined,
        strategy,
        `Today PnL: $${totalTodayPnL.toFixed(2)}, Target: ${targetStr}. Profit locked for today.`
      );
      
      return false;
    }
    return true;
  }

  /**
   * Checks if the trade action is allowed based on the global trade direction config.
   */
  public static checkTradeDirection(action: 'BUY' | 'SELL', instrument: string): boolean {
    if (config.TRADE_DIRECTION === 'BOTH') return true;
    
    if (config.TRADE_DIRECTION === 'BUY_ONLY' && action === 'SELL') {
      RejectionLogger.log(
        'RiskManager.checkTradeDirection',
        'DIRECTION_RESTRICTION',
        instrument,
        action,
        undefined,
        `Blocked SELL signal due to BUY_ONLY mode`
      );
      return false;
    }
    
    if (config.TRADE_DIRECTION === 'SELL_ONLY' && action === 'BUY') {
      RejectionLogger.log(
        'RiskManager.checkTradeDirection',
        'DIRECTION_RESTRICTION',
        instrument,
        action,
        undefined,
        `Blocked BUY signal due to SELL_ONLY mode`
      );
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
   * calculateSizedOrder — Dynamic Kelly-style position sizing.
   *
   * Two independent down-scaling factors multiply the base risk:
   *
   *   confidence scalar  = min(1, confidence / ML_CONFIDENCE_FULL_SIZE)
   *   volatility scalar  = min(1, SIZING_VOL_TARGET_PERCENTILE / atrPercentile)
   *     ↳ NOTE: The spec's literal formula `min(1, 1/atr_percentile)` is a
   *       mathematical no-op for any percentile ≤ 1.  The target-percentile
   *       ratio above implements the documented intent.
   *
   * The product of scalars is floored at 25% of base risk so a valid signal
   * is never scaled to dust.  The final risk % is hard-capped at
   * RISK_MAX_POSITION_SIZE_PCT (default 2%) regardless of base settings.
   *
   * Volume is floored to 0.01-lot increments so recorded PnL matches the
   * broker's actual fill, and units are recomputed from the floored volume.
   *
   * Returns { units, riskPctUsed, amountToRisk }; callers should persist
   * riskPctUsed into trades.risk_pct for accurate downstream accounting.
   */
  public static calculateSizedOrder(
    instrument: string,
    stopLossPips: number,
    currentBalance: number,
    confidence?: number,      // ML confidence (0–1); undefined = rule-based (no scaling)
    atrPercentile?: number,   // From computeAtrPercentile; undefined = no vol scaling
    currentPrice?: number     // Needed to convert USD risk to quote currency for USD/XXX pairs
  ): SizedOrder {
    const isJpy = instrument.includes('JPY');
    const isXau = instrument.includes('XAU');
    const pipSize = (isJpy || isXau) ? 0.01 : 0.0001;

    // Base risk — capped at RISK_MAX_POSITION_SIZE_PCT so even a misconfigured
    // RISK_BASE_PCT_PER_TRADE=5 cannot push risk past the safety ceiling.
    const baseRiskPct = Math.min(
      this.getEffectiveRiskPct(currentBalance, config.RISK_MODE),
      config.RISK_MAX_POSITION_SIZE_PCT
    );

    // --- Confidence scalar (only for ML signals) ---
    let confScalar = 1.0;
    if (confidence !== undefined && config.ML_CONFIDENCE_FULL_SIZE > 0) {
      confScalar = Math.min(1.0, confidence / config.ML_CONFIDENCE_FULL_SIZE);
    }

    // --- Volatility scalar ---
    // Target percentile / current percentile — shrinks size when ATR is
    // elevated relative to its own recent history.  Calm regimes (low
    // percentile) are capped at 1 so we never *increase* size.
    let volScalar = 1.0;
    if (atrPercentile !== undefined && atrPercentile > 0 && config.SIZING_VOL_TARGET_PERCENTILE > 0) {
      volScalar = Math.min(1.0, config.SIZING_VOL_TARGET_PERCENTILE / atrPercentile);
    }

    // Combined scalar — floored at 25% of base risk so a valid trade is never
    // reduced to dust.
    const combinedScalar = Math.max(0.25, confScalar * volScalar);
    const effectiveRiskPct = Math.min(baseRiskPct * combinedScalar, config.RISK_MAX_POSITION_SIZE_PCT);

    let amountToRisk = currentBalance * (effectiveRiskPct / 100);

    if (isXau) {
      // Force risk between $1 and $10 for XAU/USD
      amountToRisk = Math.max(1, Math.min(amountToRisk, 10));
    }

    // Convert USD risk amount to quote currency for USD-base pairs
    if (instrument.startsWith('USD/') && currentPrice) {
      amountToRisk = amountToRisk * currentPrice;
    }

    // Use wide 45-pip default SL if not specified (900 pips for Gold) to ensure small lot sizes and high win rate
    const slPips = stopLossPips || (isXau ? 900 : 45);
    const slDistance = slPips * pipSize;

    // Raw units from risk formula
    let rawUnits = amountToRisk / slDistance;

    // Broker-step flooring: floor volume to 0.01-lot increments,
    // recompute exact units from floored volume.
    const contractSize = isXau ? 100 : 100000;
    let volume = rawUnits / contractSize;
    
    if (isXau) {
      // Force lot size between 0.01 and 0.05 for XAU/USD
      volume = Math.max(0.01, Math.min(volume, 0.05));
    }
    
    const minVolume = 0.01;
    const volMultiplier = 100;

    if (volume < minVolume) volume = 0; // will be caught by min-lot check below
    else volume = Math.floor(volume * volMultiplier) / volMultiplier; // floor to minimum increments
    const units = volume * contractSize;

    // Min-lot check
    const minLotUnits = isXau ? 1 : 1000; // 0.01 lot of 100oz = 1 unit for Gold
    const minLotRisk = minLotUnits * slDistance;

    if (units < minLotUnits || minLotRisk > amountToRisk) {
      logger.warn(
        `[RISK] Min-lot risk budget exceeded for ${instrument}. ` +
        `Budget: $${amountToRisk.toFixed(2)}, Min 0.01-lot needs: $${minLotRisk.toFixed(2)}. Rejected.`
      );
      RejectionLogger.log(
        'RiskManager.calculateSizedOrder',
        'MIN_LOT_RISK_EXCEEDED',
        instrument,
        undefined,
        undefined,
        `Budget: $${amountToRisk.toFixed(2)}, Min lot risk: $${minLotRisk.toFixed(2)}`
      );
      return { units: 0, riskPctUsed: 0, amountToRisk: 0 };
    }

    // Limit leverage to 30:1 (standard retail limit)
    const maxLeverage = 30;
    const maxUnits = currentBalance * maxLeverage;
    const finalUnits = Math.min(units, maxUnits);

    const riskPctUsed = ((finalUnits * slDistance) / currentBalance) * 100;

    logger.debug(
      `[SIZING] ${instrument} confScalar=${confScalar.toFixed(3)} volScalar=${volScalar.toFixed(3)} ` +
      `combinedScalar=${combinedScalar.toFixed(3)} effectiveRisk=${effectiveRiskPct.toFixed(3)}% ` +
      `units=${finalUnits} riskPctUsed=${riskPctUsed.toFixed(4)}%`
    );

    return { units: finalUnits, riskPctUsed, amountToRisk };
  }

  /**
   * Backward-compatible wrapper for existing callers.
   * Internally delegates to calculateSizedOrder; does NOT apply dynamic scaling.
   */
  public static calculatePositionSize(
    instrument: string,
    stopLossPips: number,
    currentBalance: number
  ): number {
    return this.calculateSizedOrder(instrument, stopLossPips, currentBalance).units;
  }

  public static checkTotalOpenRisk(currentBalance: number, openPositions: PositionInfo[], newPositionRiskPct: number = 0, instrument: string = 'UNKNOWN'): boolean {
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
      RejectionLogger.log(
        'RiskManager.checkTotalOpenRisk',
        'TOTAL_OPEN_RISK',
        instrument,
        undefined,
        undefined,
        `Current risk: $${totalRiskDollars.toFixed(2)}, Max: $${maxRiskDollars.toFixed(2)}, New would add: ${newPositionRiskPct.toFixed(2)}%`
      );
      return false;
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // Area 4 — Consecutive-Loss Cooldown
  // -------------------------------------------------------------------------

  /**
   * Returns the cooldown status without logging a rejection.
   * Safe to call for dashboard read-outs.
   */
  public static getConsecutiveLossStatus(): {
    inCooldown: boolean;
    consecutiveLosses: number;
    cooldownUntil: Date | null;
  } {
    const maxLosses = config.RISK_MAX_CONSECUTIVE_LOSSES;
    const cooldownHours = config.RISK_CONSECUTIVE_LOSS_COOLDOWN_HOURS;

    const recentTrades = db.prepare(`
      SELECT pnl, exit_time
      FROM trades
      WHERE status = 'CLOSED'
      ORDER BY exit_time DESC
      LIMIT ?
    `).all(maxLosses) as { pnl: number; exit_time: string }[];

    if (recentTrades.length < maxLosses) {
      return { inCooldown: false, consecutiveLosses: recentTrades.length, cooldownUntil: null };
    }

    const allLosses = recentTrades.every((t) => t.pnl < 0);
    if (!allLosses) {
      return { inCooldown: false, consecutiveLosses: 0, cooldownUntil: null };
    }

    // All maxLosses most recent trades are losses — check if still in cooldown
    const lastLossTime = new Date(recentTrades[0].exit_time);
    const cooldownUntil = new Date(lastLossTime.getTime() + cooldownHours * 60 * 60 * 1000);
    const now = new Date();

    return {
      inCooldown: now < cooldownUntil,
      consecutiveLosses: maxLosses,
      cooldownUntil: now < cooldownUntil ? cooldownUntil : null,
    };
  }

  /**
   * Checks if the consecutive-loss cooldown is active. If so, logs a rejection
   * and alerts Telegram once per streak (deduped by consecutive-loss count).
   */
  public static checkConsecutiveLossCooldown(instrument: string, strategy?: string): boolean {
    const status = this.getConsecutiveLossStatus();

    if (!status.inCooldown) {
      this.consecutiveLossAlertedCount = 0; // reset dedup tracker on recovery
      return true;
    }

    logger.warn(
      `[CIRCUIT BREAKER] Consecutive-loss cooldown active. ` +
      `${status.consecutiveLosses} losses in a row. ` +
      `New entries blocked until ${status.cooldownUntil?.toISOString()}.`
    );

    RejectionLogger.log(
      'RiskManager.checkConsecutiveLossCooldown',
      'CONSECUTIVE_LOSS_COOLDOWN',
      instrument,
      undefined,
      strategy,
      `${status.consecutiveLosses} consecutive losses, cooldown until ${status.cooldownUntil?.toISOString()}`
    );

    // Alert Telegram once per streak length
    if (this.consecutiveLossAlertedCount !== status.consecutiveLosses) {
      this.consecutiveLossAlertedCount = status.consecutiveLosses;
      TelegramNotifier.sendMessage(
        `⚠️ *CONSECUTIVE LOSS COOLDOWN*\n` +
        `${status.consecutiveLosses} losses in a row.\n` +
        `New entries paused until ${status.cooldownUntil?.toUTCString()}.\n` +
        `A single winning trade will clear this.`
      );
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // Correlation helpers
  // -------------------------------------------------------------------------

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
               RejectionLogger.log(
                 'RiskManager.checkCorrelationExposure',
                 'CORRELATION_EXPOSURE',
                 instrument,
                 action,
                 undefined,
                 `Blocked due to correlated exposure in ${pos.instrument} (both ${newDirection})`
               );
               return false;
            }
          }
        }
      }
    }

    return true;
  }
}
