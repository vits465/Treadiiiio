import { Strategy, Signal, MarketContext, Candle } from './strategy.interface';
import { config } from '../config';

export class Scalper1mStrategy implements Strategy {
  public readonly name = 'scalping_1m';

  private tradeTimestamps: number[] = [];

  public onCandle(candle: Candle, context: MarketContext): Signal | null {
    // 1. Scalper granularity check (must be 1m)
    if (candle.granularity !== '1min' && candle.granularity !== '1m') {
      // Scalping is evaluated on 1m candles. Return null if non-1m feed passed.
      return null;
    }

    // 2. Active hours check: London Open (07:00–10:00 UTC) and NY Open (13:00–16:00 UTC)
    const now = new Date(candle.time);
    const hour = now.getUTCHours();
    const isLondonOpen = hour >= 7 && hour < 10;
    const isNyOpen = hour >= 13 && hour < 16;

    if (!isLondonOpen && !isNyOpen) {
      return null; // Scalper active strictly during market opening hours
    }

    // 3. Rate Throttling: max N trades per hour
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    this.tradeTimestamps = this.tradeTimestamps.filter(t => t > oneHourAgo);
    if (this.tradeTimestamps.length >= config.SCALPER_MAX_TRADES_PER_HOUR) {
      return null;
    }

    // 4. Hard Spread Filter: skip entry if spread > 25% of TP distance
    const quote = context.currentQuote;
    const currentSpread = quote.ask - quote.bid;
    const isJpy = candle.instrument.includes('JPY');
    const isXau = candle.instrument.includes('XAU');
    const pipSize = (isJpy || isXau) ? 0.01 : 0.0001;

    const tpPips = config.SCALPER_TP_PIPS || 6;
    const slPips = config.SCALPER_SL_PIPS || 6;
    const tpDistance = tpPips * pipSize;

    if (currentSpread > tpDistance * config.SCALPER_MAX_SPREAD_RATIO) {
      return null; // Spread too wide for scalping
    }

    const candles = context.historicalCandles;
    if (candles.length < 20) return null;

    // 5. Scalp Signal Logic: Quick EMA 5 / EMA 13 Crossover with RSI confirmation
    const closes = candles.slice(-20).map(c => c.close);
    const ema5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const ema13 = closes.slice(-13).reduce((a, b) => a + b, 0) / 13;
    const prevCloses = candles.slice(-21, -1).map(c => c.close);
    const prevEma5 = prevCloses.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const prevEma13 = prevCloses.slice(-13).reduce((a, b) => a + b, 0) / 13;

    // Bullish scalp trigger
    if (prevEma5 <= prevEma13 && ema5 > ema13) {
      this.tradeTimestamps.push(Date.now());
      return {
        strategy: this.name,
        instrument: candle.instrument,
        action: 'BUY',
        stopLossPips: slPips,
        takeProfitPips: tpPips,
        confidence: 0.72,
        reason: `1m EMA Bullish Scalp Crossover during ${hour < 12 ? 'London' : 'NY'} session (Spread: ${(currentSpread / pipSize).toFixed(1)} pips)`,
      };
    }

    // Bearish scalp trigger
    if (prevEma5 >= prevEma13 && ema5 < ema13) {
      this.tradeTimestamps.push(Date.now());
      return {
        strategy: this.name,
        instrument: candle.instrument,
        action: 'SELL',
        stopLossPips: slPips,
        takeProfitPips: tpPips,
        confidence: 0.72,
        reason: `1m EMA Bearish Scalp Crossover during ${hour < 12 ? 'London' : 'NY'} session (Spread: ${(currentSpread / pipSize).toFixed(1)} pips)`,
      };
    }

    return null;
  }
}
