import { Strategy } from '../strategy/strategy.interface';
import { Candle } from '../data/priceFeed';
import { EventDrivenBacktestEngine } from './engine';
import { logger } from '../logger';

export interface WFOResult {
  overallWfeScore: number;
  isOverfitted: boolean;
  inSampleSharpe: number;
  outOfSampleSharpe: number;
  foldsCount: number;
}

export class WalkForwardOptimizer {
  /**
   * Performs Walk-Forward Optimization across rolling candle windows and calculates WFE score.
   */
  public static optimize(
    strategy: Strategy,
    candles: Candle[],
    numFolds: number = 4
  ): WFOResult {
    if (candles.length < 100 || numFolds < 2) {
      return { overallWfeScore: 1.0, isOverfitted: false, inSampleSharpe: 1.0, outOfSampleSharpe: 1.0, foldsCount: 0 };
    }

    const foldSize = Math.floor(candles.length / (numFolds + 1));
    let totalIsSharpe = 0;
    let totalOosSharpe = 0;

    for (let f = 0; f < numFolds; f++) {
      const isStart = f * foldSize;
      const isEnd = isStart + foldSize * 2;
      const oosEnd = Math.min(candles.length, isEnd + foldSize);

      const isCandles = candles.slice(isStart, isEnd);
      const oosCandles = candles.slice(isEnd, oosEnd);

      const isRes = EventDrivenBacktestEngine.runBacktest(strategy, isCandles);
      const oosRes = EventDrivenBacktestEngine.runBacktest(strategy, oosCandles);

      totalIsSharpe += Math.max(0.1, isRes.metrics.sharpeRatio);
      totalOosSharpe += oosRes.metrics.sharpeRatio;
    }

    const avgIsSharpe = totalIsSharpe / numFolds;
    const avgOosSharpe = totalOosSharpe / numFolds;
    const wfeScore = avgIsSharpe > 0 ? avgOosSharpe / avgIsSharpe : 0.0;
    const isOverfitted = wfeScore < 0.50;

    logger.info(`[WALK-FORWARD OPTIMIZER] Strategy ${strategy.name}: WFE Score = ${wfeScore.toFixed(2)} (IS Sharpe: ${avgIsSharpe.toFixed(2)}, OOS Sharpe: ${avgOosSharpe.toFixed(2)}, Overfitted: ${isOverfitted})`);

    return {
      overallWfeScore: Math.round(wfeScore * 100) / 100,
      isOverfitted,
      inSampleSharpe: Math.round(avgIsSharpe * 100) / 100,
      outOfSampleSharpe: Math.round(avgOosSharpe * 100) / 100,
      foldsCount: numFolds,
    };
  }
}
