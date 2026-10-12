import { config } from '../config';
import { logger } from '../logger';
import { db } from '../db';
import { PositionInfo } from '../strategy/strategy.interface';
import { RejectionLogger } from './rejectionLogger';
import { TelegramNotifier } from '../notifier/telegram';
import { CorrelationManager } from './correlationManager';
import { calculateKellyRiskPct } from './kellySizing';
import { SymbolNormalizer } from '../utils/symbolNormalizer';
import { computeAtrPercentile } from './volatility';
import { Candle } from '../data/priceFeed';

export type SizeTier = 'DISCARDED' | 'REDUCED' | 'NORMAL' | 'STRETCH';

export interface SizingDecision {
  lots: number;
  riskUsdAtStop: number;
  sizeTier: SizeTier;
  effectiveRiskPct: number;
  confidenceScore: number;
  instrument: string;
  accountEquity: number;
  currentOpenRiskPct: number;
  timestamp: string;
}

export interface CircuitBreakerStatus {
  breached: boolean;
  reason: string;
  dailyPnlPct: number;
  currentEquity: number;
  dayStartEquity: number;
  triggeredAt?: string;
}

export interface TradeOutcome {
  id: string;
  instrument: string;
  pnl: number;
  exitTime: string;
  strategy?: string;
}

export interface SizedOrder {
  units: number;
  riskPctUsed: number;
  amountToRisk: number;
}

export class RiskManager {
  // Same-day manual/next-session circuit breaker state
  private static circuitBreakerBreachedDate: string = '';
  private static circuitBreakerReason: string = '';
  private static lastBreakerTriggerTime: string = '';
  private static lastBreakerEquity: number = 0;
  private static lastBreakerOpenPositionsCount: number = 0;

  // Telegram alert deduplication
  private static dailyLimitAlertedDate: string = '';
  private static weeklyLimitAlertedDate: string = '';
  private static consecutiveLossAlertedCount: number = 0;

  // Last sizing decision for read-only status reporting
  private static lastDecision: SizingDecision | null = null;

  // Phase 5 Strategy Quarantine State
  private static quarantinedStrategies: Set<string> = new Set();

  /**
   * Resets the daily circuit breaker lockout (manual reset or next-session reset).
   */
  public static resetDailyCircuitBreaker(): void {
    this.circuitBreakerBreachedDate = '';
    this.circuitBreakerReason = '';
    logger.info('[RISK MANAGER] Daily circuit breaker manually / session reset.');
  }

  /**
   * 1. Hard Risk Constraint — Daily Loss Circuit Breaker
   *
   * If realized + open floating loss for the day reaches 5% of starting equity:
   * 1. Close/flatten new-entry eligibility for the rest of the day.
   * 2. Log breaker event with timestamp, equity at trigger, and open positions count.
   * 3. Require manual or next-session reset — MUST NOT auto-resume same-day.
   */
  public static checkDailyCircuitBreaker(
    dayStartEquity: number,
    currentEquity: number,
    openFloatingPnl: number = 0,
    openPositionsCount: number = 0
  ): CircuitBreakerStatus {
    const todayStr = new Date().toISOString().substring(0, 10);

    // Same-day lockout enforcement
    if (this.circuitBreakerBreachedDate === todayStr) {
      const dailyPnlPct = ((currentEquity + openFloatingPnl - dayStartEquity) / dayStartEquity) * 100;
      return {
        breached: true,
        reason: this.circuitBreakerReason || `Same-day lockout active. Breached at ${this.lastBreakerTriggerTime}`,
        dailyPnlPct,
        currentEquity,
        dayStartEquity,
        triggeredAt: this.lastBreakerTriggerTime,
      };
    }

    const effectiveDayStart = dayStartEquity > 0 ? dayStartEquity : config.STARTING_BALANCE;

    // Realized PnL today from database + current equity drift + floating PnL
    const row = db.prepare(`
      SELECT SUM(pnl) as realizedToday
      FROM trades
      WHERE exit_time LIKE ? AND status = 'CLOSED'
    `).get(`${todayStr}%`) as { realizedToday: number | null };

    const realizedToday = row?.realizedToday || 0;
    // Correct total PnL today relative to day start equity
    const totalTodayPnL = (currentEquity > 0 && effectiveDayStart > 0)
      ? (currentEquity - effectiveDayStart)
      : (realizedToday + openFloatingPnl);
    const dailyPnlPct = (totalTodayPnL / effectiveDayStart) * 100;

    const maxLossAmount = effectiveDayStart * (config.RISK_DAILY_LOSS_LIMIT_PCT / 100);

    if (totalTodayPnL <= -maxLossAmount) {
      this.circuitBreakerBreachedDate = todayStr;
      this.lastBreakerTriggerTime = new Date().toISOString();
      this.lastBreakerEquity = currentEquity;
      this.lastBreakerOpenPositionsCount = openPositionsCount;
      this.circuitBreakerReason = `Daily loss limit of ${config.RISK_DAILY_LOSS_LIMIT_PCT}% breached. Total loss today: $${Math.abs(totalTodayPnL).toFixed(2)} (${dailyPnlPct.toFixed(2)}%).`;

      logger.error(
        `🚨 [DAILY CIRCUIT BREAKER BREACHED] Timestamp: ${this.lastBreakerTriggerTime} | ` +
        `Day Start Equity: $${effectiveDayStart.toFixed(2)} | Equity at Trigger: $${currentEquity.toFixed(2)} | ` +
        `Open Positions: ${openPositionsCount} | Daily Loss: $${Math.abs(totalTodayPnL).toFixed(2)} (${dailyPnlPct.toFixed(2)}%). ` +
        `New entries HALTED for the rest of the day. Manual or next-session reset required.`
      );

      RejectionLogger.log(
        'RiskManager.checkDailyCircuitBreaker',
        'DAILY_CIRCUIT_BREAKER',
        'GLOBAL',
        undefined,
        undefined,
        this.circuitBreakerReason
      );

      if (this.dailyLimitAlertedDate !== todayStr) {
        this.dailyLimitAlertedDate = todayStr;
        TelegramNotifier.sendMessage(
          `🚨 *DAILY CIRCUIT BREAKER BREACHED*\n` +
          `Equity at Trigger: $${currentEquity.toFixed(2)}\n` +
          `Daily Loss: -$${Math.abs(totalTodayPnL).toFixed(2)} (${dailyPnlPct.toFixed(2)}%)\n` +
          `New entries HALTED for today.`
        );
      }

      return {
        breached: true,
        reason: this.circuitBreakerReason,
        dailyPnlPct,
        currentEquity,
        dayStartEquity: effectiveDayStart,
        triggeredAt: this.lastBreakerTriggerTime,
      };
    }

    // Check Daily Profit Target Lock ($30–$40 target)
    const profitTargetUsd = config.RISK_DAILY_PROFIT_TARGET_USD;
    if (profitTargetUsd > 0 && totalTodayPnL >= profitTargetUsd) {
      this.circuitBreakerBreachedDate = todayStr;
      this.lastBreakerTriggerTime = new Date().toISOString();
      this.lastBreakerEquity = currentEquity;
      this.lastBreakerOpenPositionsCount = openPositionsCount;
      this.circuitBreakerReason = `🎯 Daily profit target of $${profitTargetUsd.toFixed(2)} REACHED! Total profit today: +$${totalTodayPnL.toFixed(2)}. Locked gains and halted new entries for today.`;

      logger.info(
        `🎯 [DAILY PROFIT TARGET REACHED] Timestamp: ${this.lastBreakerTriggerTime} | ` +
        `Day Start Equity: $${effectiveDayStart.toFixed(2)} | Current Equity: $${currentEquity.toFixed(2)} | ` +
        `Daily Profit: +$${totalTodayPnL.toFixed(2)} (Target: $${profitTargetUsd.toFixed(2)}). ` +
        `Locking gains — New entries HALTED for the rest of the day.`
      );

      if (this.dailyLimitAlertedDate !== todayStr) {
        this.dailyLimitAlertedDate = todayStr;
        TelegramNotifier.sendMessage(
          `🎉 *DAILY PROFIT TARGET REACHED!*\n` +
          `Daily Profit: +$${totalTodayPnL.toFixed(2)} (Target: $${profitTargetUsd.toFixed(2)})\n` +
          `Current Equity: $${currentEquity.toFixed(2)}\n` +
          `Trading HALTED for today to lock in gains.`
        );
      }

      return {
        breached: true,
        reason: this.circuitBreakerReason,
        dailyPnlPct,
        currentEquity,
        dayStartEquity: effectiveDayStart,
        triggeredAt: this.lastBreakerTriggerTime,
      };
    }

    return {
      breached: false,
      reason: 'Circuit breaker healthy',
      dailyPnlPct,
      currentEquity,
      dayStartEquity: effectiveDayStart,
    };
  }

  /**
   * 2. Confidence-Gated Adaptive Position Sizing
   *
   * Enforces Hard Risk Caps & Confidence Tiers:
   * - < 0.60: DISCARDED (no trade)
   * - 0.60 – 0.75: REDUCED (50–70% of per-trade cap, default 60% = 0.9% risk)
   * - 0.75 – 0.85: NORMAL (100% of 1.5% cap)
   * - 0.85+: STRETCH (up to 2.25% stretch cap), gated by cumulative open risk ceiling (6%)
   *   and circuit breaker status.
   *
   * Strictly decoupled from prior trade losses — NO martingale, NO revenge sizing.
   */
  public static calculatePositionSize(
    accountEquity: number,
    stopDistancePips: number,
    confidenceScore: number = 0.75,
    currentOpenRiskPct: number = 0,
    instrument: string = 'EUR/USD'
  ): SizingDecision {
    const timestamp = new Date().toISOString();
    const pipSize = SymbolNormalizer.getPipSize(instrument);
    const contractSize = SymbolNormalizer.getContractSize(instrument);
    const isGold = SymbolNormalizer.isGold(instrument);
    const isJpy = SymbolNormalizer.isJpy(instrument);

    // Use Dynamic Kelly Criterion for Base Risk Cap (kelly is returned as a percentage e.g. 1.5%)
    const kellyPct = calculateKellyRiskPct();
    // Micro-account override: hard cap at 1% for accounts under $200 to prevent catastrophic sizing
    const microAccountCap = accountEquity < 200 ? 1.0 : config.RISK_PER_TRADE_CAP_PCT;
    const perTradeCapPct = Math.min(kellyPct, microAccountCap, config.RISK_MAX_POSITION_SIZE_PCT);

    const effectiveCap = perTradeCapPct;
    
    // Per-pair confidence threshold resolution
    const normInst = CorrelationManager.normalizeInstrument(instrument);
    const pairOverrideThresh = config.PAIR_CONFIDENCE_THRESHOLDS[normInst] ?? config.PAIR_CONFIDENCE_THRESHOLDS[instrument];
    const minThreshold = pairOverrideThresh !== undefined ? pairOverrideThresh : config.RISK_CONFIDENCE_MIN_THRESHOLD;
    
    const normalTierThreshold = config.RISK_CONFIDENCE_TIER_NORMAL;
    const stretchTierThreshold = config.RISK_CONFIDENCE_TIER_STRETCH;

    let sizeTier: SizeTier = 'DISCARDED';
    let effectiveRiskPct = 0;

    // Check circuit breaker status first — if breaker is near or breached, stretch is prohibited
    const todayStr = timestamp.substring(0, 10);
    const isBreached = this.circuitBreakerBreachedDate === todayStr;

    if (isBreached || confidenceScore < minThreshold) {
      sizeTier = 'DISCARDED';
      effectiveRiskPct = 0;
    } else if (confidenceScore < normalTierThreshold) {
      // REDUCED tier (e.g., 60% of per-trade cap = 0.90%)
      sizeTier = 'REDUCED';
      effectiveRiskPct = effectiveCap * config.RISK_REDUCED_TIER_MULTIPLIER;
    } else if (confidenceScore < stretchTierThreshold) {
      // NORMAL tier (100% of per-trade cap = 1.50%)
      sizeTier = 'NORMAL';
      effectiveRiskPct = effectiveCap;
    } else {
      // STRETCH tier (up to stretch cap 2.25%)
      sizeTier = 'STRETCH';
      const targetStretchRisk = config.RISK_STRETCH_CAP_PCT;

      // Cumulative Open Risk Ceiling Check (e.g., max 6% open risk across all trades)
      const cumulativeCeiling = config.RISK_CUMULATIVE_OPEN_RISK_CEILING_PCT;
      const availableCapacity = Math.max(0, cumulativeCeiling - currentOpenRiskPct);

      effectiveRiskPct = Math.min(targetStretchRisk, availableCapacity);

      if (effectiveRiskPct < effectiveCap) {
        effectiveRiskPct = Math.min(effectiveCap, availableCapacity);
        if (effectiveRiskPct <= 0) {
          sizeTier = 'DISCARDED';
          effectiveRiskPct = 0;
        } else {
          sizeTier = 'REDUCED';
        }
      }
    }

    // Upper limit on final risk
    const hardCap = Math.max(config.RISK_MAX_POSITION_SIZE_PCT, config.RISK_STRETCH_CAP_PCT);
    effectiveRiskPct = Math.min(effectiveRiskPct, hardCap);

    if (sizeTier === 'DISCARDED' || effectiveRiskPct <= 0) {
      const decision: SizingDecision = {
        lots: 0,
        riskUsdAtStop: 0,
        sizeTier: 'DISCARDED',
        effectiveRiskPct: 0,
        confidenceScore,
        instrument,
        accountEquity,
        currentOpenRiskPct,
        timestamp,
      };
      this.lastDecision = decision;
      logger.info(
        `[SIZING DISCARDED] ${instrument} | Conf: ${(confidenceScore * 100).toFixed(1)}% (< ${(minThreshold * 100).toFixed(1)}%) | ` +
        `Open Risk: ${currentOpenRiskPct.toFixed(2)}% | Breached: ${isBreached}`
      );
      return decision;
    }

    // Calculate dollar risk at stop Loss
    const riskUsdAtStop = accountEquity * (effectiveRiskPct / 100);

    // Convert stop pips to price distance
    const slPips = stopDistancePips > 0 ? stopDistancePips : (isGold ? 20 : 25);
    const slPriceDistance = slPips * pipSize;
    const slDistanceUsd = isJpy ? (slPriceDistance / 150.0) : slPriceDistance;

    // Convert risk USD to position lots
    const rawUnits = riskUsdAtStop / slDistanceUsd;
    const rawVolume = rawUnits / contractSize;

    // Floor to 0.01 lot increments
    let volume = Math.floor(rawVolume * 100) / 100;

    // Minimum broker lot size
    if (volume < 0.01) {
      volume = 0.01;
    }

    // Upper bound cap on lots
    const maxLots = 10.0;
    if (volume > maxLots) {
      volume = maxLots;
    }

    const decision: SizingDecision = {
      lots: volume,
      riskUsdAtStop: Math.round(riskUsdAtStop * 100) / 100,
      sizeTier,
      effectiveRiskPct: Math.round(effectiveRiskPct * 1000) / 1000,
      confidenceScore,
      instrument,
      accountEquity,
      currentOpenRiskPct,
      timestamp,
    };

    this.lastDecision = decision;

    logger.info(
      `[SIZING DECISION] ${timestamp} | ${instrument} | Tier: ${sizeTier} | Conf: ${(confidenceScore * 100).toFixed(1)}% | ` +
      `Equity: $${accountEquity.toFixed(2)} | Effective Risk: ${effectiveRiskPct.toFixed(2)}% ($${decision.riskUsdAtStop.toFixed(2)}) | ` +
      `Lots: ${volume} | Open Risk Used: ${currentOpenRiskPct.toFixed(2)}%`
    );

    return decision;
  }

  /**
   * 3. Audit Log for Trade Outcomes (Explicit Non-Goal Enforcement)
   *
   * MUST NOT feed back into position sizing logic — explicitly prevents revenge / martingale sizing.
   */
  public static recordTradeOutcome(trade: TradeOutcome): void {
    logger.info(
      `[TRADE OUTCOME RECORDED - AUDIT ONLY] ID: ${trade.id} | Instrument: ${trade.instrument} | ` +
      `PnL: $${trade.pnl.toFixed(2)} | Exit Time: ${trade.exitTime} | Strategy: ${trade.strategy || 'N/A'}`
    );
    // Explicitly NO feedback loop to position sizing
  }

  /**
   * 4. Dashboard Read-Only Status Hook
   */
  public static getDashboardStatus(accountEquity: number = config.STARTING_BALANCE, openFloatingPnl: number = 0) {
    const todayStr = new Date().toISOString().substring(0, 10);
    const cbStatus = this.checkDailyCircuitBreaker(config.STARTING_BALANCE, accountEquity, openFloatingPnl);

    return {
      dailyPnlPct: Math.round(cbStatus.dailyPnlPct * 100) / 100,
      circuitBreakerStatus: {
        breached: cbStatus.breached,
        reason: cbStatus.reason,
        triggeredAt: cbStatus.triggeredAt || null,
      },
      currentOpenRiskPct: this.lastDecision ? this.lastDecision.currentOpenRiskPct : 0,
      lastSizingDecision: this.lastDecision,
      softTargetUsd: config.RISK_DAILY_SOFT_TARGET_USD,
      softTargetMet: cbStatus.dailyPnlPct >= (config.RISK_DAILY_SOFT_TARGET_USD / config.STARTING_BALANCE) * 100,
    };
  }

  // -------------------------------------------------------------------------
  // Existing Helper Validation Methods (Backward Compatibility)
  // -------------------------------------------------------------------------

  public static checkDailyMaxTrades(maxTrades: number = 5, instrument: string = 'UNKNOWN'): boolean {
    const todayStr = new Date().toISOString().substring(0, 10);
    const row = db.prepare(`
      SELECT COUNT(*) as todayCount
      FROM trades
      WHERE entry_time LIKE ?
    `).get(`${todayStr}%`) as { todayCount: number };

    if (row && row.todayCount >= maxTrades) {
      logger.warn(`[DAILY TRADES CAP] Today's trade limit (${row.todayCount}/${maxTrades}) reached. Rejecting signal for ${instrument}.`);
      RejectionLogger.log(
        'RiskManager.checkDailyMaxTrades',
        'DAILY_TRADES_LIMIT',
        instrument,
        undefined,
        undefined,
        `${row.todayCount}/${maxTrades} trades executed today`
      );
      return false;
    }
    return true;
  }

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

  public static checkCorrelationCap(
    openPositions: { instrument: string; side: 'LONG' | 'SHORT' | 'BUY' | 'SELL' }[],
    candidateInstrument: string,
    candidateSide: 'LONG' | 'SHORT' | 'BUY' | 'SELL'
  ): boolean {
    const result = CorrelationManager.checkCorrelationCap(
      openPositions,
      candidateInstrument,
      candidateSide,
      config.MAX_PORTFOLIO_CORRELATION_SUM
    );

    if (result.exceeded) {
      logger.warn(`[CORRELATION RISK] ${result.reason}`);
      RejectionLogger.log(
        'RiskManager.checkCorrelationCap',
        'CORRELATION_CAP_EXCEEDED',
        candidateInstrument,
        candidateSide,
        undefined,
        result.reason
      );
      return false;
    }
    return true;
  }

  public static checkDailyLossLimit(currentBalance: number, currentUnrealized: number, instrument: string = 'UNKNOWN'): boolean {
    const cb = this.checkDailyCircuitBreaker(config.STARTING_BALANCE, currentBalance, currentUnrealized);
    return !cb.breached;
  }

  public static checkTradeDirection(action: 'BUY' | 'SELL', instrument: string): boolean {
    if (config.TRADE_DIRECTION === 'BOTH') return true;
    if (config.TRADE_DIRECTION === 'BUY_ONLY' && action === 'SELL') return false;
    if (config.TRADE_DIRECTION === 'SELL_ONLY' && action === 'BUY') return false;
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
    const effectiveBalance = Math.max(config.STARTING_BALANCE, currentBalance || 0);
    const limitAmount = effectiveBalance * (config.RISK_WEEKLY_LOSS_LIMIT_PCT / 100);
    const totalWeekPnL = realizedWeek + currentUnrealized;

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
      return false;
    }
    return true;
  }

  private static dailyTargetAlertDate: string | null = null;

  public static checkDailyProfitLock(
    balance: number,
    currentUnrealized: number,
    instrument: string,
    confidence?: number,
    strategy?: string
  ): boolean {
    const today = new Date().toISOString().split('T')[0];
    const row = db.prepare(`
      SELECT SUM(pnl) as realizedToday
      FROM trades
      WHERE status = 'CLOSED' AND exit_time LIKE ?
    `).get(`${today}%`) as { realizedToday: number | null };

    const realizedToday = row?.realizedToday || 0;
    const totalTodayPnL = realizedToday + currentUnrealized;
    const targetAmountUsd = config.RISK_DAILY_PROFIT_TARGET_USD || config.RISK_DAILY_SOFT_TARGET_USD || 10.0;

    if (targetAmountUsd > 0 && totalTodayPnL >= targetAmountUsd) {
      logger.info(
        `🎯 [COMPULSORY DAILY TARGET ACHIEVED] Today's total PnL is +$${totalTodayPnL.toFixed(2)} ` +
        `(Compulsory Target: $${targetAmountUsd.toFixed(2)}). Compulsory Profit Lock activated.`
      );

      if (this.dailyTargetAlertDate !== today) {
        this.dailyTargetAlertDate = today;
        TelegramNotifier.sendMessage(
          `🎯 *COMPULSORY DAILY PROFIT TARGET ACHIEVED!*\n` +
          `• Realized Profit Today: +$${realizedToday.toFixed(2)}\n` +
          `• Total Daily PnL: +$${totalTodayPnL.toFixed(2)}\n` +
          `• Target: $${targetAmountUsd.toFixed(2)} (100% COMPLETE)\n\n` +
          `🔒 *Compulsory Profit Lock Active:* Trading is secured for today to protect your daily earnings!`
        );
      }

      RejectionLogger.log(
        'RiskManager.checkDailyProfitLock',
        'DAILY_PROFIT_LOCK' as any,
        instrument,
        undefined,
        strategy,
        `Compulsory Daily Target ($${targetAmountUsd.toFixed(2)}) reached! Today PnL: +$${totalTodayPnL.toFixed(2)}`
      );

      return false; // COMPULSORY PROFIT LOCK: Disallow new entries to protect today's completed target
    }

    return true;
  }

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
    if (!allLosses) return { inCooldown: false, consecutiveLosses: 0, cooldownUntil: null };

    const lastLossTime = new Date(recentTrades[0].exit_time);
    const cooldownUntil = new Date(lastLossTime.getTime() + cooldownHours * 60 * 60 * 1000);
    const now = new Date();

    return {
      inCooldown: now < cooldownUntil,
      consecutiveLosses: maxLosses,
      cooldownUntil: now < cooldownUntil ? cooldownUntil : null,
    };
  }

  public static checkSpreadSanity(instrument: string, currentSpreadPips: number, medianSpreadPips: number): boolean {
    if (medianSpreadPips > 0 && currentSpreadPips > medianSpreadPips * 2.0) {
      logger.warn(`[SPREAD GUARD] Rejected ${instrument}: Current spread ${currentSpreadPips.toFixed(1)} pips > 2x median ${medianSpreadPips.toFixed(1)} pips.`);
      RejectionLogger.log(
        'RiskManager.checkSpreadSanity',
        'WIDE_SPREAD',
        instrument,
        undefined,
        undefined,
        `Current spread ${currentSpreadPips.toFixed(1)} pips > 2x median ${medianSpreadPips.toFixed(1)} pips`
      );
      return false;
    }
    return true;
  }

  public static checkConsecutiveLossCooldown(instrument: string, strategy?: string): boolean {
    const status = this.getConsecutiveLossStatus();
    if (!status.inCooldown) return true;
    RejectionLogger.log(
      'RiskManager.checkConsecutiveLossCooldown',
      'CONSECUTIVE_LOSS_COOLDOWN',
      instrument,
      undefined,
      strategy,
      `${status.consecutiveLosses} consecutive losses, cooldown until ${status.cooldownUntil?.toISOString()}`
    );
    return false;
  }

  public static checkTotalOpenRisk(currentBalance: number, openPositions: PositionInfo[], newPositionRiskPct: number = 0, instrument: string = 'UNKNOWN'): boolean {
    let totalRiskDollars = 0;
    for (const pos of openPositions) {
      if (pos.stopLoss) {
        totalRiskDollars += pos.units * Math.abs(pos.entryPrice - pos.stopLoss);
      }
    }
    const maxRiskDollars = currentBalance * (config.RISK_CUMULATIVE_OPEN_RISK_CEILING_PCT / 100);
    const riskWithNew = totalRiskDollars + (currentBalance * newPositionRiskPct / 100);
    if (riskWithNew > maxRiskDollars) {
      RejectionLogger.log(
        'RiskManager.checkTotalOpenRisk',
        'TOTAL_OPEN_RISK',
        instrument,
        undefined,
        undefined,
        `Current risk: $${totalRiskDollars.toFixed(2)}, Max: $${maxRiskDollars.toFixed(2)}`
      );
      return false;
    }
    return true;
  }

  public static checkCorrelationExposure(instrument: string, openPositions: PositionInfo[], action: 'BUY' | 'SELL'): boolean {
    const formattedPositions = openPositions.map(p => ({
      instrument: p.instrument,
      side: p.action as 'LONG' | 'SHORT' | 'BUY' | 'SELL'
    }));
    return this.checkCorrelationCap(formattedPositions, instrument, action);
  }

  /**
   * Phase 5.1: Volatility Circuit Breaker
   * Pauses new entries on a pair when its ATR spikes above the 95th percentile.
   */
  public static checkVolatilityCircuitBreaker(
    instrument: string,
    candles: Candle[],
    thresholdPctile: number = 0.95
  ): boolean {
    if (!candles || candles.length < 42) return true;
    const pct = computeAtrPercentile(candles, 14, 100);
    if (pct !== undefined && pct >= thresholdPctile) {
      logger.warn(`[VOLATILITY BREAKER] ${instrument} ATR percentile ${(pct * 100).toFixed(1)}% exceeds threshold ${(thresholdPctile * 100).toFixed(0)}%. Entry paused.`);
      RejectionLogger.log(
        'RiskManager.checkVolatilityCircuitBreaker',
        'VOLATILITY_CIRCUIT_BREAKER' as any,
        instrument,
        undefined,
        undefined,
        `ATR percentile ${(pct * 100).toFixed(1)}% >= ${(thresholdPctile * 100).toFixed(0)}%`
      );
      return false;
    }
    return true;
  }

  /**
   * Phase 5.2: Equity-Curve Throttle
   * When current equity is below its own 20-trade moving average, cut base risk in half (0.5x).
   */
  public static getEquityCurveThrottleMultiplier(currentEquity: number): number {
    try {
      const rows = db.prepare(`
        SELECT equity FROM equity_snapshots
        ORDER BY time DESC LIMIT 20
      `).all() as Array<{ equity: number }>;

      if (rows && rows.length >= 10) {
        const avgEquity = rows.reduce((acc, r) => acc + r.equity, 0) / rows.length;
        if (currentEquity < avgEquity) {
          logger.info(`[EQUITY CURVE THROTTLE] Current equity $${currentEquity.toFixed(2)} below 20-trade MA $${avgEquity.toFixed(2)}. Cutting base risk in half (0.5x).`);
          return 0.5;
        }
      }
    } catch (err) {
      // Non-fatal fallback
    }
    return 1.0;
  }

  /**
   * Phase 5.3: Per-Strategy Quarantine
   * If a strategy's rolling 30-trade profit factor drops below 1.0, auto-disable it,
   * notify via Telegram and dashboard, and require manual re-enable.
   */
  public static checkStrategyQuarantine(strategy: string, instrument: string = 'GLOBAL'): boolean {
    if (this.quarantinedStrategies.has(strategy)) {
      logger.warn(`[STRATEGY QUARANTINE] Signal rejected: Strategy '${strategy}' is quarantined (rolling PF < 1.0). Manual re-enable required.`);
      RejectionLogger.log(
        'RiskManager.checkStrategyQuarantine',
        'STRATEGY_QUARANTINED' as any,
        instrument,
        undefined,
        strategy,
        'Strategy quarantined due to rolling profit factor < 1.0'
      );
      return false;
    }

    try {
      const trades = db.prepare(`
        SELECT pnl FROM trades
        WHERE strategy = ? AND status = 'CLOSED'
        ORDER BY exit_time DESC LIMIT 30
      `).all(strategy) as Array<{ pnl: number }>;

      if (trades && trades.length >= 15) {
        const grossProfit = trades.filter(t => t.pnl > 0).reduce((acc, t) => acc + t.pnl, 0);
        const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((acc, t) => acc + t.pnl, 0));
        const rollingPf = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99 : 0);

        if (rollingPf < 1.0) {
          this.quarantinedStrategies.add(strategy);
          logger.error(`🚨 [STRATEGY QUARANTINED] Strategy '${strategy}' auto-disabled. Rolling 30-trade Profit Factor: ${rollingPf.toFixed(2)} < 1.0.`);
          TelegramNotifier.sendMessage(
            `🚨 *STRATEGY AUTO-QUARANTINED*\n` +
            `Strategy: \`${strategy}\`\n` +
            `Rolling 30-Trade PF: *${rollingPf.toFixed(2)}* (< 1.0)\n` +
            `New entries for this strategy HALTED until manual review.`
          );
          return false;
        }
      }
    } catch (err) {
      // Non-fatal
    }
    return true;
  }

  public static reEnableStrategy(strategy: string): void {
    this.quarantinedStrategies.delete(strategy);
    logger.info(`[STRATEGY RE-ENABLED] Strategy '${strategy}' removed from quarantine.`);
  }

  public static getQuarantinedStrategies(): string[] {
    return Array.from(this.quarantinedStrategies);
  }

  /**
   * Phase 5.4: Correlation-Aware Group Exposure
   * Caps net same-direction exposure per correlation group.
   */
  public static checkCorrelationGroupExposure(instrument: string, openPositions: PositionInfo[], action: 'BUY' | 'SELL'): boolean {
    const formatted = openPositions.map(p => ({
      instrument: p.instrument,
      side: p.action as 'LONG' | 'SHORT' | 'BUY' | 'SELL'
    }));
    const result = CorrelationManager.checkGroupNetExposure(formatted, instrument, action, 2);
    if (!result.allowed) {
      logger.warn(`[CORRELATION GROUP GUARD] ${result.reason}`);
      RejectionLogger.log(
        'RiskManager.checkCorrelationGroupExposure',
        'CORRELATION_LIMIT' as any,
        instrument,
        action,
        undefined,
        result.reason
      );
      return false;
    }
    return true;
  }

  /**
   * Phase 5.5: Margin & Leverage Guard for MT5 path
   * Maximum effective leverage and minimum free-margin % checks before any live order.
   */
  public static checkMarginLeverageGuard(
    accountBalance: number,
    openEquity: number,
    proposedUnits: number,
    instrument: string,
    currentPrice: number,
    openPositions: PositionInfo[]
  ): boolean {
    const maxLeverage = config.RISK_MAX_LEVERAGE || 20;
    const effectiveEquity = Math.max(10, openEquity || accountBalance);

    let currentNotional = 0;
    for (const pos of openPositions) {
      currentNotional += pos.units * pos.entryPrice;
    }

    const proposedNotional = proposedUnits * currentPrice;
    const totalNotional = currentNotional + proposedNotional;
    const effectiveLeverage = totalNotional / effectiveEquity;

    if (effectiveLeverage > maxLeverage) {
      logger.warn(`[MARGIN GUARD] Effective leverage ${effectiveLeverage.toFixed(1)}:1 exceeds cap of ${maxLeverage}:1 for ${instrument}.`);
      RejectionLogger.log(
        'RiskManager.checkMarginLeverageGuard',
        'LEVERAGE_EXCEEDED' as any,
        instrument,
        undefined,
        undefined,
        `Effective leverage ${effectiveLeverage.toFixed(1)}:1 > max ${maxLeverage}:1`
      );
      return false;
    }

    const requiredMargin = totalNotional / maxLeverage;
    const freeMargin = effectiveEquity - requiredMargin;
    const freeMarginPct = (freeMargin / effectiveEquity) * 100;

    if (freeMarginPct < 30) {
      logger.warn(`[MARGIN GUARD] Free margin ${freeMarginPct.toFixed(1)}% below required buffer (30%) for ${instrument}.`);
      RejectionLogger.log(
        'RiskManager.checkMarginLeverageGuard',
        'MARGIN_GUARD' as any,
        instrument,
        undefined,
        undefined,
        `Free margin buffer ${freeMarginPct.toFixed(1)}% < 30%`
      );
      return false;
    }

    return true;
  }

  public static getEffectiveRiskPct(balance: number, mode: string = 'conservative'): number {
    let basePct = config.RISK_BASE_PCT_PER_TRADE;
    if (balance < 150) {
      return mode === 'aggressive' ? Math.min(basePct, 1.0) : Math.min(basePct, 0.5);
    }
    if (balance < 500) {
      return Math.min(basePct, 1.0);
    }
    return basePct;
  }

  public static calculateSizedOrder(
    instrument: string,
    stopLossPips: number,
    currentBalance: number,
    confidence?: number,
    atrPercentile?: number,
    currentPrice?: number
  ): SizedOrder {
    const pipSize = SymbolNormalizer.getPipSize(instrument);
    const contractSize = SymbolNormalizer.getContractSize(instrument);
    const slPips = stopLossPips > 0 ? stopLossPips : 25;
    const isJpy = SymbolNormalizer.isJpy(instrument);
    const slPriceDistance = slPips * pipSize;
    const slDistanceUsd = isJpy ? (slPriceDistance / (currentPrice || 150.0)) : slPriceDistance;

    // Small-account rule: cancel instead of rounding up when min lot exceeds budget
    const minLotUnits = 0.01 * contractSize;
    const minLotDollarRisk = minLotUnits * slDistanceUsd;
    const maxAllowedRiskUsd = currentBalance * (config.RISK_MAX_POSITION_SIZE_PCT / 100);

    if (currentBalance < 200 && minLotDollarRisk > maxAllowedRiskUsd * 1.05) {
      logger.info(
        `[SIZING CANCELLED - MIN LOT EXCEEDS BUDGET] ${instrument} | Balance: $${currentBalance.toFixed(2)} | ` +
        `Max Risk: $${maxAllowedRiskUsd.toFixed(2)} | Min 0.01 Lot Risk: $${minLotDollarRisk.toFixed(2)} | SL: ${slPips} pips`
      );
      return { units: 0, riskPctUsed: 0, amountToRisk: 0 };
    }

    const decision = this.calculatePositionSize(
      currentBalance,
      stopLossPips,
      confidence ?? 0.75,
      0,
      instrument
    );

    if (decision.lots === 0 || decision.sizeTier === 'DISCARDED') {
      return { units: 0, riskPctUsed: 0, amountToRisk: 0 };
    }

    // Phase 5.2: Apply Equity-Curve Throttle multiplier
    const throttleMultiplier = this.getEquityCurveThrottleMultiplier(currentBalance);
    const units = Math.max(minLotUnits, decision.lots * contractSize * throttleMultiplier);
    const riskPctUsed = decision.effectiveRiskPct * throttleMultiplier;

    return {
      units,
      riskPctUsed,
      amountToRisk: decision.riskUsdAtStop * throttleMultiplier,
    };
  }
}
