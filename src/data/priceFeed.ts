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

// Alpha Vantage symbol conversion (e.g. 'EUR/USD' → { from: 'EUR', to: 'USD' }, 'XAU/USD' → { from: 'XAU', to: 'USD' })
function toAVSymbol(instrument: string): { from: string; to: string } {
  const parts = instrument.replace('_', '/').split('/');
  return { from: parts[0], to: parts[1] };
}

// Alpha Vantage granularity mapping
function toAVInterval(granularity: string): string {
  const map: Record<string, string> = {
    '1min': '1min', '5min': '5min', '15min': '15min', '30min': '30min',
    '60min': '60min', '1h': '60min', '1day': 'daily', 'daily': 'daily',
  };
  return map[granularity] || '60min';
}

export class PriceFeed {
  private static avBaseURL = 'https://www.alphavantage.co/query';
  private static tdBaseURL = 'https://api.twelvedata.com';
  // 5-minute memory cache for candles to prevent rate limit limits
  private static candleCache: Record<string, { candles: Candle[], timestamp: number }> = {};
  // Quote cache: reuse last quote for up to 30 seconds to respect AV 5 req/min limit
  private static quoteCache: Record<string, { quote: Quote; timestamp: number }> = {};

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
   * Fetches historical candles from Twelve Data or Simulator with 5-minute caching.
   */
  public static async fetchCandles(
    instrument: string,
    count: number,
    granularity: string = config.CANDLE_GRANULARITY
  ): Promise<Candle[]> {
    if (config.USE_SIMULATOR && !config.USE_REAL_PRICES) {
      return this.generateSimulatedCandles(instrument, count, granularity);
    }

    const cacheKey = `${instrument}_${granularity}_${count}`;
    const cached = this.candleCache[cacheKey];
    const now = Date.now();

    // Cache hit: return cache if less than 5 minutes old
    if (cached && now - cached.timestamp < 5 * 60 * 1000) {
      logger.debug(`Twelve Data candle cache hit for ${instrument} (${granularity})`);
      return cached.candles;
    }

    // --- PRIMARY: Alpha Vantage (daily candles only — FX_INTRADAY is premium) ---
    const avInterval = toAVInterval(granularity);
    if (avInterval === 'daily') {
      try {
        const { from, to } = toAVSymbol(instrument);
        logger.info(`Fetching ${count} daily candles for ${instrument} from Alpha Vantage (FX_DAILY)...`);

        const response = await axios.get(this.avBaseURL, {
          params: {
            function: 'FX_DAILY',
            from_symbol: from,
            to_symbol: to,
            outputsize: count > 100 ? 'full' : 'compact',
            apikey: process.env.ALPHA_VANTAGE_API_KEY || '4CNBP4CEGSL5EQU9',
          },
          timeout: 15000,
        });

        const data = response.data;
        if (data['Note'] || data['Information']) {
          throw new Error(`Alpha Vantage rate limit: ${data['Note'] || data['Information']}`);
        }

        const series = data['Time Series FX (Daily)'];
        if (!series) throw new Error(`Alpha Vantage: no 'Time Series FX (Daily)' in response`);

        const candles: Candle[] = Object.entries(series)
          .slice(0, count)
          .map(([datetime, v]: [string, any]) => ({
            time: new Date(datetime + 'T00:00:00Z').toISOString(),
            instrument, granularity,
            open: parseFloat(v['1. open']),
            high: parseFloat(v['2. high']),
            low: parseFloat(v['3. low']),
            close: parseFloat(v['4. close']),
            volume: 0,
          }))
          .reverse();

        this.saveCandlesToDb(candles);
        this.candleCache[cacheKey] = { candles, timestamp: now };
        logger.info(`Alpha Vantage: fetched ${candles.length} daily candles for ${instrument}`);
        return candles;

      } catch (avError: any) {
        logger.warn(`Alpha Vantage daily candle fetch failed for ${instrument}: ${avError.message}. Trying Twelve Data...`);
      }
    }
    // Note: FX_INTRADAY (1h) is premium on AV free plan — skip directly to Twelve Data

    // --- SECONDARY FALLBACK: Twelve Data ---
    try {
      logger.info(`Fetching ${count} ${granularity} candles for ${instrument} from Twelve Data...`);
      const response = await axios.get(`${this.tdBaseURL}/time_series`, {
        params: {
          symbol: instrument,
          interval: granularity,
          outputsize: count,
          apikey: config.TWELVE_DATA_API_KEY,
        },
        timeout: 10000,
      });

      if (response.data.status === 'error') throw new Error(response.data.message);

      const values = response.data.values || [];
      const candles: Candle[] = values.map((v: any) => ({
        time: new Date(v.datetime + ' UTC').toISOString(),
        instrument, granularity,
        open: parseFloat(v.open), high: parseFloat(v.high),
        low: parseFloat(v.low), close: parseFloat(v.close),
        volume: parseInt(v.volume, 10) || 0,
      })).reverse();

      this.saveCandlesToDb(candles);
      this.candleCache[cacheKey] = { candles, timestamp: now };
      return candles;

    } catch (tdError: any) {
      logger.error(`Both AV and Twelve Data candle fetch failed for ${instrument}. Using cache or simulator.`);
    }

    // --- TERTIARY: cached / simulated ---
    if (cached) { cached.timestamp = now; return cached.candles; }
    const dbCached = this.getCachedCandles(instrument, count, granularity);
    if (dbCached.length > 0) {
      this.candleCache[cacheKey] = { candles: dbCached, timestamp: now };
      return dbCached;
    }
    const simCandles = this.generateSimulatedCandles(instrument, count, granularity);
    this.candleCache[cacheKey] = { candles: simCandles, timestamp: now };
    return simCandles;
  }

  /**
   * Fetches latest bid/ask quotes.
   * Primary: Alpha Vantage CURRENCY_EXCHANGE_RATE (one call per instrument, cached 30s)
   * Fallback: Twelve Data batched price, then simulator.
   */
  public static async fetchLatestQuotes(instruments: string[]): Promise<Quote[]> {
    if (config.USE_SIMULATOR || !config.USE_REAL_PRICES) {
      return instruments.map((inst) => {
        const basePrice = simPrices[inst] || (inst.includes('JPY') ? 155.50 : 1.0850);
        const vol = basePrice * 0.0001;
        const change = (Math.random() - 0.5) * vol;
        const newMid = basePrice + change;
        simPrices[inst] = newMid;
        const spread = SPREADS[inst] || (inst.includes('JPY') ? 0.015 : 0.00015);
        const isSpecial = inst.includes('JPY') || inst.includes('XAU');
        return {
          instrument: inst,
          time: new Date().toISOString(),
          bid: parseFloat((newMid - spread / 2).toFixed(isSpecial ? 3 : 5)),
          ask: parseFloat((newMid + spread / 2).toFixed(isSpecial ? 3 : 5)),
        };
      });
    }

    const now = Date.now();
    const QUOTE_CACHE_MS = 30 * 1000; // 30-second quote cache — respects AV 5 req/min
    const quotes: Quote[] = [];

    // --- PRIMARY: Alpha Vantage CURRENCY_EXCHANGE_RATE (per instrument, cached 30s) ---
    const uncached = instruments.filter(inst => {
      const c = this.quoteCache[inst];
      if (c && now - c.timestamp < QUOTE_CACHE_MS) {
        quotes.push(c.quote);
        return false;
      }
      return true;
    });

    for (const inst of uncached) {
      try {
        const { from, to } = toAVSymbol(inst);
        const response = await axios.get(this.avBaseURL, {
          params: {
            function: 'CURRENCY_EXCHANGE_RATE',
            from_currency: from,
            to_currency: to,
            apikey: process.env.ALPHA_VANTAGE_API_KEY || '4CNBP4CEGSL5EQU9',
          },
          timeout: 8000,
        });

        const rate = response.data?.['Realtime Currency Exchange Rate'];
        if (rate?.['5. Exchange Rate']) {
          const mid = parseFloat(rate['5. Exchange Rate']);
          const spread = SPREADS[inst] || (inst.includes('JPY') ? 0.015 : 0.00015);
          const isSpecial = inst.includes('JPY') || inst.includes('XAU');
          const quote: Quote = {
            instrument: inst,
            time: new Date().toISOString(),
            bid: parseFloat((mid - spread / 2).toFixed(isSpecial ? 3 : 5)),
            ask: parseFloat((mid + spread / 2).toFixed(isSpecial ? 3 : 5)),
          };
          this.quoteCache[inst] = { quote, timestamp: now };
          simPrices[inst] = mid; // keep sim prices in sync
          quotes.push(quote);
          logger.debug(`Alpha Vantage quote for ${inst}: ${mid}`);
        } else if (response.data?.['Note'] || response.data?.['Information']) {
          throw new Error(`AV rate limit`);
        } else {
          throw new Error(`AV: unexpected response for ${inst}`);
        }
      } catch (avErr: any) {
        logger.warn(`Alpha Vantage quote failed for ${inst}: ${avErr.message}. Trying Twelve Data...`);

        // --- SECONDARY: Twelve Data single quote ---
        try {
          const tdResp = await axios.get(`${this.tdBaseURL}/price`, {
            params: { symbol: inst, apikey: config.TWELVE_DATA_API_KEY },
            timeout: 6000,
          });
          if (tdResp.data?.price) {
            const mid = parseFloat(tdResp.data.price);
            const spread = SPREADS[inst] || (inst.includes('JPY') ? 0.015 : 0.00015);
            const isSpecial = inst.includes('JPY') || inst.includes('XAU');
            const quote: Quote = {
              instrument: inst,
              time: new Date().toISOString(),
              bid: parseFloat((mid - spread / 2).toFixed(isSpecial ? 3 : 5)),
              ask: parseFloat((mid + spread / 2).toFixed(isSpecial ? 3 : 5)),
            };
            this.quoteCache[inst] = { quote, timestamp: now };
            simPrices[inst] = mid;
            quotes.push(quote);
          } else throw new Error('TD: no price field');
        } catch (tdErr: any) {
          logger.error(`Quote fetch failed for ${inst} (AV + TD both failed). Using simulator.`);
          const basePrice = simPrices[inst] || 1.0850;
          const spread = SPREADS[inst] || 0.00015;
          const isSpecial = inst.includes('JPY') || inst.includes('XAU');
          quotes.push({
            instrument: inst,
            time: new Date().toISOString(),
            bid: parseFloat((basePrice - spread / 2).toFixed(isSpecial ? 3 : 5)),
            ask: parseFloat((basePrice + spread / 2).toFixed(isSpecial ? 3 : 5)),
          });
        }
      }
    }

    return quotes;
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
