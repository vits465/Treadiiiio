import { Candle } from '../data/priceFeed';

/**
 * Computes the 14-period ATR (Wilder's smoothed average) for a candle array.
 * Returns an array of the same length; the first `period - 1` entries are 0.
 */
export function computeAtr(candles: Candle[], period: number = 14): number[] {
  const result = new Array(candles.length).fill(0);
  if (candles.length < period + 1) return result;

  // Seed with simple average of first `period` true ranges
  let sumTR = 0;
  for (let i = 1; i <= period; i++) {
    const tr = trueRange(candles[i], candles[i - 1]);
    sumTR += tr;
  }

  let atr = sumTR / period;
  result[period] = atr;

  // Wilder smoothing
  for (let i = period + 1; i < candles.length; i++) {
    const tr = trueRange(candles[i], candles[i - 1]);
    atr = (atr * (period - 1) + tr) / period;
    result[i] = atr;
  }

  return result;
}

function trueRange(current: Candle, prev: Candle): number {
  return Math.max(
    current.high - current.low,
    Math.abs(current.high - prev.close),
    Math.abs(current.low - prev.close)
  );
}

/**
 * Computes the percentile rank (0–1) of the most-recent ATR value within its
 * own distribution over `lookbackPeriod` bars.
 *
 * Returns `undefined` when there is insufficient history (< 3 × period candles)
 * so callers can gracefully skip the volatility scalar rather than guessing.
 *
 * NOTE: The spec's literal formula `min(1, 1/atr_percentile)` is a
 * mathematical no-op — for any percentile ≤ 1, 1/percentile ≥ 1, so the
 * min(1,·) always returns 1 and nothing ever shrinks.  The intended *effect*
 * (reduce size in high-volatility regimes) is achieved by the caller using the
 * ratio `SIZING_VOL_TARGET_PERCENTILE / atr_percentile` instead.
 */
export function computeAtrPercentile(
  candles: Candle[],
  atrPeriod: number = 14,
  lookbackPeriod: number = 100
): number | undefined {
  const minRequired = 3 * atrPeriod;
  if (candles.length < minRequired) return undefined;

  const atrs = computeAtr(candles, atrPeriod);
  const currentAtr = atrs[atrs.length - 1];
  if (currentAtr === 0) return undefined;

  // Gather the lookback window of non-zero ATR values
  const start = Math.max(atrPeriod, candles.length - lookbackPeriod);
  const window: number[] = [];
  for (let i = start; i < atrs.length; i++) {
    if (atrs[i] > 0) window.push(atrs[i]);
  }

  if (window.length < 3) return undefined;

  const sorted = [...window].sort((a, b) => a - b);
  // Count values strictly less than currentAtr
  let rank = sorted.filter((v) => v < currentAtr).length;
  // Percentile rank in [0, 1]
  return rank / sorted.length;
}
