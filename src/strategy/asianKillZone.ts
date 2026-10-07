import { Strategy, Candle, MarketContext, Signal, StrategyEvaluationResult } from './strategy.interface';
import { logger } from '../logger';

export class AsianKillZoneStrategy implements Strategy {
  public readonly name = 'asian_killzone';
  private emaPeriod = 50;

  /**
   * Calculates 50-period Exponential Moving Average (50 EMA)
   */
  private calculateEMA(closes: number[], period: number): number[] {
    if (closes.length < period) return [];

    const emaValues: number[] = new Array(closes.length).fill(0);
    const k = 2 / (period + 1);

    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += closes[i];
    }
    emaValues[period - 1] = sum / period;

    for (let i = period; i < closes.length; i++) {
      emaValues[i] = closes[i] * k + emaValues[i - 1] * (1 - k);
    }

    return emaValues;
  }

  /**
   * Identifies Asian Session High & Low from candles between 00:00 and 08:00 UTC
   */
  private getAsianSessionRange(candles: Candle[], referenceTime: string): { asiaHigh: number; asiaLow: number } | null {
    const refDate = new Date(referenceTime);
    const refDateStr = refDate.toISOString().substring(0, 10);

    const asianCandles = candles.filter((c) => {
      const cDate = new Date(c.time);
      const isoDate = cDate.toISOString().substring(0, 10);
      const hours = cDate.getUTCHours();
      return isoDate === refDateStr && hours >= 0 && hours < 8;
    });

    if (asianCandles.length < 5) return null;

    let asiaHigh = -Infinity;
    let asiaLow = Infinity;

    for (const c of asianCandles) {
      if (c.high > asiaHigh) asiaHigh = c.high;
      if (c.low < asiaLow) asiaLow = c.low;
    }

    if (asiaHigh === -Infinity || asiaLow === Infinity) return null;

    return { asiaHigh, asiaLow };
  }

  public evaluate(candles: Candle[], context: MarketContext): StrategyEvaluationResult {
    if (!candles || candles.length < this.emaPeriod + 10) {
      return { signal: 'NONE', confidence: 0, reason: 'Insufficient candles for 50 EMA', sl: 0, tp: 0 };
    }

    const candle = candles[candles.length - 1];
    const instrument = candle.instrument || (context.currentQuote ? context.currentQuote.instrument : 'XAU/USD');
    const isXau = instrument.includes('XAU');
    const isJpy = instrument.includes('JPY');

    // ------------------------------------------------------------------
    // TIMELINE CONSTRAINT: Entries trigger ONLY AFTER 11:30 AM (06:00 UTC)
    // ------------------------------------------------------------------
    const candleDate = new Date(candle.time);
    const utcHours = candleDate.getUTCHours();
    const utcMinutes = candleDate.getUTCMinutes();
    const totalUtcMinutes = utcHours * 60 + utcMinutes;

    if (totalUtcMinutes < 360) {
      return { signal: 'NONE', confidence: 0, reason: 'Before 11:30 AM IST (06:00 UTC) Asian session accumulation', sl: 0, tp: 0 };
    }

    // Identify Asian Session High & Low
    const asianRange = this.getAsianSessionRange(candles, candle.time);
    if (!asianRange) {
      return { signal: 'NONE', confidence: 0, reason: 'Asian range not yet established', sl: 0, tp: 0 };
    }

    const { asiaHigh, asiaLow } = asianRange;

    // Zone buffer
    const zoneBuffer = isXau ? 2.5 : (isJpy ? 0.25 : 0.0025);
    const highZoneLow = asiaHigh - zoneBuffer;
    const lowZoneHigh = asiaLow + zoneBuffer;

    // Calculate 50 EMA
    const closes = candles.map((c) => c.close);
    const emaValues = this.calculateEMA(closes, this.emaPeriod);
    if (emaValues.length < 2) {
      return { signal: 'NONE', confidence: 0, reason: 'Unable to calculate 50 EMA', sl: 0, tp: 0 };
    }

    const currentEma = emaValues[emaValues.length - 1];
    const currentCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];

    const stopLossPips = isXau ? 200 : 20;
    const tp1Pips = isXau ? 400 : 40; // 1:2 RRR
    const tp2Pips = isXau ? 600 : 60; // 1:3 RRR

    // BUY SETUP: Liquidity Sweep of Asian Low Zone + 50 EMA Bullish Rejection
    const sweptLow = currentCandle.low <= lowZoneHigh || prevCandle.low <= lowZoneHigh;
    const bullishEmaRejection = currentCandle.close > currentEma && currentCandle.close > currentCandle.open;

    if (sweptLow && bullishEmaRejection) {
      if (context.activePosition?.action === 'SELL') {
        return { signal: 'CLOSE', confidence: 0.9, reason: 'Asian low sweep against short position', sl: 0, tp: 0 };
      }
      if (!context.activePosition) {
        logger.info(
          `[${this.name}] BUY Signal generated on ${instrument} @ ${currentCandle.close}. ` +
          `Asian Low Swept: ${asiaLow.toFixed(2)}, 50 EMA: ${currentEma.toFixed(2)}`
        );
        return {
          signal: 'BUY',
          confidence: 0.88,
          reason: `Asian Low Liquidity Sweep + 50 EMA Bullish Rejection (1:3 RRR)`,
          sl: stopLossPips,
          tp: tp2Pips,
          stopLossPips,
          takeProfitPips: tp2Pips,
          tp1Pips,
          tp2Pips,
          requestedLots: 0.02,
        };
      }
    }

    // SELL SETUP: Liquidity Sweep of Asian High Zone + 50 EMA Bearish Rejection
    const sweptHigh = currentCandle.high >= highZoneLow || prevCandle.high >= highZoneLow;
    const bearishEmaRejection = currentCandle.close < currentEma && currentCandle.close < currentCandle.open;

    if (sweptHigh && bearishEmaRejection) {
      if (context.activePosition?.action === 'BUY') {
        return { signal: 'CLOSE', confidence: 0.9, reason: 'Asian high sweep against long position', sl: 0, tp: 0 };
      }
      if (!context.activePosition) {
        logger.info(
          `[${this.name}] SELL Signal generated on ${instrument} @ ${currentCandle.close}. ` +
          `Asian High Swept: ${asiaHigh.toFixed(2)}, 50 EMA: ${currentEma.toFixed(2)}`
        );
        return {
          signal: 'SELL',
          confidence: 0.88,
          reason: `Asian High Liquidity Sweep + 50 EMA Bearish Rejection (1:3 RRR)`,
          sl: stopLossPips,
          tp: tp2Pips,
          stopLossPips,
          takeProfitPips: tp2Pips,
          tp1Pips,
          tp2Pips,
          requestedLots: 0.02,
        };
      }
    }

    return { signal: 'NONE', confidence: 0, reason: 'No Asian KillZone setup', sl: 0, tp: 0 };
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
      tp1Pips: result.tp1Pips,
      tp2Pips: result.tp2Pips,
      requestedLots: result.requestedLots,
      atr: result.atr,
    };
  }
}
