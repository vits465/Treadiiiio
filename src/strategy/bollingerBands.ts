import { Strategy, Candle, MarketContext, Signal, StrategyEvaluationResult } from './strategy.interface';
import { config } from '../config';
import { computeAtr } from '../risk/volatility';
import { SymbolNormalizer } from '../utils/symbolNormalizer';
import { RegimeRouter } from '../analytics/regimeRouter';
import { logger } from '../logger';

/**
 * BollingerBandsStrategy — Scalp Mean Reversion with Trend Alignment & Volatility Filters
 *
 * Upgraded institutional rules:
 * - Enforces MTF trend alignment (when strict MTF gate enabled)
 * - Requires price rejection back INSIDE the band (no catching falling knives)
 * - ADX cap: avoids fading runaway explosive trends (ADX > 32)
 * - Dynamic 1:2.0 Risk-to-Reward Ratio from ATR
 */
export class BollingerBandsStrategy implements Strategy {
  public readonly name = 'bollinger_bands';
  private period: number;
  private stdDevMultiplier: number;

  constructor(period = 20, stdDevMultiplier = 2.0) {
    this.period = period;
    this.stdDevMultiplier = stdDevMultiplier;
  }

  private calculateBands(candles: Candle[], endIndex: number) {
    if (endIndex < this.period - 1) return null;

    let sum = 0;
    for (let i = 0; i < this.period; i++) {
      sum += candles[endIndex - i].close;
    }
    const sma = sum / this.period;

    let sumSqDiff = 0;
    for (let i = 0; i < this.period; i++) {
      const diff = candles[endIndex - i].close - sma;
      sumSqDiff += diff * diff;
    }
    const stdDev = Math.sqrt(sumSqDiff / this.period);

    return {
      middle: sma,
      upper: sma + this.stdDevMultiplier * stdDev,
      lower: sma - this.stdDevMultiplier * stdDev,
      bandwidth: (2 * this.stdDevMultiplier * stdDev) / sma,
    };
  }

  public evaluate(candles: Candle[], context: MarketContext): StrategyEvaluationResult {
    if (!candles || candles.length < this.period + 15) {
      return { signal: 'NONE', confidence: 0, reason: 'Insufficient candle history for Bollinger Bands', sl: 0, tp: 0 };
    }

    const prevBands = this.calculateBands(candles, candles.length - 2);
    const currBands = this.calculateBands(candles, candles.length - 1);

    if (!prevBands || !currBands) {
      return { signal: 'NONE', confidence: 0, reason: 'Unable to calculate bands', sl: 0, tp: 0 };
    }

    const prevCandle = candles[candles.length - 2];
    const currCandle = candles[candles.length - 1];
    const prevClose = prevCandle.close;
    const currClose = currCandle.close;
    const instrument = currCandle.instrument || (context.currentQuote ? context.currentQuote.instrument : 'EUR/USD');
    const pipSize = SymbolNormalizer.getPipSize(instrument);
    const isGold = SymbolNormalizer.isGold(instrument);

    // 1. ADX Trend Filter: Avoid mean-reverting runaway parabolic trends
    const adx = RegimeRouter.calculateADX(candles, 14);
    if (adx > 32) {
      return { signal: 'NONE', confidence: 0, reason: `ADX ${adx.toFixed(1)} exceeds 32 (runaway trend)`, sl: 0, tp: 0 };
    }

    // 2. Multi-Timeframe Trend Filter
    let dailyTrend: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
    if (context.macroCandles && context.macroCandles.length >= 20) {
      const dailySma = this.getSmaValue(context.macroCandles, context.macroCandles.length - 1, 20);
      if (dailySma) {
        const dailyClose = context.macroCandles[context.macroCandles.length - 1].close;
        dailyTrend = dailyClose > dailySma ? 'UP' : 'DOWN';
      }
    }

    // 3. Dynamic ATR TP & SL (1:2.0 RRR)
    const atrs = computeAtr(candles, 14);
    const currentAtr = atrs[atrs.length - 1] || (isGold ? 2.5 : 0.0010);
    const stopLossPips = Math.max(isGold ? 15 : 10, Math.round((currentAtr * 1.0) / pipSize));
    const takeProfitPips = Math.max(isGold ? 30 : 20, Math.round((currentAtr * 2.0) / pipSize));

    // 4. Fast 7-period RSI for oversold/overbought check
    const rsi = this.calculateRSI(candles.slice(-15).map(c => c.close), 7);

    // Exit signal when price crosses the middle band (SMA)
    if (context.activePosition) {
      const position = context.activePosition;
      if (position.action === 'BUY' && prevClose < prevBands.middle && currClose >= currBands.middle) {
        return { signal: 'CLOSE', confidence: 0.85, reason: 'Price crossed middle band (TP exit)', sl: 0, tp: 0 };
      }
      if (position.action === 'SELL' && prevClose > prevBands.middle && currClose <= currBands.middle) {
        return { signal: 'CLOSE', confidence: 0.85, reason: 'Price crossed middle band (TP exit)', sl: 0, tp: 0 };
      }
    }

    // BUY SIGNAL: Price breached lower band and REJECTS back above it with bullish candle
    const lowerBandBreach = prevCandle.low < prevBands.lower || prevClose < prevBands.lower;
    const bullishBandRejection = currClose > currBands.lower && currClose > currCandle.open;
    const rsiOversoldBounce = rsi <= 40;

    const mtfBuyAllowed = !config.ENABLE_STRICT_MTF_GATE || dailyTrend !== 'DOWN';
    if (lowerBandBreach && bullishBandRejection && rsiOversoldBounce && mtfBuyAllowed) {
      if (context.activePosition?.action === 'SELL') {
        return { signal: 'CLOSE', confidence: 0.85, reason: 'Lower band rebound against short', sl: 0, tp: 0 };
      }
      if (!context.activePosition) {
        const confidence = dailyTrend === 'UP' ? 0.85 : 0.75;
        logger.info(`[BOLLINGER SCALP] Validated BUY on ${instrument} @ ${currClose.toFixed(2)} (RSI: ${rsi.toFixed(1)}, SL: ${stopLossPips}p, TP: ${takeProfitPips}p)`);
        return {
          signal: 'BUY',
          confidence,
          reason: `Bollinger Lower Band Rebound BUY (RSI: ${rsi.toFixed(1)}, 1:2 RRR)`,
          sl: stopLossPips,
          tp: takeProfitPips,
          stopLossPips,
          takeProfitPips,
          atr: currentAtr,
        };
      }
    }

    // SELL SIGNAL: Price breached upper band and REJECTS back below it with bearish candle
    const upperBandBreach = prevCandle.high > prevBands.upper || prevClose > prevBands.upper;
    const bearishBandRejection = currClose < currBands.upper && currClose < currCandle.open;
    const rsiOverboughtRejection = rsi >= 60;

    const mtfSellAllowed = !config.ENABLE_STRICT_MTF_GATE || dailyTrend !== 'UP';
    if (upperBandBreach && bearishBandRejection && rsiOverboughtRejection && mtfSellAllowed) {
      if (context.activePosition?.action === 'BUY') {
        return { signal: 'CLOSE', confidence: 0.85, reason: 'Upper band rejection against long', sl: 0, tp: 0 };
      }
      if (!context.activePosition) {
        const confidence = dailyTrend === 'DOWN' ? 0.85 : 0.75;
        logger.info(`[BOLLINGER SCALP] Validated SELL on ${instrument} @ ${currClose.toFixed(2)} (RSI: ${rsi.toFixed(1)}, SL: ${stopLossPips}p, TP: ${takeProfitPips}p)`);
        return {
          signal: 'SELL',
          confidence,
          reason: `Bollinger Upper Band Rejection SELL (RSI: ${rsi.toFixed(1)}, 1:2 RRR)`,
          sl: stopLossPips,
          tp: takeProfitPips,
          stopLossPips,
          takeProfitPips,
          atr: currentAtr,
        };
      }
    }

    return { signal: 'NONE', confidence: 0, reason: 'Price within bands', sl: 0, tp: 0 };
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
      atr: result.atr,
    };
  }

  private getSmaValue(candles: Candle[], endIndex: number, period: number): number | null {
    if (endIndex < period - 1) return null;
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += candles[endIndex - i].close;
    }
    return sum / period;
  }

  private calculateRSI(closes: number[], period: number = 7): number {
    if (closes.length <= period) return 50;
    let sumGain = 0;
    let sumLoss = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[closes.length - i] - closes[closes.length - i - 1];
      if (diff > 0) sumGain += diff;
      else sumLoss += Math.abs(diff);
    }
    return sumLoss === 0 ? 100 : 100 - (100 / (1 + (sumGain / sumLoss)));
  }
}
