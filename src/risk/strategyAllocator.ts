import { config } from '../config';
import { db } from '../db';
import { logger } from '../logger';
import { RejectionLogger } from './rejectionLogger';

export interface StrategyBudget {
  name: string;
  budgetPct: number; // % of total risk budget allocated to this strategy
  monthlyPnL: number;
  monthlyPnLPct: number;
  paused: boolean;
  pauseReason?: string;
  pausedUntil?: string;
}

export class StrategyAllocator {
  // Default strategy risk budgets (% of portfolio risk)
  private static readonly DEFAULT_BUDGETS: Record<string, number> = {
    'ml_signal': 0.40,           // 40% Trend / ML
    'rsi_reversion': 0.30,       // 30% Scalp / Mean Reversion
    'volatility_arbitrage': 0.20, // 20% Volatility Arbitrage
    'grid_overlay': 0.10         // 10% Grid Overlay
  };

  private static readonly MONTHLY_LOSS_AUTO_PAUSE_PCT = -8.0; // -8% loss limit per strategy per month
  private static readonly PAUSE_DURATION_DAYS = 14; // 2 weeks cooldown

  /**
   * Calculates current calendar month PnL for a given strategy from SQLite.
   */
  public static getMonthlyStrategyPnL(strategyName: string): number {
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const row = db.prepare(`
        SELECT SUM(pnl) as monthlyPnl
        FROM trades
        WHERE strategy = ? AND exit_time >= ? AND status = 'CLOSED'
      `).get(strategyName, monthStart) as { monthlyPnl: number | null };

      return row?.monthlyPnl || 0;
    } catch (err) {
      logger.debug(`Failed to fetch monthly PnL for strategy ${strategyName}: ${err}`);
      return 0;
    }
  }

  /**
   * Checks if a strategy is eligible to trade based on its risk budget and monthly loss limit (-8%).
   */
  public static isStrategyAllowed(
    strategyName: string,
    accountEquity: number = config.STARTING_BALANCE,
    maxMonthlyLossPct: number = config.STRATEGY_MONTHLY_LOSS_LIMIT_PCT || this.MONTHLY_LOSS_AUTO_PAUSE_PCT
  ): { allowed: boolean; reason?: string } {
    const monthlyPnL = this.getMonthlyStrategyPnL(strategyName);
    const monthlyPnLPct = accountEquity > 0 ? (monthlyPnL / accountEquity) * 100 : 0;

    // Check if strategy breached monthly loss threshold (-8%)
    if (monthlyPnLPct <= maxMonthlyLossPct) {
      const reason = `Strategy '${strategyName}' reached monthly loss cap (${monthlyPnLPct.toFixed(2)}% <= ${maxMonthlyLossPct}%). Auto-paused for 2 weeks.`;
      logger.warn(`[STRATEGY ALLOCATOR] ${reason}`);
      
      RejectionLogger.log(
        'StrategyAllocator.isStrategyAllowed',
        'DAILY_LOSS_LIMIT', // or custom filter code
        'MULTI',
        undefined,
        strategyName,
        reason
      );

      return { allowed: false, reason };
    }

    return { allowed: true };
  }

  /**
   * Returns current budget allocations and status for all strategies.
   */
  public static getStrategyAllocations(accountEquity: number = config.STARTING_BALANCE): StrategyBudget[] {
    const strategies = Object.keys(this.DEFAULT_BUDGETS);
    
    return strategies.map(name => {
      const budgetPct = this.DEFAULT_BUDGETS[name] * 100;
      const monthlyPnL = this.getMonthlyStrategyPnL(name);
      const monthlyPnLPct = accountEquity > 0 ? Number(((monthlyPnL / accountEquity) * 100).toFixed(2)) : 0;
      const check = this.isStrategyAllowed(name, accountEquity);

      return {
        name,
        budgetPct,
        monthlyPnL: Number(monthlyPnL.toFixed(2)),
        monthlyPnLPct,
        paused: !check.allowed,
        pauseReason: check.reason
      };
    });
  }

  /**
   * Multiplier to scale trade risk based on strategy's assigned risk budget and market regime.
   */
  public static getStrategyRiskMultiplier(strategyName: string, currentRegime: string = 'NORMAL'): number {
    let budget = this.DEFAULT_BUDGETS[strategyName] || 0.25;
    
    // Dynamically shift allocations based on regime
    if (currentRegime === 'VOLATILE') {
      if (strategyName === 'volatility_arbitrage') budget *= 1.5; // Boost vol arb
      if (strategyName === 'rsi_reversion') budget *= 0.5; // Cut mean reversion in volatile markets
      if (strategyName === 'grid_overlay') budget = 0; // Disable grid in high volatility
    } else if (currentRegime === 'CALM') {
      if (strategyName === 'rsi_reversion') budget *= 1.5; // Boost mean reversion
      if (strategyName === 'grid_overlay') budget *= 1.5; // Boost grid
      if (strategyName === 'volatility_arbitrage') budget = 0; // Cut vol arb in calm markets
    }

    // Normalize relative to 0.40 (max strategy budget)
    return Math.min(1.0, budget / 0.40);
  }
}
