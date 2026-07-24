import { Strategy, Signal, MarketContext, Candle } from './strategy.interface';
import { logger } from '../logger';

export class GridOverlayStrategy implements Strategy {
  public name = 'grid_overlay';

  public onCandle(candle: Candle, context: MarketContext): Signal | null {
    const candles = context.historicalCandles;
    if (candles.length < 20) return null;

    const recentCandles = candles.slice(-20);
    const closes = recentCandles.map(c => c.close);
    const highestHigh = Math.max(...recentCandles.map(c => c.high));
    const lowestLow = Math.min(...recentCandles.map(c => c.low));
    const range = highestHigh - lowestLow;

    if (range === 0) return null;

    const currentPrice = candle.close;

    // Check for tight sideways range (Bollinger Squeeze proxy: range is < 1.2% of price)
    const isSidewaysRange = (range / currentPrice) < 0.012;

    if (!isSidewaysRange) {
      return null;
    }

    // Grid Thresholds: Buy near 20-period support (bottom 25% of range), Sell near resistance (top 25% of range)
    const supportThreshold = lowestLow + range * 0.25;
    const resistanceThreshold = highestHigh - range * 0.25;

    const pipMultiplier = candle.instrument.includes('JPY') ? 100 : (candle.instrument.includes('XAU') ? 10 : 10000);
    const stopLossPips = Math.round((range * 0.4) * pipMultiplier);
    const takeProfitPips = Math.round((range * 0.5) * pipMultiplier);

    if (currentPrice <= supportThreshold) {
      logger.info(`[GRID OVERLAY] Price near range support ($${currentPrice.toFixed(5)} <= $${supportThreshold.toFixed(5)}). Triggering Grid BUY.`);
      return {
        strategy: this.name,
        instrument: candle.instrument,
        action: 'BUY',
        confidence: 0.72,
        stopLossPips: Math.max(10, stopLossPips),
        takeProfitPips: Math.max(15, takeProfitPips)
      };
    }

    if (currentPrice >= resistanceThreshold) {
      logger.info(`[GRID OVERLAY] Price near range resistance ($${currentPrice.toFixed(5)} >= $${resistanceThreshold.toFixed(5)}). Triggering Grid SELL.`);
      return {
        strategy: this.name,
        instrument: candle.instrument,
        action: 'SELL',
        confidence: 0.72,
        stopLossPips: Math.max(10, stopLossPips),
        takeProfitPips: Math.max(15, takeProfitPips)
      };
    }

    return null;
  }
}
