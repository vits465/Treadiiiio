import { db } from '../db';
import { config } from '../config';

export interface MonteCarloResult {
  targetProbability: number;
  circuitBreakerProbability: number;
  medianCurve: number[];
  p5Curve: number[];
  p95Curve: number[];
}

export function runMonteCarlo(
  targetBalance: number,
  numTrades: number = 200,
  numSimulations: number = 1000
): MonteCarloResult {
  // Get all closed trades
  const trades = db.prepare(`
    SELECT pnl
    FROM trades
    WHERE status = 'CLOSED'
  `).all() as { pnl: number }[];

  const startBalance = config.STARTING_BALANCE;

  if (trades.length < 10) {
    // Not enough data to run a meaningful simulation
    const flatCurve = new Array(numTrades + 1).fill(startBalance);
    return {
      targetProbability: 0,
      circuitBreakerProbability: 0,
      medianCurve: [...flatCurve],
      p5Curve: [...flatCurve],
      p95Curve: [...flatCurve],
    };
  }

  // Convert historical PnLs to percentage returns based on starting balance
  // This assumes the historical trades were taken with roughly constant risk % relative to balance.
  const returns = trades.map(t => t.pnl / startBalance);

  let successCount = 0;
  let failureCount = 0;
  const circuitBreakerLevel = startBalance * (1 - config.RISK_MAX_DRAWDOWN_PCT / 100);

  const allCurves: number[][] = [];

  for (let i = 0; i < numSimulations; i++) {
    let balance = startBalance;
    const curve = [balance];
    let cbHit = false;

    for (let t = 0; t < numTrades; t++) {
      // Randomly sample a historical return with replacement
      const randIdx = Math.floor(Math.random() * returns.length);
      const ret = returns[randIdx];

      // Apply return to current balance
      balance += balance * ret;
      curve.push(balance);

      if (balance <= circuitBreakerLevel) {
        cbHit = true;
        // Pad the rest of the curve with the broken level
        for (let j = t + 1; j < numTrades; j++) {
           curve.push(balance);
        }
        break;
      }
    }

    allCurves.push(curve);

    if (cbHit) {
      failureCount++;
    } else if (balance >= targetBalance) {
      successCount++;
    }
  }

  // Calculate percentiles
  const p5Curve: number[] = [];
  const medianCurve: number[] = [];
  const p95Curve: number[] = [];

  for (let t = 0; t <= numTrades; t++) {
    const balancesAtT = allCurves.map(c => c[t]).sort((a, b) => a - b);
    p5Curve.push(parseFloat(balancesAtT[Math.floor(numSimulations * 0.05)].toFixed(2)));
    medianCurve.push(parseFloat(balancesAtT[Math.floor(numSimulations * 0.50)].toFixed(2)));
    p95Curve.push(parseFloat(balancesAtT[Math.floor(numSimulations * 0.95)].toFixed(2)));
  }

  return {
    targetProbability: parseFloat((successCount / numSimulations * 100).toFixed(2)),
    circuitBreakerProbability: parseFloat((failureCount / numSimulations * 100).toFixed(2)),
    medianCurve,
    p5Curve,
    p95Curve
  };
}
