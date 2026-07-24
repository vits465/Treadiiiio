import { Strategy, Signal, MarketContext, Candle } from './strategy.interface';
import { logger } from '../logger';

export class VolatilityArbitrageStrategy implements Strategy {
  public name = 'volatility_arbitrage';

  public onCandle(candle: Candle, context: MarketContext): Signal | null {
    const candles = context.historicalCandles;
    if (candles.length < 25) return null;

    // 1. Calculate 14-period ATR series
    const atrSeries: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      atrSeries.push(tr);
    }

    if (atrSeries.length < 20) return null;

    // 2. Rolling 20-period mean and std dev of ATR
    const recentAtr = atrSeries.slice(-20);
    const currentAtr = recentAtr[recentAtr.length - 1];
    const meanAtr = recentAtr.reduce((a, b) => a + b, 0) / 20;

    const variance = recentAtr.reduce((acc, val) => acc + Math.pow(val - meanAtr, 2), 0) / 20;
    const stdDevAtr = Math.sqrt(variance);

    // 3. Volatility Expansion Condition (ATR > mean + 2 * stdDev)
    const isVolSpike = currentAtr > (meanAtr + 2 * stdDevAtr);

    if (!isVolSpike) {
      return null;
    }

    // Determine direction from price momentum over last 3 candles
    const currentClose = candles[candles.length - 1].close;
    const pastClose = candles[candles.length - 4].close;
    const isBullish = currentClose > pastClose;

    // Convert ATR to pips for dynamic TP/SL
    const pipMultiplier = candle.instrument.includes('JPY') ? 100 : (candle.instrument.includes('XAU') ? 10 : 10000);
    const atrPips = currentAtr * pipMultiplier;

    const action = isBullish ? 'BUY' : 'SELL';
    
    logger.info(
      `[VOLATILITY ARBITRAGE] Volatility expansion detected on ${candle.instrument}! ` +
      `Current ATR: ${currentAtr.toFixed(5)} (Mean: ${meanAtr.toFixed(5)} + 2*StdDev: ${(2*stdDevAtr).toFixed(5)}). ` +
      `Action: ${action}`
    );

    return {
      strategy: this.name,
      instrument: candle.instrument,
      action,
      confidence: 0.82,
      atr: atrPips,
      stopLossPips: Math.round(atrPips * 1.5),
      takeProfitPips: Math.round(atrPips * 3.0)
    };
  }
}
