import { Strategy, Candle, MarketContext, Signal } from './strategy.interface';
import { computeAtr } from '../risk/volatility';

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

    const rsiValues: number[] = new Array(candles.length).fill(50); // Default to middle ground

    let avgGain = 0;
    let avgLoss = 0;

    // First RSI calculation (standard SMA of gains and losses)
    for (let i = 1; i <= this.period; i++) {
      const change = candles[i].close - candles[i - 1].close;
      if (change > 0) {
        avgGain += change;
      } else {
        avgLoss += -change;
      }
    }

    avgGain /= this.period;
    avgLoss /= this.period;

    rsiValues[this.period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    // Smoothed RSI (Wilder's smoothing)
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

  public onCandle(candle: Candle, context: MarketContext): Signal | null {
    const candles = context.historicalCandles;
    if (candles.length < this.period * 2) {
      return null; // Let the indicators stabilize
    }

    const rsiValues = this.calculateRSIList(candles);
    if (rsiValues.length < 2) return null;

    const rsiPrev = rsiValues[rsiValues.length - 2];
    const rsiCurr = rsiValues[rsiValues.length - 1];
    const instrument = candle.instrument;
    const isXau = instrument.includes('XAU');
    const isJpy = instrument.includes('JPY');
    const pipSize = (isXau || isJpy) ? 0.01 : 0.0001;

    // Dynamic ATR TP & SL (2.0x ATR TP, 1.2x ATR SL)
    const atrs = computeAtr(candles, 14);
    const currentAtr = atrs[atrs.length - 1];
    const defaultAtr = isXau ? 8.0 : isJpy ? 0.35 : 0.0020;
    const effectiveAtr = currentAtr && currentAtr > 0 ? currentAtr : defaultAtr;

    const stopLossPips = Math.max(12, Math.round((effectiveAtr * 1.2) / pipSize));
    const takeProfitPips = Math.max(20, Math.round((effectiveAtr * 2.0) / pipSize));

    // Multi-Timeframe Trend Filter
    let dailyTrend: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
    if (context.macroCandles && context.macroCandles.length >= 20) {
      const dailySma = this.getSmaValue(context.macroCandles, context.macroCandles.length - 1, 20);
      if (dailySma) {
        const dailyClose = context.macroCandles[context.macroCandles.length - 1].close;
        dailyTrend = dailyClose > dailySma ? 'UP' : 'DOWN';
      }
    }

    // RSI exits oversold -> BUY (Mean Reversion)
    if (rsiPrev <= this.oversold && rsiCurr > this.oversold) {
      if (context.activePosition?.action === 'SELL') {
        return { action: 'CLOSE', instrument, strategy: this.name };
      }
      if (!context.activePosition) {
        const isDeepOversold = rsiPrev <= 25;
        const confidence = isDeepOversold ? 0.85 : 0.72;
        return { 
          action: 'BUY', 
          instrument, 
          strategy: this.name, 
          confidence,
          stopLossPips, 
          takeProfitPips 
        };
      }
    }

    // RSI exits overbought -> SELL (Market Reversal / Reversion)
    if (rsiPrev >= this.overbought && rsiCurr < this.overbought) {
      if (context.activePosition?.action === 'BUY') {
        return { action: 'CLOSE', instrument, strategy: this.name };
      }
      if (!context.activePosition) {
        const isDeepOverbought = rsiPrev >= 75;
        const confidence = isDeepOverbought ? 0.85 : 0.72;
        return { 
          action: 'SELL', 
          instrument, 
          strategy: this.name, 
          confidence,
          stopLossPips, 
          takeProfitPips 
        };
      }
    }

    // Optional: Take profit or close position when RSI reaches the opposite extreme
    if (context.activePosition) {
      if (context.activePosition.action === 'BUY' && rsiCurr >= this.overbought) {
        return { action: 'CLOSE', instrument, strategy: this.name };
      }
      if (context.activePosition.action === 'SELL' && rsiCurr <= this.oversold) {
        return { action: 'CLOSE', instrument, strategy: this.name };
      }
    }

    return null;
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
