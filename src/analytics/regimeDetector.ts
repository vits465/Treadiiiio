export type MarketRegime = 'CALM' | 'NORMAL' | 'VOLATILE';

export interface RegimeInputs {
  atr20Day: number; // Average True Range normalized or raw (assumed raw pips for now)
  atrThresholdNormal: number; // Threshold between Calm and Normal
  atrThresholdVolatile: number; // Threshold between Normal and Volatile
  rollingWinRate20Day: number; // e.g. 0.55
  rollingSharpe20Day: number; // e.g. 0.8
}

export interface RegimeOutput {
  regime: MarketRegime;
  recommendedThreshold: number; // The ML Confidence threshold to use for this regime
  reasoning: string;
}

export class RegimeDetector {
  /**
   * Detects current market regime (Calm, Normal, Volatile) and recommends an ML confidence threshold.
   */
  public static detectRegime(inputs: RegimeInputs): RegimeOutput {
    const isHighWinRate = inputs.rollingWinRate20Day >= 0.60;
    const isLowWinRate = inputs.rollingWinRate20Day < 0.55;
    
    // Default assumptions
    let regime: MarketRegime = 'NORMAL';
    let recommendedThreshold = 0.70;
    let reasoning = 'Market conditions are normal. Use standard 0.70 threshold.';

    // ATR Analysis
    if (inputs.atr20Day < inputs.atrThresholdNormal) {
        // Calm Market
        if (isHighWinRate && inputs.rollingSharpe20Day > 1.0) {
            regime = 'CALM';
            recommendedThreshold = 0.60;
            reasoning = 'Regime 1 (Calm): ATR low, WinRate > 60%, Sharpe high. Lowering confidence threshold to 0.60 to capture more trades in good conditions.';
        } else {
             // It's calm but we aren't winning easily. Stay normal.
             regime = 'NORMAL';
             recommendedThreshold = 0.70;
             reasoning = 'ATR is low, but edge is not strong enough to lower threshold. Maintaining 0.70.';
        }
    } else if (inputs.atr20Day > inputs.atrThresholdVolatile) {
        // Volatile Market
        regime = 'VOLATILE';
        if (isLowWinRate || inputs.rollingSharpe20Day < 0.5) {
             recommendedThreshold = 0.80;
             reasoning = 'Regime 3 (Volatile/Choppy): ATR high, WinRate < 55%, Sharpe low. Raising threshold to 0.80 to only take the best setups in bad times.';
        } else {
             // Volatile but we are still winning
             recommendedThreshold = 0.75;
             reasoning = 'ATR is high, but edge is holding. Slightly raising threshold to 0.75 for safety in volatility.';
        }
    } else {
        // Normal Market (ATR between normal and volatile thresholds)
        regime = 'NORMAL';
        if (isHighWinRate) {
            recommendedThreshold = 0.65;
            reasoning = 'Regime 2 (Normal) but performing well. Slightly lowering threshold to 0.65.';
        } else if (isLowWinRate) {
            recommendedThreshold = 0.75;
            reasoning = 'Regime 2 (Normal) but edge is weak. Raising threshold to 0.75.';
        } else {
            recommendedThreshold = 0.70;
            reasoning = 'Regime 2 (Normal): ATR medium, WinRate 55-60%. Standard 0.70 threshold.';
        }
    }

    return {
      regime,
      recommendedThreshold,
      reasoning
    };
  }
}
