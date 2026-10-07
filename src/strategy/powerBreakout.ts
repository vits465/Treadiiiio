import { Strategy, Signal, MarketContext, Candle, StrategyEvaluationResult } from './strategy.interface';
import { RegimeRouter } from '../analytics/regimeRouter';
import { SymbolNormalizer } from '../utils/symbolNormalizer';
import { config } from '../config';

export class PowerBreakoutStrategy implements Strategy {
  public readonly name = 'power_breakout';

  public evaluate(candles: Candle[], context: MarketContext): StrategyEvaluationResult {
    const period = config.POWER_DONCHIAN_PERIOD || 20;

    if (!candles || candles.length < period + 5) {
      return { signal: 'NONE', confidence: 0, reason: 'Insufficient candle history', sl: 0, tp: 0 };
    }

    const candle = candles[candles.length - 1];
    const instrument = candle.instrument || (context.currentQuote ? context.currentQuote.instrument : 'EUR/USD');
    const pipSize = SymbolNormalizer.getPipSize(instrument);

    // Session Open Gate (if enabled): entries only near London/NY/Tokyo opens
    if (config.POWER_ONLY_NEAR_SESSION_OPENS) {
      const utcHours = new Date(candle.time).getUTCHours();
      const isSessionOpen = (utcHours >= 7 && utcHours <= 9) || (utcHours >= 12 && utcHours <= 14) || (utcHours >= 0 && utcHours <= 2);
      if (!isSessionOpen) {
        return { signal: 'NONE', confidence: 0, reason: `Outside session open window (UTC hour: ${utcHours})`, sl: 0, tp: 0 };
      }
    }

    // 1. Calculate Donchian Channel (high/low of previous N candles, excluding current)
    const channelCandles = candles.slice(-period - 1, -1);
    const upperChannel = Math.max(...channelCandles.map(c => c.high));
    const lowerChannel = Math.min(...channelCandles.map(c => c.low));

    // 2. Trend Filter: ADX(14) >= configurable threshold (default 20, recommended 25 for breakout)
    const adx = RegimeRouter.calculateADX(candles, 14);
    const minAdx = config.POWER_ADX_MIN || 20;
    if (adx < minAdx) {
      return { signal: 'NONE', confidence: 0, reason: `ADX ${adx.toFixed(1)} below threshold ${minAdx}`, sl: 0, tp: 0 };
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

    const prevCandle = candles[candles.length - 2] || candle;
    const currentTr = Math.max(candle.high - candle.low, Math.abs(candle.high - prevCandle.close));
    const expansionRatio = config.POWER_ATR_EXPANSION_RATIO || 1.05;
    if (currentTr < currentAtr * expansionRatio) {
      return { signal: 'NONE', confidence: 0, reason: `ATR expansion not confirmed (TR: ${currentTr.toFixed(4)} < ${currentAtr.toFixed(4)} * ${expansionRatio})`, sl: 0, tp: 0 };
    }

    const slMult = config.POWER_ATR_SL_MULT || 1.5;
    const isGold = SymbolNormalizer.isGold(instrument);
    const minSlPips = isGold ? 15 : 10;
    const slPips = Math.max(minSlPips, Math.round((currentAtr * slMult) / pipSize));
    const tpPips = Math.round(slPips * 2.5); // 1:2.5 Risk-to-Reward Ratio

    // MTF Daily Trend Alignment Filter
    let dailyTrend: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
    if (context.macroCandles && context.macroCandles.length >= 20) {
      const dailyCloses = context.macroCandles.slice(-20).map(c => c.close);
      const dailySma = dailyCloses.reduce((a, b) => a + b, 0) / 20;
      const latestDailyClose = context.macroCandles[context.macroCandles.length - 1].close;
      dailyTrend = latestDailyClose > dailySma ? 'UP' : 'DOWN';
    }

    // 4. Breakout Trigger
    const mtfBuyAllowed = !config.ENABLE_STRICT_MTF_GATE || dailyTrend !== 'DOWN';
    if (candle.close > upperChannel && mtfBuyAllowed) {
      const confidence = Math.min(0.95, Math.max(0.60, 0.75 + (adx - 25) * 0.01));
      return {
        signal: 'BUY',
        confidence,
        reason: `Donchian ${period} Bullish Breakout above ${upperChannel.toFixed(4)} with ADX ${adx.toFixed(1)} & ATR expansion`,
        sl: slPips,
        tp: tpPips,
        stopLossPips: slPips,
        takeProfitPips: tpPips,
        atr: currentAtr,
      };
    }

    const mtfSellAllowed = !config.ENABLE_STRICT_MTF_GATE || dailyTrend !== 'UP';
    if (candle.close < lowerChannel && mtfSellAllowed) {
      const confidence = Math.min(0.95, Math.max(0.60, 0.75 + (adx - 25) * 0.01));
      return {
        signal: 'SELL',
        confidence,
        reason: `Donchian ${period} Bearish Breakout below ${lowerChannel.toFixed(4)} with ADX ${adx.toFixed(1)} & ATR expansion`,
        sl: slPips,
        tp: tpPips,
        stopLossPips: slPips,
        takeProfitPips: tpPips,
        atr: currentAtr,
      };
    }

    return { signal: 'NONE', confidence: 0, reason: 'Price within Donchian channel', sl: 0, tp: 0 };
  }

  public onCandle(candle: Candle, context: MarketContext): Signal | null {
    const candles = context.historicalCandles && context.historicalCandles.length > 0
      ? context.historicalCandles
      : [candle];
    const result = this.evaluate(candles, context);

    if (result.signal === 'NONE' || result.signal === 'CLOSE') {
      return null;
    }

    return {
      strategy: this.name,
      instrument: candle.instrument,
      action: result.signal,
      confidence: result.confidence,
      reason: result.reason,
      stopLossPips: result.stopLossPips ?? result.sl,
      takeProfitPips: result.takeProfitPips ?? result.tp,
      atr: result.atr,
    };
  }
}
