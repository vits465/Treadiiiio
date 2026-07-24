export interface RoadmapMilestone {
  month: number;
  expectedCapital: number;
  accounts: number;
  strategies: string[];
  expectedMonthlyReturnPct: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  notes: string;
}

export interface RoadmapProjection {
  currentMonth: number;
  currentCapital: number;
  milestones: RoadmapMilestone[];
  isPaceGood: boolean; // Are we on track for the $10k goal?
}

export class ScalingRoadmap {
  /**
   * Generates a 24-month roadmap based on current capital and month index.
   * Target: $100 -> $10,000+ through compounding at 18-22% monthly with 80% reinvestment.
   */
  public static generateProjection(currentMonth: number, currentCapital: number): RoadmapProjection {
    const milestones: RoadmapMilestone[] = [];
    
    // Define the rigid theoretical path as per the MASTER PROMPT
    const theoreticalPath = [
      { month: 1, cap: 100, accounts: 1, strats: ['Trend ML'], ret: 0, note: 'Prove edge on demo (win rate >55%, Sharpe >0.6)' },
      { month: 2, cap: 100, accounts: 1, strats: ['Trend ML'], ret: 0, note: 'Accumulate 30+ trades. If edge holds, fund Phase 1.' },
      { month: 3, cap: 500, accounts: 1, strats: ['Trend ML'], ret: 18, note: 'Fund $500 live. Trade small sizes. 30+ live trades.' },
      { month: 4, cap: 590, accounts: 1, strats: ['Trend ML'], ret: 18, note: 'Maintain 18% return. Withdraw 20% of profit, reinvest 80%.' },
      { month: 5, cap: 700, accounts: 2, strats: ['Trend ML'], ret: 19, note: 'Account 2 live. Split capital.' },
      { month: 6, cap: 1200, accounts: 3, strats: ['Trend ML'], ret: 20, note: 'Add Account 3. Diversified pairs.' },
      { month: 8, cap: 2000, accounts: 3, strats: ['Trend ML', 'Scalp'], ret: 18, note: 'Scalp strategy live on 20% of capital.' },
      { month: 9, cap: 2700, accounts: 3, strats: ['Trend ML', 'Scalp'], ret: 20, note: 'Multi-strategy alive, combined Sharpe > 0.8.' },
      { month: 11, cap: 4000, accounts: 4, strats: ['Trend ML', 'Scalp', 'Volatility'], ret: 19, note: 'Volatility overlay added, portfolio Sharpe > 1.0.' },
      { month: 12, cap: 5500, accounts: 4, strats: ['Trend ML', 'Scalp', 'Volatility'], ret: 22, note: 'First $5k milestone. Validate parallel systems.' },
      { month: 18, cap: 9500, accounts: 5, strats: ['Trend ML', 'Scalp', 'Volatility', 'News'], ret: 20, note: 'Add News strategy. Target Sharpe > 1.2.' },
      { month: 24, cap: 15000, accounts: 3, strats: ['Optimized Core'], ret: 18, note: '100x achieved. Consolidate accounts.' }
    ];

    for (const step of theoreticalPath) {
      let status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' = 'PENDING';
      
      if (currentMonth > step.month) {
          status = 'COMPLETED'; // Simplified. In reality, requires checking historical db.
      } else if (currentMonth === step.month) {
          status = 'IN_PROGRESS';
      }

      milestones.push({
          month: step.month,
          expectedCapital: step.cap,
          accounts: step.accounts,
          strategies: step.strats,
          expectedMonthlyReturnPct: step.ret,
          status,
          notes: step.note
      });
    }

    // Determine if we are on pace.
    // Find the closest past/present milestone and compare capital
    let isPaceGood = true;
    const currentMilestone = [...theoreticalPath].reverse().find(m => m.month <= currentMonth);
    
    if (currentMilestone && currentCapital < (currentMilestone.cap * 0.8)) {
        // If we are more than 20% behind the expected capital for the current month
        isPaceGood = false;
    }

    return {
      currentMonth,
      currentCapital,
      milestones,
      isPaceGood
    };
  }

  /**
   * Psychological safeguards checklist.
   * Used to prompt the user or system before allowing transitions.
   */
  public static getTransitionChecklist(fromPhase: string, toPhase: string): string[] {
      if (fromPhase === 'DEMO' && toPhase === 'LIVE_PHASE_1') {
          return [
              "Win rate on demo > 55%",
              "Sharpe ratio on demo > 0.6",
              "Max consecutive losses < 5",
              "Simulated Realistic PnL is POSITIVE (survives slippage test)",
              "Broker supports algorithmic execution",
              "Zero manual interventions needed in last 2 weeks"
          ];
      }
      
      if (fromPhase === 'LIVE_PHASE_1' && toPhase === 'MULTI_STRATEGY') {
          return [
              "Account #1 has 30+ profitable live trades",
              "80% of profits have been reinvested (no over-withdrawing)",
              "Max drawdown on live < 8%",
              "Only adding ONE new strategy right now (no strategy creep)",
              "New strategy backtested with Sharpe > 0.8"
          ];
      }

      return ["Invalid phase transition requested."];
  }
}
