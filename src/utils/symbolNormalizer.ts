/**
 * Symbol Normalization Module
 * Single source of truth mapping symbols across formats:
 * - Canonical (internal engine): 'EUR/USD'
 * - Underscore (legacy/OANDA): 'EUR_USD'
 * - Raw (MT5/Broker/Polygon): 'EURUSD'
 * - Polygon Ticker: 'C:EURUSD'
 */

export class SymbolNormalizer {
  /**
   * Normalizes any input symbol string into the canonical slash format 'EUR/USD'.
   * Handles 'EUR_USD', 'EURUSD', 'c:eurusd', 'EUR/USD'.
   */
  public static toCanonical(symbol: string): string {
    if (!symbol) return '';
    let clean = symbol.trim().toUpperCase();
    if (clean.startsWith('C:')) {
      clean = clean.substring(2);
    }
    if (clean.includes('/')) {
      return clean;
    }
    if (clean.includes('_')) {
      return clean.replace('_', '/');
    }
    // Handle 6-character forex pairs like EURUSD or 6-char gold like XAUUSD
    if (clean.length === 6) {
      return `${clean.substring(0, 3)}/${clean.substring(3)}`;
    }
    return clean;
  }

  /**
   * Converts symbol to legacy underscore format 'EUR_USD'.
   */
  public static toUnderscore(symbol: string): string {
    const canonical = this.toCanonical(symbol);
    return canonical.replace('/', '_');
  }

  /**
   * Converts symbol to raw concatenated MT5/broker format 'EURUSD'.
   */
  public static toRaw(symbol: string): string {
    const canonical = this.toCanonical(symbol);
    return canonical.replace(/[/_]/g, '');
  }

  /**
   * Converts symbol to Polygon.io / Massive ticker format 'C:EURUSD'.
   */
  public static toPolygonTicker(symbol: string): string {
    const raw = this.toRaw(symbol);
    return `C:${raw}`;
  }

  /**
   * Returns true if symbol matches one of the canonical forms.
   */
  public static isSameSymbol(symbolA: string, symbolB: string): boolean {
    return this.toCanonical(symbolA) === this.toCanonical(symbolB);
  }
}
