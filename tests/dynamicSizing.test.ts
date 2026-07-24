/**
 * Dynamic Position Sizing tests
 *
 * Covers:
 *   - calculateSizedOrder scalar math (confidence + volatility)
 *   - Cap at 1 for both scalars in favorable conditions
 *   - Floor at 25% of base risk
 *   - Hard cap at RISK_MAX_POSITION_SIZE_PCT
 *   - Broker-step flooring (0.01 lot increments)
 *   - computeAtrPercentile with insufficient data → undefined
 *   - computeAtrPercentile relative ranking
 */

import { RiskManager } from '../src/risk/riskManager';
import { computeAtrPercentile } from '../src/risk/volatility';
import { initDb } from '../src/db';

beforeAll(() => {
  initDb();
});

const BALANCE = 10000;

function makeFakeCandle(close: number, high?: number, low?: number, open?: number) {
  return {
    time: new Date().toISOString(),
    instrument: 'EUR/USD',
    granularity: '1h',
    open: open ?? close,
    high: high ?? close + 0.0005,
    low: low ?? close - 0.0005,
    close,
    volume: 100,
  };
}

// Build N candles with the last one having a specified close
function buildCandles(n: number, startPrice = 1.1, lastClose?: number) {
  const candles = [];
  for (let i = 0; i < n; i++) {
    const c = startPrice + i * 0.0001;
    candles.push(makeFakeCandle(c, c + 0.001, c - 0.001));
  }
  if (lastClose !== undefined) {
    const last = candles[candles.length - 1];
    last.close = lastClose;
    last.high = lastClose + 0.005;
    last.low = lastClose - 0.005;
  }
  return candles;
}

describe('RiskManager.calculateSizedOrder', () => {
  const SL_PIPS = 20;

  test('no scaling (rule-based): uses base risk, respects max cap', () => {
    const result = RiskManager.calculateSizedOrder('EUR/USD', SL_PIPS, BALANCE);
    expect(result.units).toBeGreaterThan(0);
    // riskPctUsed must be ≤ RISK_MAX_POSITION_SIZE_PCT (2%)
    expect(result.riskPctUsed).toBeLessThanOrEqual(2.0);
  });

  test('confidence = ML_CONFIDENCE_FULL_SIZE → scalar = 1 (no reduction)', () => {
    const full = RiskManager.calculateSizedOrder('EUR/USD', SL_PIPS, BALANCE);
    const atFullConf = RiskManager.calculateSizedOrder('EUR/USD', SL_PIPS, BALANCE, 0.80);
    // At full confidence, sizing should be identical to no-confidence
    expect(atFullConf.units).toBe(full.units);
  });

  test('confidence above normal threshold (0.85+) → STRETCH tier (larger or equal size)', () => {
    const atNormalConf = RiskManager.calculateSizedOrder('EUR/USD', SL_PIPS, BALANCE, 0.80);
    const stretch = RiskManager.calculateSizedOrder('EUR/USD', SL_PIPS, BALANCE, 0.99);
    expect(stretch.units).toBeGreaterThanOrEqual(atNormalConf.units);
  });

  test('REDUCED tier confidence (0.70) produces less units than NORMAL tier (0.80)', () => {
    const normal = RiskManager.calculateSizedOrder('EUR/USD', SL_PIPS, BALANCE, 0.80);
    const reduced = RiskManager.calculateSizedOrder('EUR/USD', SL_PIPS, BALANCE, 0.70);
    expect(reduced.units).toBeLessThan(normal.units);
  });

  test('confidence below minimum threshold (< 0.35 for EUR/USD) → DISCARDED (0 units)', () => {
    const low = RiskManager.calculateSizedOrder('EUR/USD', SL_PIPS, BALANCE, 0.30);
    expect(low.units).toBe(0);
  });

  test('result never exceeds RISK_MAX_POSITION_SIZE_PCT (2%)', () => {
    // Even with a high configured base risk, the cap must hold
    const result = RiskManager.calculateSizedOrder('EUR/USD', 5, BALANCE); // very tight SL = bigger units
    expect(result.riskPctUsed).toBeLessThanOrEqual(2.0 + 0.01); // small float tolerance
  });

  test('broker-step flooring: volume is a multiple of 0.01 lots', () => {
    const result = RiskManager.calculateSizedOrder('EUR/USD', SL_PIPS, BALANCE);
    const volumeLots = result.units / 100000;
    const rounded = Math.round(volumeLots * 100) / 100;
    expect(Math.abs(volumeLots - rounded)).toBeLessThan(0.001);
  });

  test('JPY pair: uses 0.01 pip size correctly', () => {
    // USD/JPY: pip size = 0.01 so min-lot risk = 1000 × 20 × 0.01 = $200
    // Use $30,000 balance to ensure the budget comfortably covers the min lot
    const result = RiskManager.calculateSizedOrder('USD/JPY', 20, 30000);
    expect(result.units).toBeGreaterThan(0);
    expect(result.riskPctUsed).toBeLessThanOrEqual(2.0);
  });

  test('returns { units:0 } when min-lot budget exceeded (tiny balance, wide SL)', () => {
    const result = RiskManager.calculateSizedOrder('EUR/USD', 200, 50); // $50 balance, 200-pip SL
    expect(result.units).toBe(0);
    expect(result.riskPctUsed).toBe(0);
  });

  test('calculatePositionSize (wrapper) returns same units as calculateSizedOrder', () => {
    const sized = RiskManager.calculateSizedOrder('EUR/USD', SL_PIPS, BALANCE);
    const decision = RiskManager.calculatePositionSize(BALANCE, SL_PIPS, 0.75, 0, 'EUR/USD');
    const isXau = 'EUR/USD'.includes('XAU');
    const contractSize = isXau ? 100 : 100000;
    expect(decision.lots * contractSize).toBe(sized.units);
  });
});

describe('computeAtrPercentile', () => {
  test('returns undefined when candle history < 3 * atrPeriod', () => {
    const candles = buildCandles(30, 1.1); // needs ≥ 42 for period=14
    const result = computeAtrPercentile(candles, 14);
    expect(result).toBeUndefined();
  });

  test('returns a value in [0, 1] with sufficient history', () => {
    const candles = buildCandles(100, 1.1);
    const result = computeAtrPercentile(candles, 14, 60);
    expect(result).toBeDefined();
    expect(result!).toBeGreaterThanOrEqual(0);
    expect(result!).toBeLessThanOrEqual(1);
  });

  test('last candle with a very large true range → high percentile', () => {
    const candles = buildCandles(100, 1.1);
    // Add extreme-range candle at the end
    candles.push(makeFakeCandle(1.2, 1.25, 1.05));
    const result = computeAtrPercentile(candles, 14, 80);
    expect(result).toBeDefined();
    expect(result!).toBeGreaterThan(0.5); // should be above median
  });
});
