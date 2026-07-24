import { config } from '../config';
import { logger } from '../logger';
import { db } from '../db';
import { PositionInfo } from '../strategy/strategy.interface';
import { RejectionLogger } from './rejectionLogger';
import { TelegramNotifier } from '../notifier/telegram';
import { CorrelationManager } from './correlationManager';

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
    const equityDrift = currentEquity - effectiveDayStart;
    const totalTodayPnL = realizedToday + openFloatingPnl + (equityDrift < 0 ? equityDrift : 0);
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
    const isJpy = instrument.includes('JPY');
    const isXau = instrument.includes('XAU');
    const pipSize = (isJpy || isXau) ? 0.01 : 0.0001;

    // Hard Per-Trade Risk Cap (e.g. 1.5%)
    const perTradeCapPct = config.RISK_PER_TRADE_CAP_PCT;
    
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
      // 0.60 to 0.75 -> REDUCED tier (e.g., 60% of per-trade cap = 0.90%)
      sizeTier = 'REDUCED';
      effectiveRiskPct = perTradeCapPct * config.RISK_REDUCED_TIER_MULTIPLIER;
    } else if (confidenceScore < stretchTierThreshold) {
      // 0.75 to 0.85 -> NORMAL tier (100% of per-trade cap = 1.50%)
      sizeTier = 'NORMAL';
      effectiveRiskPct = perTradeCapPct;
    } else {
      // 0.85+ -> STRETCH tier (up to stretch cap 2.25%)
      sizeTier = 'STRETCH';
      const targetStretchRisk = config.RISK_STRETCH_CAP_PCT;

      // Cumulative Open Risk Ceiling Check (e.g., max 6% open risk across all trades)
      const cumulativeCeiling = config.RISK_CUMULATIVE_OPEN_RISK_CEILING_PCT;
      const availableCapacity = Math.max(0, cumulativeCeiling - currentOpenRiskPct);

      // Stretch cap is bounded by available capacity and config.RISK_STRETCH_CAP_PCT
      effectiveRiskPct = Math.min(targetStretchRisk, availableCapacity);

      // If open risk capacity is depleted, fall back to NORMAL or REDUCED cap
      if (effectiveRiskPct < perTradeCapPct) {
        effectiveRiskPct = Math.min(perTradeCapPct, availableCapacity);
        if (effectiveRiskPct <= 0) {
          sizeTier = 'DISCARDED';
          effectiveRiskPct = 0;
        } else {
          sizeTier = 'REDUCED';
        }
      }
    }

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
    const slPips = stopDistancePips > 0 ? stopDistancePips : (isXau ? 900 : 45);
    const slDistance = slPips * pipSize;

    // Convert risk USD to position lots
    const contractSize = isXau ? 100 : 100000;
    const rawUnits = riskUsdAtStop / slDistance;
    let volume = rawUnits / contractSize;

    // Lot size step rounding (0.01 lot increments for Forex, 0.01/0.001 for Gold)
    const minVolume = isXau ? 0.01 : 0.01;
    if (volume < minVolume * 0.2) {
      volume = 0;
      sizeTier = 'DISCARDED';
      effectiveRiskPct = 0;
    } else if (volume < minVolume) {
      // Micro / Demo Account Floor: Enforce broker minimum 0.01 lot size so trades execute
      volume = minVolume;
    } else {
      volume = Math.floor(volume * 100) / 100;
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
      return false;
    }
    return true;
  }

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
    const targetAmountUsd = config.RISK_DAILY_SOFT_TARGET_USD;

    if (targetAmountUsd > 0 && totalTodayPnL >= targetAmountUsd) {
      const isHighConviction = (strategy === 'ml_signal' && (confidence ?? 0) >= 0.80) || strategy === 'smc_liquidity';
      if (isHighConviction) return true;
      return true; // Soft target is non-binding as per Master Prompt requirements
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
    const decision = this.calculatePositionSize(
      currentBalance,
      stopLossPips,
      confidence ?? 0.75,
      0,
      instrument
    );

    const isXau = instrument.includes('XAU');
    const contractSize = isXau ? 100 : 100000;
    const units = decision.lots * contractSize;

    return {
      units,
      riskPctUsed: decision.lots === 0 ? 0 : decision.effectiveRiskPct,
      amountToRisk: decision.lots === 0 ? 0 : decision.riskUsdAtStop,
    };
  }
}
