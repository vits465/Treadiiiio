import { Strategy, Candle, MarketContext, Signal } from './strategy.interface';

export class BollingerBandsStrategy implements Strategy {
  public readonly name = 'bollinger_bands';
  private period: number;
  private stdDevMultiplier: number;

  constructor(period = 20, stdDevMultiplier = 1.8) {
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
    };
  }

  public onCandle(candle: Candle, context: MarketContext): Signal | null {
    const candles = context.historicalCandles;
    if (candles.length < this.period + 1) {
      return null;
    }

    const prevBands = this.calculateBands(candles, candles.length - 2);
    const currBands = this.calculateBands(candles, candles.length - 1);

    if (!prevBands || !currBands) return null;

    const prevClose = candles[candles.length - 2].close;
    const currClose = candles[candles.length - 1].close;
    const instrument = candle.instrument;

    // Multi-Timeframe Trend Filter
    let dailyTrend: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
    if (context.macroCandles && context.macroCandles.length >= 20) {
      const dailySma = this.getSmaValue(context.macroCandles, context.macroCandles.length - 1, 20);
      if (dailySma) {
        const dailyClose = context.macroCandles[context.macroCandles.length - 1].close;
        dailyTrend = dailyClose > dailySma ? 'UP' : 'DOWN';
      }
    }

    // BUY: Price crosses below lower band -> BUY
    if (prevClose >= prevBands.lower && currClose < currBands.lower) {
      if (context.activePosition?.action === 'SELL') {
        return { action: 'CLOSE', instrument, strategy: this.name };
      }
      if (!context.activePosition) {
        const breachAmount = (currBands.lower - currClose) / (currBands.middle - currBands.lower);
        const confidence = breachAmount > 0.3 ? 0.82 : 0.65;
        return { 
          action: 'BUY', 
          instrument, 
          strategy: this.name, 
          confidence,
          stopLossPips: 20, 
          takeProfitPips: 35 
        };
      }
    }

    // SELL: Price crosses above upper band -> SELL (Market Reversal)
    if (prevClose <= prevBands.upper && currClose > currBands.upper) {
      if (context.activePosition?.action === 'BUY') {
        return { action: 'CLOSE', instrument, strategy: this.name };
      }
      if (!context.activePosition) {
        const breachAmount = (currClose - currBands.upper) / (currBands.upper - currBands.middle);
        const confidence = breachAmount > 0.3 ? 0.82 : 0.65;
        return { 
          action: 'SELL', 
          instrument, 
          strategy: this.name, 
          confidence,
          stopLossPips: 20, 
          takeProfitPips: 35 
        };
      }
    }

    // Exit signal when price crosses the middle band (SMA)
    if (context.activePosition) {
      const position = context.activePosition;
      if (position.action === 'BUY' && prevClose < prevBands.middle && currClose >= currBands.middle) {
        return { action: 'CLOSE', instrument, strategy: this.name };
      }
      if (position.action === 'SELL' && prevClose > prevBands.middle && currClose <= currBands.middle) {
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
