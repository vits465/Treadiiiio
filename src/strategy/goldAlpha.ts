import { Strategy, Signal, MarketContext, Candle } from './strategy.interface';
import { computeAtr } from '../risk/volatility';
import { logger } from '../logger';

/**
 * GoldAlphaStrategy — Specialized Institutional Gold (XAU/USD) Alpha Strategy
 *
 * Combines Session Liquidity, VWAP Mean Reversal, EMA 200 Macro Trend,
 * and ATR Volatility Expansion to capture high-probability Gold moves with 1:2.08 RRR.
 */
export class GoldAlphaStrategy implements Strategy {
  public readonly name = 'gold_alpha';

  public onCandle(candle: Candle, context: MarketContext): Signal | null {
    const candles = context.historicalCandles;
    if (!candles || candles.length < 50) return null;

    const instrument = candle.instrument;
    const isXau = instrument.includes('XAU');
    const isJpy = instrument.includes('JPY');
    const pipSize = (isXau || isJpy) ? 0.01 : 0.0001;

    // 1. Session Filter: High Liquidity Hours for Gold (London 07:00-11:00 UTC & NY 12:00-17:00 UTC)
    const candleTime = new Date(candle.time);
    const hour = candleTime.getUTCHours();
    const isGoldSession = (hour >= 7 && hour <= 11) || (hour >= 12 && hour <= 18);
    
    // Give extra priority to Gold during prime trading sessions
    const sessionBonus = isGoldSession ? 0.05 : 0.0;

    // 2. Indicators Calculation
    const len = candles.length;
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

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
    const defaultAtr = isXau ? 8.0 : isJpy ? 0.35 : 0.0020;
    const effectiveAtr = currentAtr && currentAtr > 0 ? currentAtr : defaultAtr;

    // Dynamic SL & TP (1.2x ATR SL, 2.5x ATR TP -> 1:2.08 RRR)
    const stopLossPips = Math.max(15, Math.round((effectiveAtr * 1.2) / pipSize));
    const takeProfitPips = Math.max(30, Math.round((effectiveAtr * 2.5) / pipSize));

    const currentClose = closes[len - 1];
    const prevClose = closes[len - 2];

    // -------------------------------------------------------------------------
    // Signal 1: Gold Bullish Expansion Signal (BUY)
    // - Price above EMA 200 or EMA 20 > EMA 50
    // - Price bounced/crossed above VWAP
    // - RSI between 45 and 65 (healthy momentum)
    // -------------------------------------------------------------------------
    const isUptrend = currentClose > currentEma200 || currentEma20 > currentEma50;
    const vwapBullishBounce = prevClose <= vwap && currentClose > vwap;
    const rsiBullishMomentum = prevRsi < 50 && currentRsi >= 50 && currentRsi < 68;

    if (isUptrend && (vwapBullishBounce || rsiBullishMomentum)) {
      if (context.activePosition?.action === 'SELL') {
        return { action: 'CLOSE', instrument, strategy: this.name };
      }
      if (!context.activePosition) {
        const baseConf = isXau ? 0.83 : 0.75;
        const confidence = Math.min(0.95, baseConf + sessionBonus);
        
        logger.info(
          `[${this.name}] ${instrument} BUY signal triggered. ` +
          `Close: ${currentClose.toFixed(2)}, VWAP: ${vwap.toFixed(2)}, RSI: ${currentRsi.toFixed(1)}, ` +
          `SL: ${stopLossPips} pips ($${(stopLossPips * pipSize).toFixed(2)}), TP: ${takeProfitPips} pips ($${(takeProfitPips * pipSize).toFixed(2)})`
        );

        return {
          action: 'BUY',
          instrument,
          strategy: this.name,
          confidence,
          stopLossPips,
          takeProfitPips,
          reason: `Gold Alpha Bullish VWAP/EMA Expansion (RSI: ${currentRsi.toFixed(1)}, SL: ${stopLossPips}p, TP: ${takeProfitPips}p)`,
        };
      }
    }

    // -------------------------------------------------------------------------
    // Signal 2: Gold Bearish Expansion Signal (SELL)
    // - Price below EMA 200 or EMA 20 < EMA 50
    // - Price rejection/crossed below VWAP
    // - RSI between 35 and 55 (healthy bearish momentum)
    // -------------------------------------------------------------------------
    const isDowntrend = currentClose < currentEma200 || currentEma20 < currentEma50;
    const vwapBearishBounce = prevClose >= vwap && currentClose < vwap;
    const rsiBearishMomentum = prevRsi > 50 && currentRsi <= 50 && currentRsi > 32;

    if (isDowntrend && (vwapBearishBounce || rsiBearishMomentum)) {
      if (context.activePosition?.action === 'BUY') {
        return { action: 'CLOSE', instrument, strategy: this.name };
      }
      if (!context.activePosition) {
        const baseConf = isXau ? 0.83 : 0.75;
        const confidence = Math.min(0.95, baseConf + sessionBonus);

        logger.info(
          `[${this.name}] ${instrument} SELL signal triggered. ` +
          `Close: ${currentClose.toFixed(2)}, VWAP: ${vwap.toFixed(2)}, RSI: ${currentRsi.toFixed(1)}, ` +
          `SL: ${stopLossPips} pips ($${(stopLossPips * pipSize).toFixed(2)}), TP: ${takeProfitPips} pips ($${(takeProfitPips * pipSize).toFixed(2)})`
        );

        return {
          action: 'SELL',
          instrument,
          strategy: this.name,
          confidence,
          stopLossPips,
          takeProfitPips,
          reason: `Gold Alpha Bearish VWAP/EMA Expansion (RSI: ${currentRsi.toFixed(1)}, SL: ${stopLossPips}p, TP: ${takeProfitPips}p)`,
        };
      }
    }

    return null;
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
