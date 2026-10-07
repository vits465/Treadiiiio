import { Strategy, Signal, MarketContext, Candle, StrategyEvaluationResult } from './strategy.interface';
import { SymbolNormalizer } from '../utils/symbolNormalizer';
import { logger } from '../logger';

export class GridOverlayStrategy implements Strategy {
  public name = 'grid_overlay';

  public evaluate(candles: Candle[], context: MarketContext): StrategyEvaluationResult {
    if (!candles || candles.length < 20) {
      return { signal: 'NONE', confidence: 0, reason: 'Insufficient candle history for Grid Overlay', sl: 0, tp: 0 };
    }

    const candle = candles[candles.length - 1];
    const recentCandles = candles.slice(-20);
    const highestHigh = Math.max(...recentCandles.map(c => c.high));
    const lowestLow = Math.min(...recentCandles.map(c => c.low));
    const range = highestHigh - lowestLow;

    if (range === 0) {
      return { signal: 'NONE', confidence: 0, reason: 'Zero range detected', sl: 0, tp: 0 };
    }

    const currentPrice = candle.close;

    // Check for tight sideways range (Bollinger Squeeze proxy: range is < 1.2% of price)
    const isSidewaysRange = (range / currentPrice) < 0.012;
    if (!isSidewaysRange) {
      return { signal: 'NONE', confidence: 0, reason: `Market not in tight sideways range (${((range / currentPrice) * 100).toFixed(2)}% >= 1.2%)`, sl: 0, tp: 0 };
    }

    // Grid Thresholds: Buy near 20-period support (bottom 25% of range), Sell near resistance (top 25% of range)
    const supportThreshold = lowestLow + range * 0.25;
    const resistanceThreshold = highestHigh - range * 0.25;

    const instrument = candle.instrument || (context.currentQuote ? context.currentQuote.instrument : 'EUR/USD');
    const pipSize = SymbolNormalizer.getPipSize(instrument);
    const isGold = SymbolNormalizer.isGold(instrument);

    const stopLossPips = Math.max(isGold ? 15 : 10, Math.round((range * 0.3) / pipSize));
    const takeProfitPips = Math.max(isGold ? 30 : 20, Math.round((range * 0.6) / pipSize));

    if (currentPrice <= supportThreshold) {
      logger.info(`[GRID OVERLAY] Price near range support ($${currentPrice.toFixed(5)} <= $${supportThreshold.toFixed(5)}). Triggering Grid BUY.`);
      return {
        signal: 'BUY',
        confidence: 0.78,
        reason: `Price near 20-period range support ($${currentPrice.toFixed(4)} <= $${supportThreshold.toFixed(4)})`,
        sl: stopLossPips,
        tp: takeProfitPips,
        stopLossPips,
        takeProfitPips,
      };
    }

    if (currentPrice >= resistanceThreshold) {
      logger.info(`[GRID OVERLAY] Price near range resistance ($${currentPrice.toFixed(5)} >= $${resistanceThreshold.toFixed(5)}). Triggering Grid SELL.`);
      return {
        signal: 'SELL',
        confidence: 0.72,
        reason: `Price near 20-period range resistance ($${currentPrice.toFixed(4)} >= $${resistanceThreshold.toFixed(4)})`,
        sl: Math.max(10, stopLossPips),
        tp: Math.max(15, takeProfitPips),
        stopLossPips: Math.max(10, stopLossPips),
        takeProfitPips: Math.max(15, takeProfitPips),
      };
    }

    return { signal: 'NONE', confidence: 0, reason: 'Price in middle of range', sl: 0, tp: 0 };
  }

  public onCandle(candle: Candle, context: MarketContext): Signal | null {
    const candles = context.historicalCandles && context.historicalCandles.length > 0
      ? context.historicalCandles
      : [candle];
    const result = this.evaluate(candles, context);

    if (result.signal === 'NONE') {
      return null;
    }

    return {
      strategy: this.name,
      instrument: candle.instrument,
      action: result.signal as 'BUY' | 'SELL' | 'CLOSE',
      confidence: result.confidence,
      reason: result.reason,
      stopLossPips: result.stopLossPips ?? result.sl,
      takeProfitPips: result.takeProfitPips ?? result.tp,
    };
  }
}
