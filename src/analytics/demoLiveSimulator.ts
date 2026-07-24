export interface TradeRecord {
  pnl: number;
  entryPrice: number;
  exitPrice: number;
  action: 'BUY' | 'SELL';
  instrument: string;
  units: number;
  slippagePips?: number;
}

export interface SimulationResult {
  totalPnl: number;
  winPct: number;
  avgSlippagePips: number;
  maxDrawdownPct: number;
  sharpe: number;
  verdict: string;
}

export interface SimulatorReport {
  demoResults: SimulationResult;
  simulatedPessimistic: SimulationResult;
  simulatedRealistic: SimulationResult;
  simulatedOptimistic: SimulationResult;
  recommendation: string;
}

interface ScenarioParams {
  entrySlippage: number;
  exitSlippage: number;
  rejectionRate: number;
  spreadSpikeRate: number;
  spreadSpikePips: number;
}

export class DemoLiveSimulator {
  private static readonly PIP_MULTIPLIER = {
    'EUR/USD': 10000,
    'GBP/USD': 10000,
    'USD/JPY': 100,
    'XAU/USD': 10, // Assuming 1 pip = $0.10 standard for XAU for normalization purposes, but varies by broker. Usually 0.1 or 0.01
  };

  private static getPipValue(instrument: string, pnl: number, entry: number, exit: number, action: string, units: number): number {
      if (units === 0) return 0;
      // Reverse-engineer pip value from PnL
      const priceDiff = Math.abs(exit - entry);
      if (priceDiff === 0) return 0;
      return pnl / priceDiff; 
  }

  public static runSimulation(trades: TradeRecord[], startingBalance: number): SimulatorReport {
    // 1. Calculate Demo Results
    const demoResults = this.simulateScenario(trades, startingBalance, {
      entrySlippage: 0,
      exitSlippage: 0,
      rejectionRate: 0,
      spreadSpikeRate: 0,
      spreadSpikePips: 0
    });

    if (trades.length === 0) {
        demoResults.verdict = 'Not enough trades.';
        return {
            demoResults,
            simulatedPessimistic: demoResults,
            simulatedRealistic: demoResults,
            simulatedOptimistic: demoResults,
            recommendation: 'Not enough data.'
        };
    }

    demoResults.verdict = 'Demo baseline.';

    // 2. Pessimistic Scenario
    const pessimistic = this.simulateScenario(trades, startingBalance, {
      entrySlippage: 1.0,
      exitSlippage: 0.5,
      rejectionRate: 0.10,
      spreadSpikeRate: 0.30,
      spreadSpikePips: 2.0
    });
    
    if (pessimistic.totalPnl < 0 || pessimistic.sharpe < 0.4) {
      pessimistic.verdict = "FAIL — edge disappears with real-money conditions.";
    } else {
      pessimistic.verdict = "PASS — edge is exceptionally robust.";
    }

    // 3. Realistic Scenario
    const realistic = this.simulateScenario(trades, startingBalance, {
      entrySlippage: 0.7,
      exitSlippage: 0.3,
      rejectionRate: 0.05,
      spreadSpikeRate: 0.20,
      spreadSpikePips: 1.5
    });

    if (realistic.totalPnl < 0) {
      realistic.verdict = "FAIL — edge is too thin for real money.";
    } else if (realistic.sharpe < 0.6) {
      realistic.verdict = "CAUTION — edge exists but thin. Small mistakes (bad entry/exit) will destroy it.";
    } else {
      realistic.verdict = "PASS — solid edge under expected real-money friction.";
    }

    // 4. Optimistic Scenario
    const optimistic = this.simulateScenario(trades, startingBalance, {
      entrySlippage: 0.3,
      exitSlippage: 0.1,
      rejectionRate: 0.02,
      spreadSpikeRate: 0.05,
      spreadSpikePips: 0.5
    });
    
    optimistic.verdict = optimistic.totalPnl > 0 ? "PASS — if broker is good, this should work." : "FAIL — structural strategy issue.";

    // Provide final recommendation
    let recommendation = "";
    if (realistic.totalPnl < 0) {
        recommendation = "Do NOT fund. The strategy is over-optimized for demo execution and will lose real money. Keep tuning.";
    } else if (realistic.sharpe < 0.6) {
        recommendation = "Only fund if you negotiate tight spreads with your real broker. Otherwise, stay on demo 2 more weeks to improve edge.";
    } else if (trades.length < 30) {
        recommendation = "Edge looks strong, but sample size is too small (<30 trades). Gather more data before funding.";
    } else {
        recommendation = "Edge is proven and robust against slippage. Proceed to Phase 1 Live Trading with small capital.";
    }

    return {
      demoResults,
      simulatedPessimistic: pessimistic,
      simulatedRealistic: realistic,
      simulatedOptimistic: optimistic,
      recommendation
    };
  }

  private static simulateScenario(trades: TradeRecord[], startingBalance: number, params: ScenarioParams): SimulationResult {
    if (trades.length === 0) {
      return { totalPnl: 0, winPct: 0, avgSlippagePips: 0, maxDrawdownPct: 0, sharpe: 0, verdict: '' };
    }

    let currentEquity = startingBalance;
    let peakEquity = startingBalance;
    let maxDrawdownPct = 0;
    let totalPnl = 0;
    let wins = 0;
    let totalSlippagePips = 0;
    
    const dailyReturns: number[] = [];
    // Approximate daily returns by chunking every N trades, or just treat each trade as a "period" for Sharpe calculation if no timestamps.
    // We will use trade-by-trade returns for the variance calculation.
    
    for (let i = 0; i < trades.length; i++) {
      const trade = trades[i];
      
      // Rejection simulator
      // We use a deterministic pseudo-random check based on index so tests are repeatable
      const pseudoRand = (i * 997) % 100 / 100;
      let isRejected = false;
      let requotePenalty = 0;
      
      if (pseudoRand < params.rejectionRate) {
          // Re-enter at worse price
          isRejected = true;
          requotePenalty = 0.5; // pips
      }

      // Spread spike simulator
      let spreadPenalty = 0;
      const pseudoRandSpread = (i * 991) % 100 / 100;
      if (pseudoRandSpread < params.spreadSpikeRate) {
          spreadPenalty = params.spreadSpikePips;
      }

      const totalSlippage = params.entrySlippage + params.exitSlippage + requotePenalty + spreadPenalty;
      totalSlippagePips += totalSlippage;

      // Deduct slippage cost from PnL
      // pipValue = $ per price pip. 
      const pipMultiplier = trade.instrument.includes('JPY') ? 100 : (trade.instrument.includes('XAU') ? 10 : 10000);
      const pricePipValue = trade.units / pipMultiplier; // simplified approximate
      
      const pipValue = this.getPipValue(trade.instrument, trade.pnl, trade.entryPrice, trade.exitPrice, trade.action, trade.units);
      
      // pipValue here is per 1.0 price movement (e.g. $10,000). 
      // We need it per pip (e.g. $1).
      const actualPipValue = pipValue !== 0 ? Math.abs(pipValue) / pipMultiplier : Math.abs(pricePipValue);

      const slippageCost = totalSlippage * actualPipValue;
      
      // Calculate simulated PnL
      const simulatedPnl = trade.pnl - slippageCost;
      
      totalPnl += simulatedPnl;
      currentEquity += simulatedPnl;
      
      if (simulatedPnl > 0) wins++;

      // Drawdown calculation
      if (currentEquity > peakEquity) {
          peakEquity = currentEquity;
      }
      const drawdown = (peakEquity - currentEquity) / peakEquity * 100;
      if (drawdown > maxDrawdownPct) {
          maxDrawdownPct = drawdown;
      }
      
      dailyReturns.push(simulatedPnl / (currentEquity - simulatedPnl));
    }

    // Sharpe Ratio Approximation (Assuming Trade Returns roughly map to risk units)
    let sharpe = 0;
    if (dailyReturns.length > 1) {
        const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
        const variance = dailyReturns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / (dailyReturns.length - 1);
        const stdDev = Math.sqrt(variance);
        // Annualize assuming ~250 trading days, say 3 trades a day = 750 trades/year
        // We'll use a simpler raw Sharpe for direct comparison
        sharpe = stdDev === 0 ? 0 : meanReturn / stdDev;
        // Annualize roughly if we want standard numbers (sqrt(252))
        sharpe = sharpe * Math.sqrt(252); 
    }

    return {
      totalPnl: Number(totalPnl.toFixed(2)),
      winPct: Number(((wins / trades.length) * 100).toFixed(1)),
      avgSlippagePips: Number((totalSlippagePips / trades.length).toFixed(2)),
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      sharpe: Number(sharpe.toFixed(2)),
      verdict: ''
    };
  }
}
