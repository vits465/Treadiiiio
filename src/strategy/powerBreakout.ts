import { Strategy, Signal, MarketContext, Candle } from './strategy.interface';
import { RegimeRouter } from '../analytics/regimeRouter';
import { config } from '../config';

export class PowerBreakoutStrategy implements Strategy {
  public readonly name = 'power_breakout';

  public onCandle(candle: Candle, context: MarketContext): Signal | null {
    const candles = context.historicalCandles;
    const period = config.POWER_DONCHIAN_PERIOD || 20;

    if (candles.length < period + 5) {
      return null;
    }

    // 1. Calculate Donchian Channel (high/low of previous N candles, excluding current)
    const channelCandles = candles.slice(-period - 1, -1);
    const upperChannel = Math.max(...channelCandles.map(c => c.high));
    const lowerChannel = Math.min(...channelCandles.map(c => c.low));

    // 2. Trend Filter: ADX(14) >= POWER_ADX_MIN (25)
    const adx = RegimeRouter.calculateADX(candles, 14);
    if (adx < config.POWER_ADX_MIN) {
      return null;
    }

    // 3. ATR Expansion Confirmation
    const recentTrs: number[] = [];
    for (let i = candles.length - 14; i < candles.length; i++) {
      const h = candles[i].high;
      const l = candles[i].low;
      const pc = candles[i - 1].close;
      recentTrs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    const currentAtr = recentTrs.reduce((a, b) => a + b, 0) / 14;

    const isJpy = candle.instrument.includes('JPY');
    const isXau = candle.instrument.includes('XAU');
    const pipSize = (isJpy || isXau) ? 0.01 : 0.0001;

    const currentTr = Math.max(candle.high - candle.low, Math.abs(candle.high - candles[candles.length - 2].close));
    if (currentTr < currentAtr * config.POWER_ATR_EXPANSION_RATIO) {
      return null; // Not enough volatility expansion for a power move
    }

    const slPips = Math.max(15, Math.round((currentAtr * 1.5) / pipSize));
    const tpPips = Math.round(slPips * 2.5); // 1:2.5 Risk-to-Reward Ratio

    // 4. Breakout Trigger
    if (candle.close > upperChannel) {
      return {
        strategy: this.name,
        instrument: candle.instrument,
        action: 'BUY',
        stopLossPips: slPips,
        takeProfitPips: tpPips,
        confidence: Math.min(0.95, 0.70 + (adx - 25) * 0.01),
        reason: `Donchian ${period} Bullish Breakout above ${upperChannel.toFixed(4)} with ADX ${adx.toFixed(1)} & ATR expansion`,
      };
    }

    if (candle.close < lowerChannel) {
      return {
        strategy: this.name,
        instrument: candle.instrument,
        action: 'SELL',
        stopLossPips: slPips,
        takeProfitPips: tpPips,
        confidence: Math.min(0.95, 0.70 + (adx - 25) * 0.01),
        reason: `Donchian ${period} Bearish Breakout below ${lowerChannel.toFixed(4)} with ADX ${adx.toFixed(1)} & ATR expansion`,
      };
    }

    return null;
  }
}
