import { Strategy, Signal, MarketContext, Candle } from './strategy.interface';
import { config } from '../config';
import { computeAtr } from '../risk/volatility';

export class Scalper1mStrategy implements Strategy {
  public readonly name = 'scalping_1m';

  private tradeTimestamps: number[] = [];

  public onCandle(candle: Candle, context: MarketContext): Signal | null {
    // 1. Rate Throttling: max N trades per hour
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    this.tradeTimestamps = this.tradeTimestamps.filter(t => t > oneHourAgo);
    if (this.tradeTimestamps.length >= (config.SCALPER_MAX_TRADES_PER_HOUR || 3)) {
      return null;
    }

    const candles = context.historicalCandles;
    if (!candles || candles.length < 20) return null;

    const instrument = candle.instrument;
    const isJpy = instrument.includes('JPY');
    const isXau = instrument.includes('XAU');
    const pipSize = (isJpy || isXau) ? 0.01 : 0.0001;

    // 2. Spread Filter: skip entry if current spread is too wide
    const quote = context.currentQuote;
    const currentSpread = quote ? (quote.ask - quote.bid) : 0;

    // 3. Dynamic Scalper ATR TP & SL (1.25x ATR TP, 1.0x ATR SL -> 1.25:1 RRR)
    const atrs = computeAtr(candles, 14);
    const currentAtr = atrs[atrs.length - 1];
    const defaultAtr = isXau ? 4.0 : isJpy ? 0.20 : 0.0010;
    const effectiveAtr = currentAtr && currentAtr > 0 ? currentAtr : defaultAtr;

    const slPips = Math.max(8, Math.round((effectiveAtr * 1.0) / pipSize));
    const tpPips = Math.max(10, Math.round((effectiveAtr * 1.25) / pipSize));
    const tpDistance = tpPips * pipSize;

    if (currentSpread > 0 && currentSpread > tpDistance * (config.SCALPER_MAX_SPREAD_RATIO || 0.25)) {
      return null; // Spread too wide for scalping
    }

    // 4. Scalp Signal Logic: Fast EMA 5 / EMA 13 Crossover with RSI Filter
    const closes = candles.slice(-20).map(c => c.close);
    const ema5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const ema13 = closes.slice(-13).reduce((a, b) => a + b, 0) / 13;
    const prevCloses = candles.slice(-21, -1).map(c => c.close);
    const prevEma5 = prevCloses.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const prevEma13 = prevCloses.slice(-13).reduce((a, b) => a + b, 0) / 13;

    // RSI Filter for Scalping (14-period RSI)
    let sumGain = 0, sumLoss = 0;
    for (let i = 1; i <= 14; i++) {
      const diff = closes[closes.length - i] - closes[closes.length - i - 1];
      if (diff > 0) sumGain += diff;
      else sumLoss += Math.abs(diff);
    }
    const rsi = sumLoss === 0 ? 100 : 100 - (100 / (1 + (sumGain / sumLoss)));

    // Bullish scalp trigger
    if (prevEma5 <= prevEma13 && ema5 > ema13 && rsi < 65) {
      this.tradeTimestamps.push(Date.now());
      return {
        strategy: this.name,
        instrument,
        action: 'BUY',
        stopLossPips: slPips,
        takeProfitPips: tpPips,
        confidence: 0.80,
        reason: `High-Precision EMA Scalp BUY (RSI: ${rsi.toFixed(1)}, SL: ${slPips} pips, TP: ${tpPips} pips)`,
      };
    }

    // Bearish scalp trigger
    if (prevEma5 >= prevEma13 && ema5 < ema13 && rsi > 35) {
      this.tradeTimestamps.push(Date.now());
      return {
        strategy: this.name,
        instrument,
        action: 'SELL',
        stopLossPips: slPips,
        takeProfitPips: tpPips,
        confidence: 0.80,
        reason: `High-Precision EMA Scalp SELL (RSI: ${rsi.toFixed(1)}, SL: ${slPips} pips, TP: ${tpPips} pips)`,
      };
    }

    return null;
  }
}
