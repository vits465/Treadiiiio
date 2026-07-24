export interface ActivePosition {
  instrument: string;
  side: 'LONG' | 'SHORT' | 'BUY' | 'SELL';
  units?: number;
}

export interface CorrelationCheckResult {
  exceeded: boolean;
  totalCorrelationSum: number;
  maxCap: number;
  reason: string;
}

export class CorrelationManager {
  private static readonly DEFAULT_MAX_CORRELATION_SUM = 1.5;

  // Pair-to-pair baseline correlation matrix (historical average 1-year daily correlations)
  private static readonly CORRELATION_MATRIX: Record<string, Record<string, number>> = {
    'EUR/USD': { 'EUR/USD': 1.0, 'GBP/USD': 0.85, 'USD/JPY': -0.40, 'AUD/USD': 0.70, 'USD/CHF': -0.90, 'XAU/USD': 0.45 },
    'GBP/USD': { 'EUR/USD': 0.85, 'GBP/USD': 1.0, 'USD/JPY': -0.35, 'AUD/USD': 0.65, 'USD/CHF': -0.80, 'XAU/USD': 0.40 },
    'USD/JPY': { 'EUR/USD': -0.40, 'GBP/USD': -0.35, 'USD/JPY': 1.0, 'AUD/USD': -0.30, 'USD/CHF': 0.50, 'XAU/USD': -0.40 },
    'AUD/USD': { 'EUR/USD': 0.70, 'GBP/USD': 0.65, 'USD/JPY': -0.30, 'AUD/USD': 1.0, 'USD/CHF': -0.65, 'XAU/USD': 0.50 },
    'USD/CHF': { 'EUR/USD': -0.90, 'GBP/USD': -0.80, 'USD/JPY': 0.50, 'AUD/USD': -0.65, 'USD/CHF': 1.0, 'XAU/USD': -0.45 },
    'XAU/USD': { 'EUR/USD': 0.45, 'GBP/USD': 0.40, 'USD/JPY': -0.40, 'AUD/USD': 0.50, 'USD/CHF': -0.45, 'XAU/USD': 1.0 }
  };

  /**
   * Normalizes instrument string (e.g., "EUR_USD" -> "EUR/USD")
   */
  public static normalizeInstrument(inst: string): string {
    return inst.replace('_', '/').toUpperCase();
  }

  /**
   * Normalizes side string ("BUY" -> "LONG", "SELL" -> "SHORT")
   */
  public static normalizeSide(side: string): 'LONG' | 'SHORT' {
    const s = side.toUpperCase();
    return (s === 'BUY' || s === 'LONG') ? 'LONG' : 'SHORT';
  }

  /**
   * Gets price correlation between two instruments (-1.0 to +1.0)
   */
  public static getPairCorrelation(inst1: string, inst2: string): number {
    const norm1 = this.normalizeInstrument(inst1);
    const norm2 = this.normalizeInstrument(inst2);

    if (norm1 === norm2) return 1.0;

    if (this.CORRELATION_MATRIX[norm1] && this.CORRELATION_MATRIX[norm1][norm2] !== undefined) {
      return this.CORRELATION_MATRIX[norm1][norm2];
    }
    if (this.CORRELATION_MATRIX[norm2] && this.CORRELATION_MATRIX[norm2][norm1] !== undefined) {
      return this.CORRELATION_MATRIX[norm2][norm1];
    }

    // Default assumption for unknown pairs: 0 correlation
    return 0.0;
  }

  /**
   * Calculates directional correlation between two active positions.
   * Takes trade direction into account:
   * - Long EUR/USD + Long GBP/USD (+0.85 price correlation) = +0.85 directional correlation
   * - Long EUR/USD + Short GBP/USD (+0.85 price correlation) = -0.85 directional correlation (hedge)
   */
  public static getDirectionalCorrelation(pos1: ActivePosition, pos2: ActivePosition): number {
    const priceCorr = this.getPairCorrelation(pos1.instrument, pos2.instrument);
    const side1 = this.normalizeSide(pos1.side);
    const side2 = this.normalizeSide(pos2.side);

    const sameDirection = side1 === side2;
    return sameDirection ? priceCorr : -priceCorr;
  }

  /**
   * Checks if adding a candidate trade to open positions exceeds the portfolio correlation sum cap (default <= 1.5).
   */
  public static checkCorrelationCap(
    openPositions: ActivePosition[],
    candidateInstrument: string,
    candidateSide: 'LONG' | 'SHORT' | 'BUY' | 'SELL',
    maxCap: number = this.DEFAULT_MAX_CORRELATION_SUM
  ): CorrelationCheckResult {
    const candidate: ActivePosition = {
      instrument: candidateInstrument,
      side: candidateSide
    };

    const allPositions = [...openPositions, candidate];
    let totalCorrelationSum = 0;

    // Calculate sum of pairwise directional correlations for unique pairs
    for (let i = 0; i < allPositions.length; i++) {
      for (let j = i + 1; j < allPositions.length; j++) {
        const dirCorr = this.getDirectionalCorrelation(allPositions[i], allPositions[j]);
        // Only count positive net directional exposure towards the portfolio risk budget
        if (dirCorr > 0) {
          totalCorrelationSum += dirCorr;
        }
      }
    }

    totalCorrelationSum = Number(totalCorrelationSum.toFixed(2));
    const exceeded = totalCorrelationSum > maxCap;

    const reason = exceeded
      ? `Portfolio correlation sum (${totalCorrelationSum}) exceeds maximum cap of ${maxCap}. Trade rejected to prevent correlated risk stack.`
      : `Portfolio correlation sum (${totalCorrelationSum}) is within cap (${maxCap}).`;

    return {
      exceeded,
      totalCorrelationSum,
      maxCap,
      reason
    };
  }

  /**
   * Returns the entire static correlation matrix for API / Dashboard visibility.
   */
  public static getCorrelationMatrix(): Record<string, Record<string, number>> {
    return this.CORRELATION_MATRIX;
  }
}
