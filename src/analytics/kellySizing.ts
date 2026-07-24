export interface KellyInputs {
  winRate: number; // 0.0 to 1.0
  profitFactor: number; // e.g. 1.2
  confidenceTier: 'LOW' | 'MID' | 'HIGH';
  currentEquity: number;
}

export interface KellyOutput {
  theoreticalKellyPct: number;
  fractionalKellyPct: number;
  fractionUsed: '1/8' | '1/6' | '1/4' | 'NONE';
  riskUsd: number;
  recommendation: string;
}

export class KellySizing {
  /**
   * Calculates the optimal Fractional Kelly position size based on win rate, 
   * profit factor, confidence, and current account equity tier.
   *
   * Formula: f* = (p * b - q) / b
   * where:
   *   p = win probability
   *   q = 1 - p (loss probability)
   *   b = profit/loss ratio (profitFactor)
   */
  public static calculatePositionSize(inputs: KellyInputs): KellyOutput {
    const p = inputs.winRate;
    const q = 1 - p;
    const b = inputs.profitFactor;

    // Edge check: If win rate or profit factor is too low, Kelly will be negative or 0
    if (p <= 0 || b <= 0) {
      return this.createZeroOutput("Invalid inputs for Kelly calculation.");
    }

    const theoreticalKelly = (p * b - q) / b;

    if (theoreticalKelly <= 0) {
      return this.createZeroOutput("No mathematical edge detected. Do not trade.");
    }

    // Determine the safe fraction to use based on equity tier and confidence
    let fraction: number;
    let fractionUsed: '1/8' | '1/6' | '1/4' | 'NONE';

    // Account Maturity Tier
    if (inputs.currentEquity < 1000) {
        // Micro/Starter accounts ($100-$999) - Extremely safe
        fraction = 1/8;
        fractionUsed = '1/8';
    } else if (inputs.currentEquity < 5000) {
        // Intermediate accounts ($1000-$4999)
        fraction = inputs.confidenceTier === 'HIGH' ? 1/6 : 1/8;
        fractionUsed = inputs.confidenceTier === 'HIGH' ? '1/6' : '1/8';
    } else {
        // Mature accounts ($5000+)
        if (inputs.confidenceTier === 'HIGH') {
            fraction = 1/4;
            fractionUsed = '1/4';
        } else if (inputs.confidenceTier === 'MID') {
            fraction = 1/6;
            fractionUsed = '1/6';
        } else {
            fraction = 1/8;
            fractionUsed = '1/8';
        }
    }

    // Low confidence ALWAYS overrides to safest tier
    if (inputs.confidenceTier === 'LOW') {
        fraction = 1/8;
        fractionUsed = '1/8';
    }

    const fractionalKellyPct = theoreticalKelly * fraction * 100; // Convert to percentage
    const theoreticalKellyPct = theoreticalKelly * 100;
    
    // Hard cap constraint (Safety Override)
    // We never allow a single trade risk to exceed 5% even on 1/4 Kelly for mature accounts
    const cappedFractionalKellyPct = Math.min(fractionalKellyPct, 5.0);

    const riskUsd = inputs.currentEquity * (cappedFractionalKellyPct / 100);

    return {
      theoreticalKellyPct: Number(theoreticalKellyPct.toFixed(2)),
      fractionalKellyPct: Number(cappedFractionalKellyPct.toFixed(2)),
      fractionUsed,
      riskUsd: Number(riskUsd.toFixed(2)),
      recommendation: `Optimal fractional risk is ${cappedFractionalKellyPct.toFixed(2)}% using ${fractionUsed} Kelly.`
    };
  }

  private static createZeroOutput(reason: string): KellyOutput {
    return {
      theoreticalKellyPct: 0,
      fractionalKellyPct: 0,
      fractionUsed: 'NONE',
      riskUsd: 0,
      recommendation: reason
    };
  }
}
