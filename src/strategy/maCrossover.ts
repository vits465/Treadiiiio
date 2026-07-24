import { Strategy, Candle, MarketContext, Signal } from './strategy.interface';

export class MaCrossoverStrategy implements Strategy {
  public readonly name = 'ma_crossover_scalper';
  private fastPeriod: number;
  private slowPeriod: number;

  constructor(fastPeriod = 3, slowPeriod = 8) {
    this.fastPeriod = fastPeriod;
    this.slowPeriod = slowPeriod;
  }

  public onCandle(candle: Candle, context: MarketContext): Signal | null {
    const candles = context.historicalCandles;
    const requiredLength = Math.max(this.fastPeriod, this.slowPeriod) + 1;

    if (candles.length < requiredLength) {
      return null;
    }

    const fastPrev = this.getSmaValue(candles, candles.length - 2, this.fastPeriod);
    const fastCurr = this.getSmaValue(candles, candles.length - 1, this.fastPeriod);
    const slowPrev = this.getSmaValue(candles, candles.length - 2, this.slowPeriod);
    const slowCurr = this.getSmaValue(candles, candles.length - 1, this.slowPeriod);
    
    if (fastPrev === null || fastCurr === null || slowPrev === null || slowCurr === null) {
      return null;
    }

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

    // Professional Risk Management (1:2 RRR)
    const stopLossPips = 20;
    const takeProfitPips = 40;

    // Crossover Up -> BUY
    if (fastPrev <= slowPrev && fastCurr > slowCurr) {
      if (context.activePosition?.action === 'SELL') {
        return { action: 'CLOSE', instrument, strategy: this.name };
      }
      if (!context.activePosition) {
        const confidence = dailyTrend === 'UP' ? 0.78 : 0.60;
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

    // Crossover Down -> SELL (Market Reversal)
    if (fastPrev >= slowPrev && fastCurr < slowCurr) {
      if (context.activePosition?.action === 'BUY') {
        return { action: 'CLOSE', instrument, strategy: this.name };
      }
      if (!context.activePosition) {
        const confidence = dailyTrend === 'DOWN' ? 0.78 : 0.60;
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
