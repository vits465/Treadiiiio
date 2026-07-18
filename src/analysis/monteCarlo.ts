import { db } from '../db';
import { config } from '../config';

export interface MonteCarloResult {
  method: 'bootstrap' | 'shuffle';
  sampleSize: number;
  targetProbability: number;
  circuitBreakerProbability: number;
  medianCurve: number[];
  p5Curve: number[];
  p95Curve: number[];
  // Drawdown distribution across simulations
  medianMaxDrawdown: number;
  p95MaxDrawdown: number;
  worstMaxDrawdown: number;
}

// ---------------------------------------------------------------------------
// Seeded RNG — mulberry32 for reproducible runs
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  return function (): number {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Computes max drawdown % for a balance curve.
 */
function maxDrawdownPct(curve: number[]): number {
  let peak = curve[0];
  let maxDD = 0;
  for (const v of curve) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

/**
 * runMonteCarlo — two simulation methods:
 *
 *   bootstrap (default)
 *     Resample actual trade returns WITH REPLACEMENT over `numTrades` future
 *     steps.  "What might the next N trades look like given this distribution?"
 *
 *   shuffle
 *     Permute the actual trade sequence WITHOUT replacement.  Each simulation
 *     is exactly the length of the historical trade count.
 *     "Was the observed equity curve just a lucky ordering?"
 *
 * Both report the drawdown distribution (median, p95, worst) across simulations
 * so thin data is visible and tail risk is quantified, not just averages.
 * All previous response fields are preserved for dashboard compatibility.
 */
export function runMonteCarlo(
  targetBalance: number,
  numTrades: number = 200,
  numSimulations: number = 1000,
  method: 'bootstrap' | 'shuffle' = 'bootstrap',
  seed: number = 42
): MonteCarloResult {
  const rng = mulberry32(seed);

  // Get all closed trades
  const trades = db.prepare(`
    SELECT pnl
    FROM trades
    WHERE status = 'CLOSED'
    ORDER BY entry_time ASC
  `).all() as { pnl: number }[];

  const startBalance = config.STARTING_BALANCE;
  const sampleSize = trades.length;

  const flatCurve = new Array(numTrades + 1).fill(startBalance);
  if (trades.length < 10) {
    return {
      method,
      sampleSize,
      targetProbability: 0,
      circuitBreakerProbability: 0,
      medianCurve: [...flatCurve],
      p5Curve: [...flatCurve],
      p95Curve: [...flatCurve],
      medianMaxDrawdown: 0,
      p95MaxDrawdown: 0,
      worstMaxDrawdown: 0,
    };
  }

  // Convert historical PnLs to percentage returns based on starting balance
  const returns = trades.map((t) => t.pnl / startBalance);
  const circuitBreakerLevel = startBalance * (1 - config.RISK_MAX_DRAWDOWN_PCT / 100);

  const allCurves: number[][] = [];
  const allMaxDrawdowns: number[] = [];
  let successCount = 0;
  let failureCount = 0;

  const simLength = method === 'shuffle' ? returns.length : numTrades;

  for (let s = 0; s < numSimulations; s++) {
    let balance = startBalance;
    const curve = [balance];
    let cbHit = false;
    let sequence: number[];

    if (method === 'bootstrap') {
      // Sample with replacement
      sequence = Array.from({ length: simLength }, () => returns[Math.floor(rng() * returns.length)]);
    } else {
      // Fisher-Yates shuffle (permutation without replacement)
      const copy = [...returns];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      sequence = copy;
    }

    for (let t = 0; t < sequence.length; t++) {
      balance += balance * sequence[t];
      curve.push(balance);

      if (balance <= circuitBreakerLevel && !cbHit) {
        cbHit = true;
        // Pad the rest of the curve with the broken level
        for (let j = t + 1; j < simLength; j++) {
          curve.push(balance);
        }
        break;
      }
    }

    allCurves.push(curve);
    allMaxDrawdowns.push(maxDrawdownPct(curve));

    if (cbHit) {
      failureCount++;
    } else if (balance >= targetBalance) {
      successCount++;
    }
  }

  // Calculate percentile equity curves (pad shorter shuffle curves to numTrades length)
  const paddedLen = numTrades + 1;
  const p5Curve: number[] = [];
  const medianCurve: number[] = [];
  const p95Curve: number[] = [];

  for (let t = 0; t < paddedLen; t++) {
    const balancesAtT = allCurves
      .map((c) => (t < c.length ? c[t] : c[c.length - 1]))
      .sort((a, b) => a - b);
    p5Curve.push(parseFloat(balancesAtT[Math.floor(numSimulations * 0.05)].toFixed(2)));
    medianCurve.push(parseFloat(balancesAtT[Math.floor(numSimulations * 0.50)].toFixed(2)));
    p95Curve.push(parseFloat(balancesAtT[Math.floor(numSimulations * 0.95)].toFixed(2)));
  }

  // Drawdown distribution
  const sortedDDs = [...allMaxDrawdowns].sort((a, b) => a - b);
  const medianMaxDrawdown = parseFloat(sortedDDs[Math.floor(numSimulations * 0.50)].toFixed(2));
  const p95MaxDrawdown    = parseFloat(sortedDDs[Math.floor(numSimulations * 0.95)].toFixed(2));
  const worstMaxDrawdown  = parseFloat(sortedDDs[numSimulations - 1].toFixed(2));

  return {
    method,
    sampleSize,
    targetProbability: parseFloat((successCount / numSimulations * 100).toFixed(2)),
    circuitBreakerProbability: parseFloat((failureCount / numSimulations * 100).toFixed(2)),
    medianCurve,
    p5Curve,
    p95Curve,
    medianMaxDrawdown,
    p95MaxDrawdown,
    worstMaxDrawdown,
  };
}
