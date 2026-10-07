import { Strategy, Signal, MarketContext, Candle, StrategyEvaluationResult } from './strategy.interface';
import { SymbolNormalizer } from '../utils/symbolNormalizer';
import { logger } from '../logger';

export class VolatilityArbitrageStrategy implements Strategy {
  public name = 'volatility_arbitrage';

  public evaluate(candles: Candle[], context: MarketContext): StrategyEvaluationResult {
    if (!candles || candles.length < 25) {
      return { signal: 'NONE', confidence: 0, reason: 'Insufficient candles for Volatility Arbitrage', sl: 0, tp: 0 };
    }

    // 1. Calculate 14-period ATR series
    const atrSeries: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      atrSeries.push(tr);
    }

    if (atrSeries.length < 20) {
      return { signal: 'NONE', confidence: 0, reason: 'Insufficient ATR series', sl: 0, tp: 0 };
    }

    // 2. Rolling 20-period mean and std dev of ATR
    const recentAtr = atrSeries.slice(-20);
    const currentAtr = recentAtr[recentAtr.length - 1];
    const meanAtr = recentAtr.reduce((a, b) => a + b, 0) / 20;

    const variance = recentAtr.reduce((acc, val) => acc + Math.pow(val - meanAtr, 2), 0) / 20;
    const stdDevAtr = Math.sqrt(variance);

    // 3. Volatility Expansion Condition (ATR > mean + 2 * stdDev)
    const isVolSpike = currentAtr > (meanAtr + 2 * stdDevAtr);

    if (!isVolSpike) {
      return { signal: 'NONE', confidence: 0, reason: 'No volatility spike', sl: 0, tp: 0 };
    }

    const currentCandle = candles[candles.length - 1];
    const pastCandle = candles[candles.length - 4] || candles[0];
    const isBullish = currentCandle.close > pastCandle.close;

    const instrument = currentCandle.instrument || (context.currentQuote ? context.currentQuote.instrument : 'EUR/USD');
    const pipSize = SymbolNormalizer.getPipSize(instrument);
    const atrPips = currentAtr / pipSize;

    const action = isBullish ? 'BUY' : 'SELL';
    const stopLossPips = Math.round(atrPips * 1.5);
    const takeProfitPips = Math.round(atrPips * 3.0);

    logger.info(
      `[VOLATILITY ARBITRAGE] Volatility expansion detected on ${instrument}! ` +
      `Current ATR: ${currentAtr.toFixed(5)} (Mean: ${meanAtr.toFixed(5)} + 2*StdDev: ${(2 * stdDevAtr).toFixed(5)}). ` +
      `Action: ${action}`
    );

    return {
      signal: action,
      confidence: 0.82,
      reason: `Volatility expansion spike (ATR: ${currentAtr.toFixed(4)} > mean+2sd)`,
      sl: stopLossPips,
      tp: takeProfitPips,
      stopLossPips,
      takeProfitPips,
      atr: currentAtr,
    };
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
}
