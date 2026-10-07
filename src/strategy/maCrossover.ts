import { Strategy, Candle, MarketContext, Signal, StrategyEvaluationResult } from './strategy.interface';
import { config } from '../config';
import { computeAtr } from '../risk/volatility';
import { SymbolNormalizer } from '../utils/symbolNormalizer';

export class MaCrossoverStrategy implements Strategy {
  public readonly name = 'ma_crossover';
  private fastPeriod: number;
  private slowPeriod: number;

  constructor(fastPeriod = 9, slowPeriod = 21) {
    this.fastPeriod = fastPeriod;
    this.slowPeriod = slowPeriod;
  }

  public evaluate(candles: Candle[], context: MarketContext): StrategyEvaluationResult {
    const requiredLength = Math.max(this.fastPeriod, this.slowPeriod) + 1;

    if (!candles || candles.length < requiredLength) {
      return { signal: 'NONE', confidence: 0, reason: 'Insufficient candle history for MA cross', sl: 0, tp: 0 };
    }

    const candle = candles[candles.length - 1];
    const instrument = candle.instrument || (context.currentQuote ? context.currentQuote.instrument : 'EUR/USD');
    const pipSize = SymbolNormalizer.getPipSize(instrument);
    const isGold = SymbolNormalizer.isGold(instrument);

    const fastPrev = this.getSmaValue(candles, candles.length - 2, this.fastPeriod);
    const fastCurr = this.getSmaValue(candles, candles.length - 1, this.fastPeriod);
    const slowPrev = this.getSmaValue(candles, candles.length - 2, this.slowPeriod);
    const slowCurr = this.getSmaValue(candles, candles.length - 1, this.slowPeriod);

    if (fastPrev === null || fastCurr === null || slowPrev === null || slowCurr === null) {
      return { signal: 'NONE', confidence: 0, reason: 'Failed to calculate MA values', sl: 0, tp: 0 };
    }

    // Dynamic ATR-based Stop Loss & Take Profit (1:2 RRR)
    const atrs = computeAtr(candles, 14);
    const currentAtr = atrs[atrs.length - 1];
    const defaultAtr = isGold ? 2.5 : 0.0015;
    const effectiveAtr = currentAtr && currentAtr > 0 ? currentAtr : defaultAtr;

    const stopLossPips = Math.max(isGold ? 15 : 10, Math.round((effectiveAtr * 1.0) / pipSize));
    const takeProfitPips = Math.max(isGold ? 30 : 20, Math.round((effectiveAtr * 2.0) / pipSize));

    // Multi-Timeframe Trend Filter
    let dailyTrend: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
    if (context.macroCandles && context.macroCandles.length >= 20) {
      const dailySma = this.getSmaValue(context.macroCandles, context.macroCandles.length - 1, 20);
      if (dailySma) {
        const dailyClose = context.macroCandles[context.macroCandles.length - 1].close;
        dailyTrend = dailyClose > dailySma ? 'UP' : 'DOWN';
      }
    }

    // Crossover Up -> BUY
    const mtfBuyAllowed = !config.ENABLE_STRICT_MTF_GATE || dailyTrend !== 'DOWN';
    if (fastPrev <= slowPrev && fastCurr > slowCurr && mtfBuyAllowed) {
      if (context.activePosition?.action === 'SELL') {
        return { signal: 'CLOSE', confidence: 0.85, reason: 'Bullish MA cross against short position', sl: 0, tp: 0 };
      }
      if (!context.activePosition) {
        const confidence = dailyTrend === 'UP' ? 0.85 : 0.75;
        return {
          signal: 'BUY',
          confidence,
          reason: `MA Crossover Bullish Cross (${this.fastPeriod}/${this.slowPeriod}) with Daily ${dailyTrend} Trend (1:2 RRR)`,
          sl: stopLossPips,
          tp: takeProfitPips,
          stopLossPips,
          takeProfitPips,
          atr: effectiveAtr,
        };
      }
    }

    // Crossover Down -> SELL
    const mtfSellAllowed = !config.ENABLE_STRICT_MTF_GATE || dailyTrend !== 'UP';
    if (fastPrev >= slowPrev && fastCurr < slowCurr && mtfSellAllowed) {
      if (context.activePosition?.action === 'BUY') {
        return { signal: 'CLOSE', confidence: 0.85, reason: 'Bearish MA cross against long position', sl: 0, tp: 0 };
      }
      if (!context.activePosition) {
        const confidence = dailyTrend === 'DOWN' ? 0.85 : 0.75;
        return {
          signal: 'SELL',
          confidence,
          reason: `MA Crossover Bearish Cross (${this.fastPeriod}/${this.slowPeriod}) with Daily ${dailyTrend} Trend (1:2 RRR)`,
          sl: stopLossPips,
          tp: takeProfitPips,
          stopLossPips,
          takeProfitPips,
          atr: effectiveAtr,
        };
      }
    }

    return { signal: 'NONE', confidence: 0, reason: 'No crossover detected', sl: 0, tp: 0 };
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
}
