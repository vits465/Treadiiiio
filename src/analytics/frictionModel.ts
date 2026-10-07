import { SymbolNormalizer } from '../utils/symbolNormalizer';

export interface ExecutionFriction {
  spreadPips: number;
  slippagePips: number;
  commissionUsd: number;
  swapUsd: number;
  effectiveEntryPrice: number;
  effectiveExitPrice: number;
}

export class FrictionModel {
  /**
   * Baseline spread in pips per instrument during normal London/NY hours.
   */
  public static readonly BASELINE_SPREAD_PIPS: Record<string, number> = {
    'EUR/USD': 1.2,
    'GBP/USD': 1.8,
    'USD/JPY': 1.5,
    'USD/CHF': 1.6,
    'AUD/USD': 1.6,
    'XAU/USD': 2.5, // 2.5 pips = $0.25 on gold
  };

  /**
   * Nightly financing swap rates in pips per standard lot per day.
   * Wednesday night incurs 3x swap for weekend rollover.
   */
  public static readonly SWAP_RATES_PIPS: Record<string, { long: number; short: number }> = {
    'EUR/USD': { long: -0.8, short: 0.1 },
    'GBP/USD': { long: -0.9, short: 0.0 },
    'USD/JPY': { long: 1.2, short: -2.0 },
    'USD/CHF': { long: 0.6, short: -1.4 },
    'AUD/USD': { long: -0.5, short: -0.2 },
    'XAU/USD': { long: -2.0, short: 0.5 },
  };

  /**
   * Calculates realistic dynamic spread for a given instrument and timestamp.
   * Widens during Asian session (illiquid) and daily bank rollover (21:55 - 22:05 UTC).
   */
  public static getDynamicSpreadPips(instrument: string, timestamp: Date | string, isNewsWindow: boolean = false): number {
    const norm = SymbolNormalizer.toSlash(instrument);
    const baseSpread = this.BASELINE_SPREAD_PIPS[norm] || 1.8;
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    const hour = date.getUTCHours();
    const minute = date.getUTCMinutes();

    let multiplier = 1.0;

    // 1. Daily Bank Rollover (21:55 - 22:15 UTC) — spreads widen dramatically
    if ((hour === 21 && minute >= 55) || (hour === 22 && minute <= 15)) {
      multiplier = 3.5;
    }
    // 2. Asian Session (22:16 - 06:59 UTC) — wider spreads due to lower liquidity
    else if (hour >= 22 || hour < 7) {
      multiplier = 1.8;
    }
    // 3. London / NY overlap (13:00 - 16:00 UTC) — tightest spreads
    else if (hour >= 13 && hour <= 16) {
      multiplier = 0.95;
    }
    // 4. Normal European / US trading hours
    else {
      multiplier = 1.05;
    }

    // 5. News Event Blackout / Release Window
    if (isNewsWindow) {
      multiplier *= 2.5;
    }

    return parseFloat((baseSpread * multiplier).toFixed(2));
  }

  /**
   * Computes realistic slippage in pips.
   * Market orders slip more during fast markets, news, or stop-loss executions.
   */
  public static getSlippagePips(isStopLossFill: boolean = false, isNewsWindow: boolean = false): number {
    let slippage = 0.2 + Math.random() * 0.4; // 0.2 to 0.6 pips base

    if (isStopLossFill) {
      // Adverse gap slippage on stop-loss executions
      slippage += 0.5 + Math.random() * 0.8;
    }

    if (isNewsWindow) {
      slippage += 1.5 + Math.random() * 2.0;
    }

    return parseFloat(slippage.toFixed(2));
  }

  /**
   * Computes broker commission in USD based on traded volume (units or lots).
   * Default: $3.50 per lot per side ($7.00 round turn).
   */
  public static getCommissionUsd(units: number, instrument: string, commissionPerLotSide: number = 3.5): number {
    const contractSize = SymbolNormalizer.getContractSize(instrument);
    const lots = units / contractSize;
    // Round-turn commission for the complete trade
    return parseFloat((lots * commissionPerLotSide * 2).toFixed(2));
  }

  /**
   * Calculates swap / rollover cost in USD for positions held overnight.
   */
  public static calculateSwapCostUsd(
    instrument: string,
    action: 'BUY' | 'SELL',
    units: number,
    entryTime: Date | string,
    exitTime: Date | string,
    currentRate: number = 1.0
  ): number {
    const entry = typeof entryTime === 'string' ? new Date(entryTime) : entryTime;
    const exit = typeof exitTime === 'string' ? new Date(exitTime) : exitTime;

    const diffHours = (exit.getTime() - entry.getTime()) / (1000 * 60 * 60);
    if (diffHours < 4) return 0.0; // Intraday trades incur zero swap

    const norm = SymbolNormalizer.toSlash(instrument);
    const rates = this.SWAP_RATES_PIPS[norm] || { long: -0.5, short: -0.5 };
    const pipRate = action === 'BUY' ? rates.long : rates.short;
    const contractSize = SymbolNormalizer.getContractSize(instrument);
    const lots = units / contractSize;
    const pipValueUsd = SymbolNormalizer.calculatePipValueUsd(instrument, units, currentRate);

    // Count rollover 22:00 UTC boundaries crossed
    let rolloversCrossed = 0;
    let wednesdaysCrossed = 0;

    const cur = new Date(entry);
    while (cur < exit) {
      if (cur.getUTCHours() === 22) {
        rolloversCrossed++;
        if (cur.getUTCDay() === 3) {
          wednesdaysCrossed++; // 3x swap on Wednesday rollover
        }
      }
      cur.setTime(cur.getTime() + 3600000);
    }

    if (rolloversCrossed === 0) return 0.0;

    const totalRolloverDays = rolloversCrossed + (wednesdaysCrossed * 2);
    const swapUsd = totalRolloverDays * pipRate * pipValueUsd;
    return parseFloat(swapUsd.toFixed(2));
  }

  /**
   * Applies entry and exit frictions to calculate exact fill prices and net PnL.
   */
  public static calculateExecutionFriction(params: {
    instrument: string;
    action: 'BUY' | 'SELL';
    entryPrice: number;
    exitPrice: number;
    units: number;
    entryTime: Date | string;
    exitTime: Date | string;
    isStopLossFill?: boolean;
    isNewsWindow?: boolean;
  }): ExecutionFriction {
    const { instrument, action, entryPrice, exitPrice, units, entryTime, exitTime, isStopLossFill, isNewsWindow } = params;
    const pipSize = SymbolNormalizer.getPipSize(instrument);

    const spreadPips = this.getDynamicSpreadPips(instrument, entryTime, isNewsWindow);
    const slippagePips = this.getSlippagePips(isStopLossFill, isNewsWindow);
    const commissionUsd = this.getCommissionUsd(units, instrument);
    const swapUsd = this.calculateSwapCostUsd(instrument, action, units, entryTime, exitTime, exitPrice);

    let effectiveEntryPrice = entryPrice;
    let effectiveExitPrice = exitPrice;

    // BUY enters at ask (price + half spread + slippage), closes at bid (exit - half spread - slippage)
    if (action === 'BUY') {
      effectiveEntryPrice += (spreadPips * 0.5 + slippagePips) * pipSize;
      effectiveExitPrice -= (spreadPips * 0.5 + (isStopLossFill ? slippagePips : 0)) * pipSize;
    } else {
      // SELL enters at bid (price - half spread - slippage), closes at ask (exit + half spread + slippage)
      effectiveEntryPrice -= (spreadPips * 0.5 + slippagePips) * pipSize;
      effectiveExitPrice += (spreadPips * 0.5 + (isStopLossFill ? slippagePips : 0)) * pipSize;
    }

    return {
      spreadPips,
      slippagePips,
      commissionUsd,
      swapUsd,
      effectiveEntryPrice: parseFloat(effectiveEntryPrice.toFixed(SymbolNormalizer.getPriceDecimals(instrument))),
      effectiveExitPrice: parseFloat(effectiveExitPrice.toFixed(SymbolNormalizer.getPriceDecimals(instrument)))
    };
  }
}
