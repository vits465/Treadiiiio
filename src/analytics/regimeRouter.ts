import { Candle } from '../data/priceFeed';
import { computeAtrPercentile } from '../risk/volatility';
import { logger } from '../logger';

export type MarketRegimeType = 'TRENDING' | 'RANGING' | 'HIGH_VOLATILITY';

export interface RegimeAnalysis {
  regime: MarketRegimeType;
  adx: number;
  atrPercentile: number;
  reason: string;
}

export class RegimeRouter {
  /**
   * Calculates Average Directional Index (ADX) over N periods (default 14).
   */
  public static calculateADX(candles: Candle[], period: number = 14): number {
    if (candles.length < period * 2) return 20; // Default fallback to neutral

    let trs: number[] = [];
    let plusDM: number[] = [];
    let minusDM: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevHigh = candles[i - 1].high;
      const prevLow = candles[i - 1].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      const upMove = high - prevHigh;
      const downMove = prevLow - low;

      const pdm = (upMove > downMove && upMove > 0) ? upMove : 0;
      const mdm = (downMove > upMove && downMove > 0) ? downMove : 0;

      trs.push(tr);
      plusDM.push(pdm);
      minusDM.push(mdm);
    }

    if (trs.length < period) return 20;

    // Smoothed averages over period
    let trSmooth = trs.slice(0, period).reduce((a, b) => a + b, 0);
    let pdmSmooth = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
    let mdmSmooth = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

    let dxList: number[] = [];

    for (let i = period; i < trs.length; i++) {
      trSmooth = trSmooth - (trSmooth / period) + trs[i];
      pdmSmooth = pdmSmooth - (pdmSmooth / period) + plusDM[i];
      mdmSmooth = mdmSmooth - (mdmSmooth / period) + minusDM[i];

      const pDI = trSmooth > 0 ? (pdmSmooth / trSmooth) * 100 : 0;
      const mDI = trSmooth > 0 ? (mdmSmooth / trSmooth) * 100 : 0;
      const diSum = pDI + mDI;
      const dx = diSum > 0 ? (Math.abs(pDI - mDI) / diSum) * 100 : 0;
      dxList.push(dx);
    }

    if (dxList.length === 0) return 20;
    const adx = dxList.reduce((a, b) => a + b, 0) / dxList.length;
    return Math.round(adx * 100) / 100;
  }

  /**
   * Evaluates the market regime for a pair based on candles.
   */
  public static evaluateRegime(candles: Candle[], instrument: string): RegimeAnalysis {
    const adx = this.calculateADX(candles, 14);
    const atrPct = computeAtrPercentile(candles, 14, 60) ?? 0.5;

    let regime: MarketRegimeType = 'RANGING';
    let reason = '';

    if (atrPct >= 0.90 || adx > 45) {
      regime = 'HIGH_VOLATILITY';
      reason = `Extreme volatility/trend exhaustion detected (ADX: ${adx}, ATR Pctile: ${(atrPct * 100).toFixed(0)}%). New entries suppressed.`;
    } else if (adx >= 25 && atrPct < 0.85) {
      regime = 'TRENDING';
      reason = `Strong trend confirmed (ADX: ${adx} >= 25, ATR Pctile: ${(atrPct * 100).toFixed(0)}%). Routing to trend strategies.`;
    } else {
      regime = 'RANGING';
      reason = `Sideways ranging market (ADX: ${adx} < 25, ATR Pctile: ${(atrPct * 100).toFixed(0)}%). Routing to mean-reversion.`;
    }

    logger.debug(`[REGIME ROUTER] ${instrument} -> ${regime} (${reason})`);
    return { regime, adx, atrPercentile: atrPct, reason };
  }

  /**
   * Determines whether a given strategy is permitted to run under the current regime.
   */
  public static isStrategyAllowedForRegime(strategyName: string, regime: MarketRegimeType): boolean {
    if (regime === 'HIGH_VOLATILITY') {
      // Exits are allowed, but new entries are blocked in extreme volatility
      return false;
    }

    const trendStrategies = ['ma_crossover', 'power_breakout', 'ml_signal', 'asian_killzone'];
    const rangeStrategies = ['rsi_reversion', 'bollinger_bands', 'grid_overlay', 'volatility_arbitrage', 'smc_liquidity'];

    if (regime === 'TRENDING') {
      return trendStrategies.includes(strategyName) || strategyName === 'scalping_1m';
    }

    if (regime === 'RANGING') {
      return rangeStrategies.includes(strategyName) || strategyName === 'scalping_1m';
    }

    return true;
  }
}
