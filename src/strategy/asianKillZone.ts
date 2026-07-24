import { Strategy, Candle, MarketContext, Signal } from './strategy.interface';
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

    // Initial SMA for first EMA seed
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += closes[i];
    }
    emaValues[period - 1] = sum / period;

    // Calculate EMA values
    for (let i = period; i < closes.length; i++) {
      emaValues[i] = closes[i] * k + emaValues[i - 1] * (1 - k);
    }

    return emaValues;
  }

  /**
   * Identifies Asian Session High & Low from candles between 00:00 and 08:00 UTC
   */
  private getAsianSessionRange(candles: Candle[], referenceTime: string): { asiaHigh: number; asiaLow: number } | null {
    // Use the current candle's date as reference (not wall-clock time)
    // so backtesting with historical/synthetic candles works correctly
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

  public onCandle(candle: Candle, context: MarketContext): Signal | null {
    const candles = context.historicalCandles;
    if (candles.length < this.emaPeriod + 10) return null;

    const instrument = candle.instrument;
    const isXau = instrument.includes('XAU');
    const isJpy = instrument.includes('JPY');

    // ------------------------------------------------------------------
    // TIMELINE CONSTRAINT: Entries trigger ONLY AFTER 11:30 AM (06:00 UTC)
    // ------------------------------------------------------------------
    const candleDate = new Date(candle.time);
    const utcHours = candleDate.getUTCHours();
    const utcMinutes = candleDate.getUTCMinutes();
    const totalUtcMinutes = utcHours * 60 + utcMinutes;

    // 06:00 UTC = 11:30 AM IST (360 UTC minutes)
    if (totalUtcMinutes < 360) {
      return null; // Before 11:30 AM — collect Asian range only, do not enter
    }

    // Identify Asian Session High & Low
    const asianRange = this.getAsianSessionRange(candles, candle.time);
    if (!asianRange) return null;

    const { asiaHigh, asiaLow } = asianRange;

    // Calculate 5-10 point zone buffer
    const zoneBuffer = isXau ? 2.5 : (isJpy ? 0.25 : 0.0025);
    const highZoneLow = asiaHigh - zoneBuffer;
    const lowZoneHigh = asiaLow + zoneBuffer;

    // Calculate 50 EMA
    const closes = candles.map((c) => c.close);
    const emaValues = this.calculateEMA(closes, this.emaPeriod);
    if (emaValues.length < 2) return null;

    const currentEma = emaValues[emaValues.length - 1];

    const currentCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];

    // Risk-to-Reward calculation: 1:2 TP1 (50% partial), 1:3 TP2 (100% full exit)
    // Stop Loss = 20 pips ($2.00 on Gold / 200 points), TP1 = 40 pips (1:2), TP2 = 60 pips (1:3)
    const stopLossPips = isXau ? 200 : 20;
    const tp1Pips = isXau ? 400 : 40; // 1:2 RRR
    const tp2Pips = isXau ? 600 : 60; // 1:3 RRR
    const takeProfitPips = tp2Pips;

    // ------------------------------------------------------------------
    // BUY SETUP: Liquidity Sweep of Asian Low Zone + 50 EMA Bullish Rejection
    // ------------------------------------------------------------------
    const sweptLow = currentCandle.low <= lowZoneHigh || prevCandle.low <= lowZoneHigh;
    const bullishEmaRejection = currentCandle.close > currentEma && currentCandle.close > currentCandle.open;

    if (sweptLow && bullishEmaRejection) {
      if (context.activePosition?.action === 'SELL') {
        return { action: 'CLOSE', instrument, strategy: this.name };
      }
      if (!context.activePosition) {
        logger.info(
          `[${this.name}] BUY Signal generated on ${instrument} @ ${currentCandle.close}. ` +
          `Asian Low Swept: ${asiaLow.toFixed(2)}, 50 EMA: ${currentEma.toFixed(2)}`
        );
        return {
          action: 'BUY',
          instrument,
          strategy: this.name,
          requestedLots: 0.02, // Specified 0.02 Lot size
          stopLossPips,
          takeProfitPips,
          tp1Pips,
          tp2Pips,
        };
      }
    }

    // ------------------------------------------------------------------
    // SELL SETUP: Liquidity Sweep of Asian High Zone + 50 EMA Bearish Rejection
    // ------------------------------------------------------------------
    const sweptHigh = currentCandle.high >= highZoneLow || prevCandle.high >= highZoneLow;
    const bearishEmaRejection = currentCandle.close < currentEma && currentCandle.close < currentCandle.open;

    if (sweptHigh && bearishEmaRejection) {
      if (context.activePosition?.action === 'BUY') {
        return { action: 'CLOSE', instrument, strategy: this.name };
      }
      if (!context.activePosition) {
        logger.info(
          `[${this.name}] SELL Signal generated on ${instrument} @ ${currentCandle.close}. ` +
          `Asian High Swept: ${asiaHigh.toFixed(2)}, 50 EMA: ${currentEma.toFixed(2)}`
        );
        return {
          action: 'SELL',
          instrument,
          strategy: this.name,
          requestedLots: 0.02, // Specified 0.02 Lot size
          stopLossPips,
          takeProfitPips,
          tp1Pips,
          tp2Pips,
        };
      }
    }

    return null;
  }
}
