import { Strategy, Candle, MarketContext, Signal, StrategyEvaluationResult } from './strategy.interface';
import { config } from '../config';
import { computeAtr } from '../risk/volatility';
import { SymbolNormalizer } from '../utils/symbolNormalizer';

export class RsiMeanReversionStrategy implements Strategy {
  public readonly name = 'rsi_reversion';
  private period: number;
  private overbought: number;
  private oversold: number;

  constructor(period = 14, overbought = 68, oversold = 32) {
    this.period = period;
    this.overbought = overbought;
    this.oversold = oversold;
  }

  private calculateRSIList(candles: Candle[]): number[] {
    if (candles.length <= this.period) return [];

    const rsiValues: number[] = new Array(candles.length).fill(50);

    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 1; i <= this.period; i++) {
      const change = candles[i].close - candles[i - 1].close;
      if (change > 0) avgGain += change;
      else avgLoss += -change;
    }

    avgGain /= this.period;
    avgLoss /= this.period;
    rsiValues[this.period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    for (let i = this.period + 1; i < candles.length; i++) {
      const change = candles[i].close - candles[i - 1].close;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? -change : 0;

      avgGain = (avgGain * (this.period - 1) + gain) / this.period;
      avgLoss = (avgLoss * (this.period - 1) + loss) / this.period;

      rsiValues[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }

    return rsiValues;
  }

  public evaluate(candles: Candle[], context: MarketContext): StrategyEvaluationResult {
    if (!candles || candles.length < this.period * 2) {
      return { signal: 'NONE', confidence: 0, reason: 'Insufficient history for RSI', sl: 0, tp: 0 };
    }

    const rsiValues = this.calculateRSIList(candles);
    if (rsiValues.length < 2) {
      return { signal: 'NONE', confidence: 0, reason: 'Unable to calculate RSI', sl: 0, tp: 0 };
    }

    const rsiPrev = rsiValues[rsiValues.length - 2];
    const rsiCurr = rsiValues[rsiValues.length - 1];
    const candle = candles[candles.length - 1];
    const instrument = candle.instrument || (context.currentQuote ? context.currentQuote.instrument : 'EUR/USD');
    const pipSize = SymbolNormalizer.getPipSize(instrument);
    const isGold = SymbolNormalizer.isGold(instrument);

    // Dynamic ATR TP & SL (2.0x ATR TP, 1.0x ATR SL -> 1:2 RRR)
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

    // Optional: Close position when RSI reaches the opposite extreme
    if (context.activePosition) {
      if (context.activePosition.action === 'BUY' && rsiCurr >= this.overbought) {
        return { signal: 'CLOSE', confidence: 0.85, reason: `RSI reached overbought extreme (${rsiCurr.toFixed(1)})`, sl: 0, tp: 0 };
      }
      if (context.activePosition.action === 'SELL' && rsiCurr <= this.oversold) {
        return { signal: 'CLOSE', confidence: 0.85, reason: `RSI reached oversold extreme (${rsiCurr.toFixed(1)})`, sl: 0, tp: 0 };
      }
    }

    // RSI exits oversold -> BUY (dip buying)
    const mtfBuyAllowed = !config.ENABLE_STRICT_MTF_GATE || dailyTrend !== 'DOWN';
    if (rsiPrev <= this.oversold && rsiCurr > this.oversold && mtfBuyAllowed) {
      if (context.activePosition?.action === 'SELL') {
        return { signal: 'CLOSE', confidence: 0.85, reason: 'RSI reversed oversold against short', sl: 0, tp: 0 };
      }
      if (!context.activePosition) {
        const isDeepOversold = rsiPrev <= 25;
        const confidence = isDeepOversold ? 0.85 : 0.75;
        return {
          signal: 'BUY',
          confidence,
          reason: `RSI Oversold Dip Buy (RSI: ${rsiCurr.toFixed(1)}, Trend: ${dailyTrend}, 1:2 RRR)`,
          sl: stopLossPips,
          tp: takeProfitPips,
          stopLossPips,
          takeProfitPips,
          atr: effectiveAtr,
        };
      }
    }

    // RSI exits overbought -> SELL (rally fading)
    const mtfSellAllowed = !config.ENABLE_STRICT_MTF_GATE || dailyTrend !== 'UP';
    if (rsiPrev >= this.overbought && rsiCurr < this.overbought && mtfSellAllowed) {
      if (context.activePosition?.action === 'BUY') {
        return { signal: 'CLOSE', confidence: 0.85, reason: 'RSI reversed overbought against long', sl: 0, tp: 0 };
      }
      if (!context.activePosition) {
        const isDeepOverbought = rsiPrev >= 75;
        const confidence = isDeepOverbought ? 0.85 : 0.75;
        return {
          signal: 'SELL',
          confidence,
          reason: `RSI Overbought Rally Sell (RSI: ${rsiCurr.toFixed(1)}, Trend: ${dailyTrend}, 1:2 RRR)`,
          sl: stopLossPips,
          tp: takeProfitPips,
          stopLossPips,
          takeProfitPips,
          atr: effectiveAtr,
        };
      }
    }

    return { signal: 'NONE', confidence: 0, reason: `RSI neutral (${rsiCurr.toFixed(1)})`, sl: 0, tp: 0 };
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
