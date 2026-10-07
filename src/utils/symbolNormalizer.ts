/**
 * Symbol Normalization & Currency Conversion Module
 *
 * Single source of truth for:
 * - Symbol format mapping (EUR/USD ↔ EUR_USD ↔ EURUSD)
 * - Instrument specifications (pip size, contract size, decimals)
 * - PnL calculation with quote-to-account currency conversion (USD)
 * - Gap-through execution handling for SL/TP
 */

export interface CandleQuote {
  open: number;
  high: number;
  low: number;
  close: number;
}

export class SymbolNormalizer {
  /**
   * Normalizes any symbol format to the internal canonical format (e.g., 'EUR/USD', 'XAU/USD')
   */
  public static toInternal(symbol: string): string {
    if (!symbol) return '';
    const clean = symbol.trim().toUpperCase();

    // Already slash format
    if (clean.includes('/')) return clean;

    // Underscore format (e.g., EUR_USD, XAU_USD)
    if (clean.includes('_')) return clean.replace('_', '/');

    // 6-character concatenated format (e.g., EURUSD, XAUUSD, USDJPY)
    if (clean.length === 6) {
      return `${clean.substring(0, 3)}/${clean.substring(3, 6)}`;
    }

    // 7-character special format (e.g., XAUUSDm, EURUSD.a)
    const stripped = clean.replace(/[^A-Z]/g, '');
    if (stripped.length >= 6) {
      return `${stripped.substring(0, 3)}/${stripped.substring(3, 6)}`;
    }

    return clean;
  }

  /**
   * Normalizes to MT5 broker format (e.g., 'EURUSD', 'XAUUSD')
   */
  public static toMt5(symbol: string): string {
    return this.toInternal(symbol).replace('/', '');
  }

  /**
   * Normalizes to Twelve Data format (e.g., 'EUR/USD')
   */
  public static toTwelveData(symbol: string): string {
    return this.toInternal(symbol);
  }

  public static toSlash(symbol: string): string {
    return this.toInternal(symbol);
  }

  public static toUnderscore(symbol: string): string {
    return this.toInternal(symbol).replace('/', '_');
  }

  public static calculatePipValueUsd(symbol: string, units: number, quoteRate: number = 1.0): number {
    const pipSize = this.getPipSize(symbol);
    const norm = this.toInternal(symbol);
    if (this.isGold(norm)) return units * pipSize;
    if (this.isJpy(norm)) return quoteRate > 0 ? (units * pipSize) / quoteRate : (units * pipSize) / 150.0;
    return units * pipSize;
  }

  /**
   * Checks if an instrument is Gold (XAU/USD)
   */
  public static isGold(symbol: string): boolean {
    const s = this.toInternal(symbol);
    return s.includes('XAU') || s.includes('GOLD');
  }

  /**
   * Checks if an instrument has JPY as quote currency
   */
  public static isJpy(symbol: string): boolean {
    const s = this.toInternal(symbol);
    return s.includes('JPY');
  }

  /**
   * Standard pip size:
   * - Gold (XAU/USD): 0.10 (1 pip = $0.10 price move)
   * - JPY pairs: 0.01 (1 pip = 0.01 price move)
   * - 4-decimal forex pairs: 0.0001 (1 pip = 0.0001 price move)
   */
  public static getPipSize(symbol: string): number {
    if (this.isGold(symbol)) return 0.10;
    if (this.isJpy(symbol)) return 0.01;
    return 0.0001;
  }

  /**
   * Standard contract size:
   * - Gold (XAU/USD): 100 troy ounces per lot (0.01 lot = 1 ounce)
   * - Forex pairs: 100,000 units per lot (0.01 lot = 1,000 units)
   */
  public static getContractSize(symbol: string): number {
    if (this.isGold(symbol)) return 100;
    return 100000;
  }

  /**
   * Number of price decimal places
   */
  public static getPriceDecimals(symbol: string): number {
    if (this.isGold(symbol)) return 2;
    if (this.isJpy(symbol)) return 3;
    return 5;
  }

  /**
   * Converts pip distance to price distance
   */
  public static pipsToPrice(symbol: string, pips: number): number {
    return pips * this.getPipSize(symbol);
  }

  /**
   * Converts price distance to pips
   */
  public static priceToPips(symbol: string, priceDiff: number): number {
    return Math.abs(priceDiff) / this.getPipSize(symbol);
  }

  /**
   * Calculates realized PnL in USD (account currency).
   *
   * For pairs where quote currency is USD (e.g. EUR/USD, GBP/USD, AUD/USD, XAU/USD):
   *   PnL = (exitPrice - entryPrice) * units
   *
   * For pairs where base currency is USD and quote is non-USD (e.g. USD/JPY, USD/CHF, USD/CAD):
   *   Raw PnL is in quote currency. Convert to USD by dividing by quote exchange rate:
   *   PnL_USD = ((exitPrice - entryPrice) * units) / exitRate
   */
  public static calculatePnl(
    symbol: string,
    action: 'BUY' | 'SELL',
    entryPrice: number,
    exitPrice: number,
    units: number,
    quoteRate?: number
  ): number {
    const rawDiff = action === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice;
    const rawPnl = rawDiff * units;

    const norm = this.toInternal(symbol);
    const parts = norm.split('/');
    const base = parts[0];
    const quote = parts[1] || 'USD';

    // Quote is already USD: no conversion needed
    if (quote === 'USD') {
      return rawPnl;
    }

    // Base is USD, Quote is non-USD (e.g. USD/JPY, USD/CHF, USD/CAD)
    if (base === 'USD') {
      const conversionRate = quoteRate || exitPrice;
      if (conversionRate > 0) {
        return rawPnl / conversionRate;
      }
    }

    return rawPnl;
  }

  /**
   * Calculates realistic exit price handling gap-through on SL or TP.
   * If price gaps past the order price at candle open, the order fills at the gapped open price.
   */
  public static calculateGapExit(
    action: 'BUY' | 'SELL',
    orderType: 'SL' | 'TP',
    orderPrice: number,
    candle: CandleQuote
  ): number {
    if (orderType === 'SL') {
      if (action === 'BUY') {
        // Stop loss for BUY: triggered when price drops to or below orderPrice
        // If candle opened below orderPrice, exit fills at the worse open price (slippage / gap)
        if (candle.open < orderPrice) {
          return candle.open;
        }
        return orderPrice;
      } else {
        // Stop loss for SELL: triggered when price rises to or above orderPrice
        // If candle opened above orderPrice, exit fills at the worse open price
        if (candle.open > orderPrice) {
          return candle.open;
        }
        return orderPrice;
      }
    } else {
      // Take Profit
      if (action === 'BUY') {
        // TP for BUY: triggered when price rises to or above orderPrice
        // If candle opened above TP, fill at open (favorable gap)
        if (candle.open > orderPrice) {
          return candle.open;
        }
        return orderPrice;
      } else {
        // TP for SELL: triggered when price drops to or below orderPrice
        // If candle opened below TP, fill at open (favorable gap)
        if (candle.open < orderPrice) {
          return candle.open;
        }
        return orderPrice;
      }
    }
  }
}
