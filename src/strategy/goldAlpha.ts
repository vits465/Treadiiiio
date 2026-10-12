import { Strategy, Signal, MarketContext, Candle, StrategyEvaluationResult } from './strategy.interface';
import { config } from '../config';
import { computeAtr } from '../risk/volatility';
import { logger } from '../logger';
import { SymbolNormalizer } from '../utils/symbolNormalizer';
import { RegimeRouter } from '../analytics/regimeRouter';

/**
 * GoldAlphaStrategy — Specialized Institutional Gold (XAU/USD) Alpha Strategy
 *
 * Combines Session Liquidity, VWAP Mean Reversal, EMA 200 Macro Trend,
 * and ATR Volatility Expansion to capture high-probability Gold moves with 1:2.08 RRR.
 */
export class GoldAlphaStrategy implements Strategy {
  public readonly name = 'gold_alpha';

  public evaluate(candles: Candle[], context: MarketContext): StrategyEvaluationResult {
    if (!candles || candles.length < 50) {
      return { signal: 'NONE', confidence: 0, reason: 'Insufficient candle history (minimum 50 bars required)', sl: 0, tp: 0 };
    }

    const candle = candles[candles.length - 1];
    const instrument = candle.instrument || (context.currentQuote ? context.currentQuote.instrument : 'XAU/USD');
    const isXau = SymbolNormalizer.isGold(instrument);
    const pipSize = SymbolNormalizer.getPipSize(instrument);

    // 1. Session Filter: High Liquidity Hours for Gold (London 07:00-11:00 UTC & NY 12:00-18:00 UTC)
    const candleTime = new Date(candle.time);
    const hour = candleTime.getUTCHours();
    const isGoldSession = (hour >= 7 && hour <= 11) || (hour >= 12 && hour <= 18);
    const sessionBonus = isGoldSession ? 0.05 : 0.0;

    // 2. Indicators Calculation
    const len = candles.length;
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    // ADX(14) Trend Strength Filter: Avoid choppy, sideways markets!
    const adx = RegimeRouter.calculateADX(candles, 14);
    if (adx < 18) {
      return { signal: 'NONE', confidence: 0, reason: `Market choppy/ranging (ADX: ${adx.toFixed(1)} < 18)`, sl: 0, tp: 0 };
    }

    // EMA 200 Macro Trend
    const ema200 = this.calculateEMA(closes, Math.min(200, len - 1));
    const currentEma200 = ema200[ema200.length - 1];

    // EMA 20 & EMA 50 Short/Mid Trend
    const ema20 = this.calculateEMA(closes, 20);
    const ema50 = this.calculateEMA(closes, 50);
    const currentEma20 = ema20[ema20.length - 1];
    const currentEma50 = ema50[ema50.length - 1];

    // VWAP Approximation (Volume/Typical Price Weighted Average)
    let sumTPV = 0;
    let sumVol = 0;
    const vwapLookback = Math.min(30, len);
    for (let i = len - vwapLookback; i < len; i++) {
      const tp = (highs[i] + lows[i] + closes[i]) / 3;
      const vol = candles[i].volume || 1;
      sumTPV += tp * vol;
      sumVol += vol;
    }
    const vwap = sumVol > 0 ? sumTPV / sumVol : closes[len - 1];

    // RSI 14
    const rsiList = this.calculateRSI(closes, 14);
    const currentRsi = rsiList[rsiList.length - 1];
    const prevRsi = rsiList[rsiList.length - 2];

    // ATR 14 Dynamic Risk Management
    const atrs = computeAtr(candles, 14);
    const currentAtr = atrs[atrs.length - 1];
    const defaultAtr = isXau ? 2.5 : 0.0020;
    const effectiveAtr = currentAtr && currentAtr > 0 ? currentAtr : defaultAtr;

    // Dynamic SL & TP (1.5x ATR SL, 4.0x ATR TP -> 1:2.67 RRR — lets winners run)
    const stopLossPips = Math.max(20, Math.round((effectiveAtr * 1.5) / pipSize));
    const takeProfitPips = Math.max(60, Math.round((effectiveAtr * 4.0) / pipSize));

    const currentClose = closes[len - 1];
    const prevClose = closes[len - 2];

    // -------------------------------------------------------------------------
    // Signal 1: Institutional Gold Bullish Expansion Signal (BUY)
    // -------------------------------------------------------------------------
    const isUptrend = (!config.ENABLE_STRICT_MTF_GATE || currentClose > currentEma200) && (currentClose > currentEma50 && currentEma20 > currentEma50);
    const vwapBullishBounce = prevClose <= vwap && currentClose > vwap;
    const rsiBullishMomentum = prevRsi < 50 && currentRsi >= 48 && currentRsi < 66;

    if (isUptrend && (vwapBullishBounce || rsiBullishMomentum)) {
      if (context.activePosition?.action === 'SELL') {
        return { signal: 'CLOSE', confidence: 0.9, reason: 'Bullish expansion against short position', sl: 0, tp: 0 };
      }
      if (!context.activePosition) {
        const baseConf = isXau ? 0.85 : 0.78;
        const confidence = Math.min(0.95, baseConf + sessionBonus);

        logger.info(
          `[${this.name}] ${instrument} Master BUY signal triggered. ` +
          `Close: ${currentClose.toFixed(2)}, VWAP: ${vwap.toFixed(2)}, ADX: ${adx.toFixed(1)}, RSI: ${currentRsi.toFixed(1)}, ` +
          `SL: ${stopLossPips} pips ($${(stopLossPips * pipSize).toFixed(2)}), TP: ${takeProfitPips} pips ($${(takeProfitPips * pipSize).toFixed(2)})`
        );

        return {
          signal: 'BUY',
          confidence,
          reason: `Institutional Gold Master BUY (ADX: ${adx.toFixed(1)}, RSI: ${currentRsi.toFixed(1)}, SL: ${stopLossPips}p, TP: ${takeProfitPips}p)`,
          sl: stopLossPips,
          tp: takeProfitPips,
          stopLossPips,
          takeProfitPips,
          atr: effectiveAtr,
        };
      }
    }

    // -------------------------------------------------------------------------
    // Signal 2: Institutional Gold Bearish Expansion Signal (SELL)
    // -------------------------------------------------------------------------
    const isDowntrend = (!config.ENABLE_STRICT_MTF_GATE || currentClose < currentEma200) && (currentClose < currentEma50 && currentEma20 < currentEma50);
    const vwapBearishBounce = prevClose >= vwap && currentClose < vwap;
    const rsiBearishMomentum = prevRsi > 50 && currentRsi <= 52 && currentRsi > 34;

    if (isDowntrend && (vwapBearishBounce || rsiBearishMomentum)) {
      if (context.activePosition?.action === 'BUY') {
        return { signal: 'CLOSE', confidence: 0.9, reason: 'Bearish expansion against long position', sl: 0, tp: 0 };
      }
      if (!context.activePosition) {
        const baseConf = isXau ? 0.85 : 0.78;
        const confidence = Math.min(0.95, baseConf + sessionBonus);

        logger.info(
          `[${this.name}] ${instrument} Master SELL signal triggered. ` +
          `Close: ${currentClose.toFixed(2)}, VWAP: ${vwap.toFixed(2)}, ADX: ${adx.toFixed(1)}, RSI: ${currentRsi.toFixed(1)}, ` +
          `SL: ${stopLossPips} pips ($${(stopLossPips * pipSize).toFixed(2)}), TP: ${takeProfitPips} pips ($${(takeProfitPips * pipSize).toFixed(2)})`
        );

        return {
          signal: 'SELL',
          confidence,
          reason: `Institutional Gold Master SELL (ADX: ${adx.toFixed(1)}, RSI: ${currentRsi.toFixed(1)}, SL: ${stopLossPips}p, TP: ${takeProfitPips}p)`,
          sl: stopLossPips,
          tp: takeProfitPips,
          stopLossPips,
          takeProfitPips,
          atr: effectiveAtr,
        };
      }
    }

    return { signal: 'NONE', confidence: 0, reason: 'No Gold Alpha expansion setup', sl: 0, tp: 0 };
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

  private calculateEMA(closes: number[], period: number): number[] {
    if (closes.length < period) return new Array(closes.length).fill(closes[closes.length - 1] || 0);

    const emaValues: number[] = new Array(closes.length).fill(0);
    const k = 2 / (period + 1);

    let sum = 0;
    for (let i = 0; i < period; i++) sum += closes[i];
    emaValues[period - 1] = sum / period;

    for (let i = period; i < closes.length; i++) {
      emaValues[i] = closes[i] * k + emaValues[i - 1] * (1 - k);
    }

    return emaValues;
  }

  private calculateRSI(closes: number[], period: number = 14): number[] {
    if (closes.length <= period) return new Array(closes.length).fill(50);

    const rsiValues: number[] = new Array(closes.length).fill(50);
    let avgGain = 0, avgLoss = 0;

    for (let i = 1; i <= period; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) avgGain += change;
      else avgLoss += Math.abs(change);
    }

    avgGain /= period;
    avgLoss /= period;
    rsiValues[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    for (let i = period + 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      rsiValues[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }

    return rsiValues;
  }
}
