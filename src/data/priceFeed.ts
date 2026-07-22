import axios from 'axios';
import { config } from '../config';
import { logger } from '../logger';
import { db } from '../db';

export interface Candle {
  time: string; // ISO string
  instrument: string;
  granularity: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  instrument: string;
  time: string;
  bid: number;
  ask: number;
}

const BASE_PRICES: Record<string, number> = {
  'EUR/USD': 1.0850,
  'GBP/USD': 1.2700,
  'USD/JPY': 155.50,
  'AUD/USD': 0.6650,
  'USD/CHF': 0.9050,
  'XAU/USD': 2400.00,
};

const SPREADS: Record<string, number> = {
  'EUR/USD': 0.00015, // 1.5 pips
  'GBP/USD': 0.00020, // 2.0 pips
  'USD/JPY': 0.015,   // 1.5 pips
  'AUD/USD': 0.00018,
  'USD/CHF': 0.00018,
  'XAU/USD': 0.30,    // 30 pips
};

const simPrices = { ...BASE_PRICES };

export class PriceFeed {
  private static baseURL = 'https://api.twelvedata.com';

  public static getLatestQuote(instrument: string): Quote {
    const formatted = instrument.includes('/') ? instrument : instrument.replace('_', '/');
    const basePrice = simPrices[formatted] || simPrices['EUR/USD'] || 1.0850;
    const spread = SPREADS[formatted] || (formatted.includes('JPY') ? 0.015 : 0.00015);
    const bid = basePrice - spread / 2;
    const ask = basePrice + spread / 2;

    const isSpecial = formatted.includes('JPY') || formatted.includes('XAU');
    return {
      instrument: formatted,
      time: new Date().toISOString(),
      bid: parseFloat(bid.toFixed(isSpecial ? 3 : 5)),
      ask: parseFloat(ask.toFixed(isSpecial ? 3 : 5)),
    };
  }

  /**
   * Fetches historical candles from Twelve Data or Simulator.
   */
  public static async fetchCandles(
    instrument: string,
    count: number,
    granularity: string = config.CANDLE_GRANULARITY
  ): Promise<Candle[]> {
    if (config.USE_SIMULATOR && !config.USE_REAL_PRICES) {
      return this.generateSimulatedCandles(instrument, count, granularity);
    }

    try {
      logger.info(`Fetching ${count} ${granularity} candles for ${instrument} from Twelve Data...`);
      
      const response = await axios.get(`${this.baseURL}/time_series`, {
        params: {
          symbol: instrument,
          interval: granularity,
          outputsize: count,
          apikey: config.TWELVE_DATA_API_KEY,
        },
      });

      if (response.data.status === 'error') {
        throw new Error(response.data.message || 'Twelve Data API Error');
      }

      const values = response.data.values || [];
      const candles: Candle[] = values.map((v: any) => ({
        time: new Date(v.datetime + ' UTC').toISOString(),
        instrument,
        granularity,
        open: parseFloat(v.open),
        high: parseFloat(v.high),
        low: parseFloat(v.low),
        close: parseFloat(v.close),
        volume: parseInt(v.volume, 10) || 0,
      }));

      // Twelve Data returns most recent first, so reverse to make it oldest first (chronological)
      candles.reverse();

      this.saveCandlesToDb(candles);
      return candles;
    } catch (error: any) {
      logger.error(`Twelve Data candle fetch failed for ${instrument}: ${error.message}. Using cache or simulator...`);
      const cached = this.getCachedCandles(instrument, count, granularity);
      if (cached.length > 0) {
        return cached;
      }
      return this.generateSimulatedCandles(instrument, count, granularity);
    }
  }

  /**
   * Fetches latest bid/ask quotes for currency pairs via MT5 Client.
   */
  public static async fetchLatestQuotes(instruments: string[]): Promise<Quote[]> {
    if (config.USE_SIMULATOR || !config.USE_REAL_PRICES) {
      return instruments.map((inst) => {
        const basePrice = simPrices[inst] || (inst.includes('JPY') ? 155.50 : 1.0850);
        const vol = basePrice * 0.0001; // 0.01% volatility per tick
        const change = (Math.random() - 0.5) * vol;
        const newMid = basePrice + change;
        simPrices[inst] = newMid;

        const spread = SPREADS[inst] || (inst.includes('JPY') ? 0.015 : 0.00015);
        const bid = newMid - spread / 2;
        const ask = newMid + spread / 2;

        const isSpecial = inst.includes('JPY') || inst.includes('XAU');
        return {
          instrument: inst,
          time: new Date().toISOString(),
          bid: parseFloat(bid.toFixed(isSpecial ? 3 : 5)),
          ask: parseFloat(ask.toFixed(isSpecial ? 3 : 5)),
        };
      });
    }

    try {
      logger.debug(`Fetching live quotes from Twelve Data for: ${instruments.join(',')}`);
      const quotes: Quote[] = [];
      
      for (const inst of instruments) {
        const response = await axios.get(`${this.baseURL}/price`, {
          params: {
            symbol: inst,
            apikey: config.TWELVE_DATA_API_KEY,
          },
        });
        
        if (response.data && response.data.price) {
          const basePrice = parseFloat(response.data.price);
          const spread = SPREADS[inst] || (inst.includes('JPY') ? 0.015 : 0.00015);
          const isSpecial = inst.includes('JPY') || inst.includes('XAU');
          quotes.push({
            instrument: inst,
            time: new Date().toISOString(),
            bid: parseFloat((basePrice - spread / 2).toFixed(isSpecial ? 3 : 5)),
            ask: parseFloat((basePrice + spread / 2).toFixed(isSpecial ? 3 : 5))
          });
        } else {
          logger.error(`Twelve Data price fetch failed for ${inst}: ${JSON.stringify(response.data)}`);
        }
      }

      if (quotes.length === instruments.length) {
        return quotes;
      }

      // If missing quotes, fallback to simulated quotes for missing
      return instruments.map((inst) => quotes.find(q => q.instrument === inst) || {
        instrument: inst,
        time: new Date().toISOString(),
        bid: simPrices[inst] || 1.0850,
        ask: (simPrices[inst] || 1.0850) + 0.00015
      });

    } catch (error: any) {
      logger.error(`Quote fetch failed: ${error.message}. Using simulator fallback.`);
      return instruments.map((inst) => {
        const basePrice = simPrices[inst] || 1.0850;
        return {
          instrument: inst,
          time: new Date().toISOString(),
          bid: basePrice - 0.0001,
          ask: basePrice + 0.0001,
        };
      });
    }
  }

  /**
   * Helper to fetch cached candles from database.
   */
  public static getCachedCandles(instrument: string, limit: number, granularity: string): Candle[] {
    try {
      const rows = db.prepare(`
        SELECT time, instrument, granularity, open, high, low, close, volume
        FROM candles
        WHERE instrument = ? AND granularity = ?
        ORDER BY time DESC
        LIMIT ?
      `).all(instrument, granularity, limit);

      return (rows as any[]).reverse().map((r) => ({
        time: r.time,
        instrument: r.instrument,
        granularity: r.granularity,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
      }));
    } catch (error) {
      logger.error('Failed to query cached candles from JSON DB:', error);
      return [];
    }
  }

  /**
   * Saves candles to local database.
   */
  public static saveCandlesToDb(candles: Candle[]) {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO candles (time, instrument, granularity, open, high, low, close, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction((candlesList: Candle[]) => {
      for (const c of candlesList) {
        insert.run(c.time, c.instrument, c.granularity, c.open, c.high, c.low, c.close, c.volume);
      }
    });

    transaction(candles);
  }

  /**
   * Generates simulated candles.
   */
  private static generateSimulatedCandles(
    instrument: string,
    count: number,
    granularity: string
  ): Candle[] {
    const candles: Candle[] = [];
    let price = BASE_PRICES[instrument] || 1.0000;
    const now = Date.now();
    const intervalMs = this.getGranularityMs(granularity);

    for (let i = count - 1; i >= 0; i--) {
      const candleTime = new Date(now - i * intervalMs).toISOString();

      const vol = price * 0.001;
      const open = price;
      const close = price + (Math.random() - 0.5) * vol;
      const high = Math.max(open, close) + Math.random() * vol * 0.5;
      const low = Math.min(open, close) - Math.random() * vol * 0.5;
      const volume = Math.floor(Math.random() * 500) + 50;

      const digits = instrument.includes('JPY') || instrument.includes('XAU') ? 3 : 5;

      candles.push({
        time: candleTime,
        instrument,
        granularity,
        open: parseFloat(open.toFixed(digits)),
        high: parseFloat(high.toFixed(digits)),
        low: parseFloat(low.toFixed(digits)),
        close: parseFloat(close.toFixed(digits)),
        volume,
      });

      price = close;
    }

    this.saveCandlesToDb(candles);
    return candles;
  }

  private static getGranularityMs(granularity: string): number {
    const value = parseInt(granularity, 10) || 1;
    const unit = granularity.replace(/[0-9]/g, '');

    switch (unit) {
      case 'min': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'day': return value * 24 * 60 * 60 * 1000;
      case 'week': return value * 7 * 24 * 60 * 60 * 1000;
      default: return 60 * 1000; // default 1 minute
    }
  }
}
