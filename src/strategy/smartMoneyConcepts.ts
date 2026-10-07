import { Strategy, Candle, MarketContext, Signal, StrategyEvaluationResult } from './strategy.interface';
import { config } from '../config';
import { computeAtr } from '../risk/volatility';
import { SymbolNormalizer } from '../utils/symbolNormalizer';
import { logger } from '../logger';

export class SmartMoneyConceptsStrategy implements Strategy {
  public readonly name = 'smc_liquidity';

  public evaluate(candles: Candle[], context: MarketContext): StrategyEvaluationResult {
    if (!candles || candles.length < 30) {
      return { signal: 'NONE', confidence: 0, reason: 'Insufficient candles for SMC FVG detection', sl: 0, tp: 0 };
    }

    const curr = candles[candles.length - 1];
    const instrument = curr.instrument || (context.currentQuote ? context.currentQuote.instrument : 'EUR/USD');
    const pipSize = SymbolNormalizer.getPipSize(instrument);
    const isGold = SymbolNormalizer.isGold(instrument);

    // Dynamic ATR TP & SL (2.5x ATR TP, 1.0x ATR SL -> 1:2.5 RRR)
    const atrs = computeAtr(candles, 14);
    const currentAtr = atrs[atrs.length - 1];
    const defaultAtr = isGold ? 2.5 : 0.0010;
    const effectiveAtr = currentAtr && currentAtr > 0 ? currentAtr : defaultAtr;

    const stopLossPips = Math.max(isGold ? 15 : 10, Math.round((effectiveAtr * 1.0) / pipSize));
    const takeProfitPips = Math.max(isGold ? 35 : 25, Math.round((effectiveAtr * 2.5) / pipSize));

    // Multi-Timeframe Trend Filter (20 SMA on Daily)
    let dailyTrend: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
    if (context.macroCandles && context.macroCandles.length >= 20) {
      const sum = context.macroCandles.slice(-20).reduce((acc, c) => acc + c.close, 0);
      const dailySma = sum / 20;
      const latestDailyClose = context.macroCandles[context.macroCandles.length - 1].close;
      dailyTrend = latestDailyClose > dailySma ? 'UP' : 'DOWN';
    }

    const len = candles.length;

    // Scan recent 10 candles for unmitigated Fair Value Gaps (FVG)
    for (let i = len - 8; i < len - 2; i++) {
      const c1 = candles[i - 2];
      const c2 = candles[i - 1];
      const c3 = candles[i];

      const isBullishFVG = c1.high < c3.low && c2.close > c2.open && (c2.high - c2.low) > (c1.high - c1.low) * 1.3;
      const mtfBuyAllowed = !config.ENABLE_STRICT_MTF_GATE || dailyTrend !== 'DOWN';
      if (isBullishFVG && mtfBuyAllowed) {
        const fvgBottom = c1.high;
        const fvgTop = c3.low;

        // Retest / Mitigation Condition: Current candle dips into the FVG zone and prints bullish rejection
        const testedGap = curr.low <= fvgTop && curr.low >= (fvgBottom - effectiveAtr * 0.2);
        const bullishRejection = curr.close > curr.open && curr.close > fvgBottom;

        if (testedGap && bullishRejection) {
          if (context.activePosition?.action === 'SELL') {
            return { signal: 'CLOSE', confidence: 0.88, reason: 'Bullish FVG mitigation against short', sl: 0, tp: 0 };
          }
          if (!context.activePosition) {
            const confidence = dailyTrend === 'UP' ? 0.88 : 0.78;
            logger.info(`[SMC FVG SCALP] Bullish FVG Retest confirmed on ${instrument} @ ${curr.close.toFixed(2)}. SL: ${stopLossPips}p, TP: ${takeProfitPips}p [1:2.5 RRR]`);
            return {
              signal: 'BUY',
              confidence,
              reason: 'Bullish SMC Fair Value Gap Retest Mitigation BUY (1:2.5 RRR)',
              sl: stopLossPips,
              tp: takeProfitPips,
              stopLossPips,
              takeProfitPips,
              atr: effectiveAtr,
            };
          }
        }
      }

      // Bearish FVG: c1.low > c3.high with strong displacement in c2
      const isBearishFVG = c1.low > c3.high && c2.close < c2.open && (c2.high - c2.low) > (c1.high - c1.low) * 1.3;
      const mtfSellAllowed = !config.ENABLE_STRICT_MTF_GATE || dailyTrend !== 'UP';
      if (isBearishFVG && mtfSellAllowed) {
        const fvgTop = c1.low;
        const fvgBottom = c3.high;

        // Retest / Mitigation Condition: Current candle rallies into the FVG zone and prints bearish rejection
        const testedGap = curr.high >= fvgBottom && curr.high <= (fvgTop + effectiveAtr * 0.2);
        const bearishRejection = curr.close < curr.open && curr.close < fvgTop;

        if (testedGap && bearishRejection) {
          if (context.activePosition?.action === 'BUY') {
            return { signal: 'CLOSE', confidence: 0.88, reason: 'Bearish FVG mitigation against long', sl: 0, tp: 0 };
          }
          if (!context.activePosition) {
            const confidence = dailyTrend === 'DOWN' ? 0.88 : 0.78;
            logger.info(`[SMC FVG SCALP] Bearish FVG Retest confirmed on ${instrument} @ ${curr.close.toFixed(2)}. SL: ${stopLossPips}p, TP: ${takeProfitPips}p [1:2.5 RRR]`);
            return {
              signal: 'SELL',
              confidence,
              reason: 'Bearish SMC Fair Value Gap Retest Mitigation SELL (1:2.5 RRR)',
              sl: stopLossPips,
              tp: takeProfitPips,
              stopLossPips,
              takeProfitPips,
              atr: effectiveAtr,
            };
          }
        }
      }
    }

    return { signal: 'NONE', confidence: 0, reason: 'No unmitigated FVG pattern found', sl: 0, tp: 0 };
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
