// src/strategy/smartMoneyConcepts.ts
import { Strategy, Candle, MarketContext, Signal } from './strategy.interface';

export class SmartMoneyConceptsStrategy implements Strategy {
  public readonly name = 'smc_liquidity';

  /**
   * Evaluates candles for Fair Value Gaps (FVG) & Order Block (OB) retests.
   */
  public onCandle(candle: Candle, context: MarketContext): Signal | null {
    const candles = context.historicalCandles;
    if (candles.length < 20) return null;

    const instrument = candle.instrument;
    const len = candles.length;
    const c1 = candles[len - 3]; // 2 candles ago
    const c2 = candles[len - 2]; // Previous candle
    const c3 = candles[len - 1]; // Current/latest candle

    // Multi-Timeframe Trend Filter (20 SMA on Daily)
    let dailyTrend: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
    if (context.macroCandles && context.macroCandles.length >= 20) {
      const sum = context.macroCandles.slice(-20).reduce((acc, c) => acc + c.close, 0);
      const dailySma = sum / 20;
      const latestDailyClose = context.macroCandles[context.macroCandles.length - 1].close;
      dailyTrend = latestDailyClose > dailySma ? 'UP' : 'DOWN';
    }

    // 1. Detect Bullish Fair Value Gap (c1.high < c3.low with strong displacement in c2)
    const isBullishFVG = c1.high < c3.low && c2.close > c2.open && (c2.high - c2.low) > (c1.high - c1.low) * 1.5;
    
    // 2. Detect Bearish Fair Value Gap (c1.low > c3.high with strong displacement in c2)
    const isBearishFVG = c1.low > c3.high && c2.close < c2.open && (c2.high - c2.low) > (c1.high - c1.low) * 1.5;

    // BUY Signal: Bullish FVG retest + Daily Trend UP
    if (isBullishFVG && dailyTrend === 'UP') {
      if (context.activePosition?.action === 'SELL') {
        return { action: 'CLOSE', instrument, strategy: this.name };
      }
      if (!context.activePosition) {
        return {
          action: 'BUY',
          instrument,
          strategy: this.name,
          stopLossPips: 20,
          takeProfitPips: 50,
        };
      }
    }

    // SELL Signal: Bearish FVG retest + Daily Trend DOWN
    if (isBearishFVG && dailyTrend === 'DOWN') {
      if (context.activePosition?.action === 'BUY') {
        return { action: 'CLOSE', instrument, strategy: this.name };
      }
      if (!context.activePosition) {
        return {
          action: 'SELL',
          instrument,
          strategy: this.name,
          stopLossPips: 20,
          takeProfitPips: 50,
        };
      }
    }

    return null;
  }
}
