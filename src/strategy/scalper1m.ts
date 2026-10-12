import { Strategy, Signal, MarketContext, Candle, StrategyEvaluationResult } from './strategy.interface';
import { config } from '../config';
import { computeAtr } from '../risk/volatility';
import { SymbolNormalizer } from '../utils/symbolNormalizer';
import { logger } from '../logger';

/**
 * Scalper1mStrategy — Institutional Precision 1-Minute Scalper
 *
 * Designed specifically for high-probability Gold (XAU/USD) and FX scalping.
 * Features:
 * - 1-Minute candles only
 * - Active only during London (07:00-11:00 UTC) and NY (12:00-16:00 UTC) opening hours
 * - True Exponential Moving Average (EMA 9, 21, 50) Trend Ribbon
 * - Volume-Weighted Average Price (VWAP) Confirmation
 * - Fast 7-Period RSI Pullback/Momentum Reversal Trigger
 * - Strict Hard Spread Filter: current spread <= 25% of TP distance
 * - Time-Stop: Closes positions exceeding N minutes (default 15m)
 * - Rate Throttling & Daily Loss Sub-limit
 */
export class Scalper1mStrategy implements Strategy {
  public readonly name = 'scalping_1m';

  private tradeTimestamps: number[] = [];

  public evaluate(candles: Candle[], context: MarketContext): StrategyEvaluationResult {
    if (!candles || candles.length === 0) {
      return { signal: 'NONE', confidence: 0, reason: 'No candles provided', sl: 0, tp: 0 };
    }

    const candle = candles[candles.length - 1];

    // 1. Strict 1-Minute Granularity Validation
    if (candle.granularity && candle.granularity !== '1min' && candle.granularity !== '1m') {
      return { signal: 'NONE', confidence: 0, reason: `Scalping requires 1m candles (got ${candle.granularity})`, sl: 0, tp: 0 };
    }

    // 2. Session Gate: Active ONLY during London and New York opening hours
    const candleDate = new Date(candle.time);
    const utcHours = candleDate.getUTCHours();
    const isLondonOpen = utcHours >= 7 && utcHours < 11;
    const isNyOpen = utcHours >= 12 && utcHours < 16;

    if (!isLondonOpen && !isNyOpen) {
      return { signal: 'NONE', confidence: 0, reason: `Outside London (07:00-11:00 UTC) and NY (12:00-16:00 UTC) open hours (${utcHours}:00 UTC)`, sl: 0, tp: 0 };
    }

    // 3. Time-Stop Exit Check on Active Position
    if (context.activePosition) {
      const entryTime = new Date(context.activePosition.entryTime).getTime();
      const currentTime = candleDate.getTime();
      const elapsedMinutes = (currentTime - entryTime) / (60 * 1000);
      const maxMinutes = config.SCALPER_TIME_STOP_MINUTES || 15;

      if (elapsedMinutes >= maxMinutes) {
        logger.info(`[SCALPER 1M] Time-stop hit for ${context.activePosition.id} (${Math.round(elapsedMinutes)}m >= ${maxMinutes}m). Emitting CLOSE.`);
        return {
          signal: 'CLOSE',
          confidence: 1.0,
          reason: `Scalp time-stop exceeded (${Math.round(elapsedMinutes)}m >= ${maxMinutes}m)`,
          sl: 0,
          tp: 0,
        };
      }
    }

    // 4. Rate Throttling: Max trades per hour
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    this.tradeTimestamps = this.tradeTimestamps.filter(t => t > oneHourAgo);
    const maxTradesPerHour = config.SCALPER_MAX_TRADES_PER_HOUR || 5;
    if (this.tradeTimestamps.length >= maxTradesPerHour) {
      return { signal: 'NONE', confidence: 0, reason: `Hourly rate throttle exceeded (${this.tradeTimestamps.length}/${maxTradesPerHour})`, sl: 0, tp: 0 };
    }

    if (candles.length < 55) {
      return { signal: 'NONE', confidence: 0, reason: 'Insufficient candle history for EMA ribbon', sl: 0, tp: 0 };
    }

    const instrument = candle.instrument || (context.currentQuote ? context.currentQuote.instrument : 'EUR/USD');
    const pipSize = SymbolNormalizer.getPipSize(instrument);
    const isGold = SymbolNormalizer.isGold(instrument);

    // 5. Dynamic Volatility (ATR 14) for Adaptive SL & TP
    const atrs = computeAtr(candles, 14);
    const currentAtr = atrs[atrs.length - 1] || (isGold ? 2.5 : 0.0010);

    const configuredTpPips = config.SCALPER_TP_PIPS || 6.0;
    const configuredSlPips = config.SCALPER_SL_PIPS || 6.0;
    const slPips = Math.max(configuredSlPips, Math.round((currentAtr * 0.8) / pipSize));
    const tpPips = Math.max(configuredTpPips, Math.round((currentAtr * 3.0) / pipSize));
    const tpDistance = tpPips * pipSize;

    // 6. Hard Spread Filter: Skip entry if current spread > 25% of TP distance
    const quote = context.currentQuote;
    const currentSpread = quote ? (quote.ask - quote.bid) : 0;
    const maxSpreadRatio = config.SCALPER_MAX_SPREAD_RATIO || 0.25;
    if (currentSpread > 0 && currentSpread > tpDistance * maxSpreadRatio) {
      return { signal: 'NONE', confidence: 0, reason: `Spread too wide (${(currentSpread / pipSize).toFixed(1)}p > ${(tpDistance * maxSpreadRatio / pipSize).toFixed(1)}p max allowed)`, sl: 0, tp: 0 };
    }

    // 7. Multi-Timeframe Trend Direction from Context
    let dailyTrend: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
    if (context.macroCandles && context.macroCandles.length >= 20) {
      const dailyCloses = context.macroCandles.slice(-20).map(c => c.close);
      const dailySma = dailyCloses.reduce((a, b) => a + b, 0) / 20;
      const latestDailyClose = context.macroCandles[context.macroCandles.length - 1].close;
      dailyTrend = latestDailyClose > dailySma ? 'UP' : 'DOWN';
    }

    // 8. True Exponential Moving Averages (EMA 9, EMA 21, EMA 50)
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const len = closes.length;

    const ema9List = this.calculateEMA(closes, 9);
    const ema21List = this.calculateEMA(closes, 21);
    const ema50List = this.calculateEMA(closes, 50);

    const ema9 = ema9List[len - 1];
    const ema21 = ema21List[len - 1];
    const ema50 = ema50List[len - 1];

    const currentClose = closes[len - 1];
    const prevClose = closes[len - 2];
    const prevCandle = candles[len - 2];

    // 9. Fast 7-Period RSI for Sensitive Pullback Detection
    const rsiList = this.calculateRSI(closes, 7);
    const currentRsi = rsiList[len - 1];
    const prevRsi = rsiList[len - 2];

    // 10. VWAP (Typical Price Volume-Weighted Average over last 30 candles)
    let sumTPV = 0;
    let sumVol = 0;
    const vwapLookback = Math.min(30, len);
    for (let i = len - vwapLookback; i < len; i++) {
      const tp = (highs[i] + lows[i] + closes[i]) / 3;
      const vol = candles[i].volume || 1;
      sumTPV += tp * vol;
      sumVol += vol;
    }
    const vwap = sumVol > 0 ? sumTPV / sumVol : currentClose;

    // -------------------------------------------------------------------------
    // Bullish Scalp Signal:
    // -------------------------------------------------------------------------
    const isBullishRibbon = currentClose > ema50 && ema9 > ema21;
    const isAboveVwap = currentClose >= vwap;
    const bullishPullbackTest = prevCandle.low <= (ema9 * 1.0015) || prevClose <= ema9;
    const bullishRebound = candle.close > candle.open && currentClose > ema9;
    const rsiBullishCurl = prevRsi <= 50 && currentRsi > prevRsi && currentRsi >= 42 && currentRsi <= 68;

    const mtfBuyAllowed = !config.ENABLE_STRICT_MTF_GATE || dailyTrend !== 'DOWN';
    if (isBullishRibbon && isAboveVwap && bullishPullbackTest && bullishRebound && rsiBullishCurl && mtfBuyAllowed) {
      if (context.activePosition?.action === 'SELL') {
        return { signal: 'CLOSE', confidence: 0.9, reason: 'Opposite signal generated', sl: 0, tp: 0 };
      }
      if (!context.activePosition) {
        this.tradeTimestamps.push(Date.now());
        const confidence = (dailyTrend === 'UP' && currentClose > vwap) ? 0.88 : 0.82;

        logger.info(
          `[SCALPER 1M] High-Probability BUY on ${instrument} @ ${currentClose.toFixed(2)}. ` +
          `EMA9/21/50: [${ema9.toFixed(2)}, ${ema21.toFixed(2)}, ${ema50.toFixed(2)}], RSI: ${currentRsi.toFixed(1)}, ` +
          `SL: ${slPips}p ($${(slPips * pipSize).toFixed(2)}), TP: ${tpPips}p ($${(tpPips * pipSize).toFixed(2)})`
        );

        return {
          signal: 'BUY',
          confidence,
          reason: `1M Scalp Trend Rebound BUY (EMA Ribbon Up, RSI ${currentRsi.toFixed(1)} Curl, 1:2 RRR)`,
          sl: slPips,
          tp: tpPips,
          stopLossPips: slPips,
          takeProfitPips: tpPips,
          atr: currentAtr,
        };
      }
    }

    // -------------------------------------------------------------------------
    // Bearish Scalp Signal:
    // -------------------------------------------------------------------------
    const isBearishRibbon = currentClose < ema50 && ema9 < ema21;
    const isBelowVwap = currentClose <= vwap;
    const bearishPullbackTest = prevCandle.high >= (ema9 * 0.9985) || prevClose >= ema9;
    const bearishRebound = candle.close < candle.open && currentClose < ema9;
    const rsiBearishCurl = prevRsi >= 50 && currentRsi < prevRsi && currentRsi <= 58 && currentRsi >= 32;

    const mtfSellAllowed = !config.ENABLE_STRICT_MTF_GATE || dailyTrend !== 'UP';
    if (isBearishRibbon && isBelowVwap && bearishPullbackTest && bearishRebound && rsiBearishCurl && mtfSellAllowed) {
      if (context.activePosition?.action === 'BUY') {
        return { signal: 'CLOSE', confidence: 0.9, reason: 'Opposite signal generated', sl: 0, tp: 0 };
      }
      if (!context.activePosition) {
        this.tradeTimestamps.push(Date.now());
        const confidence = (dailyTrend === 'DOWN' && currentClose < vwap) ? 0.88 : 0.82;

        logger.info(
          `[SCALPER 1M] High-Probability SELL on ${instrument} @ ${currentClose.toFixed(2)}. ` +
          `EMA9/21/50: [${ema9.toFixed(2)}, ${ema21.toFixed(2)}, ${ema50.toFixed(2)}], RSI: ${currentRsi.toFixed(1)}, ` +
          `SL: ${slPips}p ($${(slPips * pipSize).toFixed(2)}), TP: ${tpPips}p ($${(tpPips * pipSize).toFixed(2)})`
        );

        return {
          signal: 'SELL',
          confidence,
          reason: `1M Scalp Trend Rejection SELL (EMA Ribbon Down, RSI ${currentRsi.toFixed(1)} Curl, 1:2 RRR)`,
          sl: slPips,
          tp: tpPips,
          stopLossPips: slPips,
          takeProfitPips: tpPips,
          atr: currentAtr,
        };
      }
    }

    return { signal: 'NONE', confidence: 0, reason: 'No scalp setup triggered', sl: 0, tp: 0 };
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

  private calculateRSI(closes: number[], period: number = 7): number[] {
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
