import { BacktestTrade } from './metrics';
import { logger } from '../logger';

export interface MonteCarloResult {
  iterations: number;
  worstCaseDrawdown95Pct: number;
  medianDrawdownPct: number;
  isRobust: boolean; // True if 95th percentile DD <= 20%
}

export class MonteCarloTester {
  /**
   * Resamples trade sequence 1,000 times (randomizing order, 5% random drops, noise)
   * to compute 95th percentile worst-case max drawdown.
   */
  public static test(
    trades: BacktestTrade[],
    startingBalance: number = 10000,
    iterations: number = 1000
  ): MonteCarloResult {
    if (trades.length < 5) {
      return { iterations, worstCaseDrawdown95Pct: 0.0, medianDrawdownPct: 0.0, isRobust: true };
    }

    const drawdownResults: number[] = [];

    for (let iter = 0; iter < iterations; iter++) {
      // 1. Shuffle trade sequence & randomly drop 5% of trades
      const shuffled = [...trades].sort(() => Math.random() - 0.5);
      const sampled = shuffled.filter(() => Math.random() > 0.05);

      let balance = startingBalance;
      let peak = startingBalance;
      let maxDd = 0;

      for (const t of sampled) {
        // Add ±20% noise to PnL outcome
        const noiseFactor = 0.8 + Math.random() * 0.4;
        const noisyPnl = t.pnl * noiseFactor;

        balance += noisyPnl;
        if (balance > peak) peak = balance;

        const ddUsd = peak - balance;
        const ddPct = peak > 0 ? (ddUsd / peak) * 100 : 0;
        if (ddPct > maxDd) maxDd = ddPct;
      }

      drawdownResults.push(maxDd);
    }

    drawdownResults.sort((a, b) => a - b);
    const idx95 = Math.floor(iterations * 0.95);
    const idx50 = Math.floor(iterations * 0.50);

    const worstCase95Pct = Math.round(drawdownResults[idx95] * 100) / 100;
    const medianDd = Math.round(drawdownResults[idx50] * 100) / 100;
    const isRobust = worstCase95Pct <= 20.0;

    logger.info(`[MONTE CARLO] 95th Percentile Max Drawdown: ${worstCase95Pct}% (Median: ${medianDd}%, Robust: ${isRobust})`);

    return {
      iterations,
      worstCaseDrawdown95Pct: worstCase95Pct,
      medianDrawdownPct: medianDd,
      isRobust,
    };
  }
}
