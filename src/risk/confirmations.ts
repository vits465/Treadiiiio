import { Candle } from '../data/priceFeed';

/**
 * Rule-confirmation gate for ML signals.
 *
 * Three deterministic rule families — SMA(3/8) crossover, RSI(14) zone,
 * and Bollinger(20,2) band position — mirror the three shipped rule strategies.
 * An ML signal must receive agreement from at least ML_MIN_RULE_CONFIRMATIONS
 * of these families before it is allowed to open a position.
 *
 * CLOSE signals bypass this gate — exits are never blocked.
 */

// ---------------------------------------------------------------------------
// SMA helpers
// ---------------------------------------------------------------------------
function sma(closes: number[], period: number): number {
  if (closes.length < period) return 0;
  const slice = closes.slice(closes.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * SMA(3/8) trend stance.
 * BUY  = fast MA above slow MA (uptrend)
 * SELL = fast MA below slow MA (downtrend)
 */
export function smaTrendStance(candles: Candle[]): 'BUY' | 'SELL' | 'NEUTRAL' {
  if (candles.length < 8) return 'NEUTRAL';
  const closes = candles.map((c) => c.close);
  const fast = sma(closes, 3);
  const slow = sma(closes, 8);
  if (fast > slow) return 'BUY';
  if (fast < slow) return 'SELL';
  return 'NEUTRAL';
}

// ---------------------------------------------------------------------------
// RSI helpers
// ---------------------------------------------------------------------------
function calcRsi(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50; // neutral fallback

  let sumGains = 0;
  let sumLosses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) sumGains += diff;
    else sumLosses -= diff;
  }

  let avgGain = sumGains / period;
  let avgLoss = sumLosses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * RSI(14) zone stance.
 * BUY  = RSI < 50 (bullish bias / coming from oversold)
 * SELL = RSI > 50 (bearish bias / coming from overbought)
 */
export function rsiZoneStance(candles: Candle[]): 'BUY' | 'SELL' | 'NEUTRAL' {
  if (candles.length < 15) return 'NEUTRAL';
  const closes = candles.map((c) => c.close);
  const rsi = calcRsi(closes, 14);
  if (rsi > 50) return 'BUY';
  if (rsi < 50) return 'SELL';
  return 'NEUTRAL';
}

// ---------------------------------------------------------------------------
// Bollinger Band helpers
// ---------------------------------------------------------------------------
function bollingerBands(
  closes: number[],
  period: number,
  stdDevMult: number
): { upper: number; middle: number; lower: number } {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0 };
  const slice = closes.slice(closes.length - period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((acc, v) => acc + Math.pow(v - middle, 2), 0) / period;
  const sd = Math.sqrt(variance);
  return {
    upper: middle + stdDevMult * sd,
    middle,
    lower: middle - stdDevMult * sd,
  };
}

/**
 * Bollinger(20,2) band-position stance.
 * BUY  = price in upper half of band (momentum)
 * SELL = price in lower half of band (bearish)
 */
export function bollingerStance(candles: Candle[]): 'BUY' | 'SELL' | 'NEUTRAL' {
  if (candles.length < 20) return 'NEUTRAL';
  const closes = candles.map((c) => c.close);
  const { upper, lower, middle } = bollingerBands(closes, 20, 2);
  const price = closes[closes.length - 1];
  if (price > middle) return 'BUY';
  if (price < middle) return 'SELL';
  return 'NEUTRAL';
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------
export interface RuleConfirmationResult {
  passed: boolean;
  agreementCount: number;
  details: string;
}

/**
 * Checks how many of the three rule families agree with the ML signal direction.
 * Supports both trend/momentum alignment and extreme mean-reversion setups for BOTH BUY and SELL.
 */
export function checkRuleConfirmations(
  action: 'BUY' | 'SELL',
  candles: Candle[],
  minConfirmations: number = 1
): RuleConfirmationResult {
  if (candles.length < 20) {
    return { passed: true, agreementCount: 3, details: 'Insufficient candles for gate; bypassed.' };
  }

  const closes = candles.map((c) => c.close);
  const smaStance = smaTrendStance(candles);
  const rsi = calcRsi(closes, 14);
  const { upper, lower, middle } = bollingerBands(closes, 20, 2);
  const price = closes[closes.length - 1];

  // 1. SMA Trend agreement
  const smaAgrees = smaStance === action;

  // 2. RSI agreement:
  // For BUY: Bullish momentum (RSI >= 48) OR oversold bounce (RSI <= 35)
  // For SELL: Bearish momentum (RSI <= 52) OR overbought rejection (RSI >= 65)
  const rsiAgrees = action === 'BUY'
    ? (rsi >= 48 || rsi <= 35)
    : (rsi <= 52 || rsi >= 65);

  // 3. Bollinger Band agreement:
  // For BUY: Trading in upper half (price >= middle) OR lower band bounce (price <= lower * 1.002)
  // For SELL: Trading in lower half (price <= middle) OR upper band rejection (price >= upper * 0.998)
  const bbAgrees = action === 'BUY'
    ? (price >= middle || price <= lower * 1.002)
    : (price <= middle || price >= upper * 0.998);

  const stances = [
    { name: 'SMA(3/8)', agreed: smaAgrees, stance: smaStance },
    { name: 'RSI(14)', agreed: rsiAgrees, stance: `RSI=${rsi.toFixed(1)}` },
    { name: 'BB(20,2)', agreed: bbAgrees, stance: price >= middle ? 'UPPER_ZONE' : 'LOWER_ZONE' },
  ];

  const agreementCount = stances.filter((s) => s.agreed).length;
  const passed = agreementCount >= minConfirmations;

  const details =
    stances.map((s) => `${s.name}(${s.agreed ? 'AGREE' : 'DISAGREE'})`).join(', ') +
    ` | ML=${action} → agreements=${agreementCount}/${stances.length}`;

  return { passed, agreementCount, details };
}
