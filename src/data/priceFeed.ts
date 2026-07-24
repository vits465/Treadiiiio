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
  'XAU/USD': 4146.00,
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

// Massive.com (Polygon.io) ticker conversion (e.g. 'EUR/USD' → 'C:EURUSD', 'XAU/USD' → 'C:XAUUSD')
function toMassiveTicker(instrument: string): string {
  const clean = instrument.replace(/[/_]/g, '').toUpperCase();
  return clean.startsWith('C:') ? clean : `C:${clean}`;
}

export class PriceFeed {
  private static massiveBaseURL = 'https://api.polygon.io';
  private static avBaseURL = 'https://www.alphavantage.co/query';
  private static tdBaseURL = 'https://api.twelvedata.com';
  // 15-minute memory cache for candles to eliminate API rate limits
  private static candleCache: Record<string, { candles: Candle[], timestamp: number }> = {};
  // Quote cache: reuse last quote for up to 30 seconds
  private static quoteCache: Record<string, { quote: Quote; timestamp: number }> = {};
  // Rate limiter delay helper for Massive.com (5 req/min free limit = 12s per req)
  private static lastMassiveCallTime = 0;

  private static massiveQueuePromise: Promise<void> = Promise.resolve();

  private static async throttleMassiveCall(): Promise<void> {
    const minDelay = 2500; // 2.5 seconds delay between API calls
    
    // Chain promises to ensure sequential execution even for parallel calls
    const nextCall = this.massiveQueuePromise.then(async () => {
      const now = Date.now();
      const elapsed = now - this.lastMassiveCallTime;
      if (elapsed < minDelay) {
        await new Promise((resolve) => setTimeout(resolve, minDelay - elapsed));
      }
      this.lastMassiveCallTime = Date.now();
    });
    
    this.massiveQueuePromise = nextCall;
    return nextCall;
  }

  /**
   * Fetches real-time live XAU/USD (Gold) quote from GoldAPI.io.
   * Caches quotes for 5 seconds to manage API rate limits.
   */
  public static async fetchGoldApiQuote(): Promise<Quote | null> {
    const apiKey = config.GOLD_API_KEY || process.env.GOLD_API_KEY || 'goldapi-2f4eaacb05107f8dfa70348fb883283a-io';
    if (!apiKey) return null;

    const cacheKey = 'XAU/USD_GOLDAPI';
    const cached = this.quoteCache[cacheKey];
    const now = Date.now();

    if (cached && now - cached.timestamp < 5000) {
      return cached.quote;
    }

    try {
      const response = await axios.get('https://www.goldapi.io/api/XAU/USD', {
        headers: { 'x-access-token': apiKey },
        timeout: 5000,
      });

      if (response.data && response.data.price) {
        const data = response.data;
        const bid = parseFloat(data.bid || data.price);
        const ask = parseFloat(data.ask || (data.price + 0.30));
        const mid = (bid + ask) / 2;

        simPrices['XAU/USD'] = mid;
        BASE_PRICES['XAU/USD'] = mid;

        const quote: Quote = {
          instrument: 'XAU/USD',
          time: new Date(data.timestamp ? data.timestamp * 1000 : Date.now()).toISOString(),
          bid: parseFloat(bid.toFixed(3)),
          ask: parseFloat(ask.toFixed(3)),
        };

        this.quoteCache[cacheKey] = { quote, timestamp: now };
        logger.info(`[GoldAPI.io] Live XAU/USD quote fetched: Bid ${quote.bid} / Ask ${quote.ask} (Mid: $${mid.toFixed(2)})`);
        return quote;
      }
    } catch (err: any) {
      logger.warn(`GoldAPI.io live quote fetch failed: ${err.message}.`);
    }

    return null;
  }

  public static getLatestQuote(instrument: string): Quote {
    const formatted = instrument.includes('/') ? instrument : instrument.replace('_', '/');

    if (formatted === 'XAU/USD') {
      const cachedGold = this.quoteCache['XAU/USD_GOLDAPI'];
      if (cachedGold && Date.now() - cachedGold.timestamp < 10000) {
        return cachedGold.quote;
      }
    }

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

    // Cache hit: return cache if less than 15 seconds old
    if (cached && now - cached.timestamp < 15 * 1000) {
      return cached.candles;
    }

    // --- FAST PRIMARY: Local DB Cache (17,000+ historical candles) + Live MT5 tick update ---
    const dbCached = this.getCachedCandles(instrument, count, granularity);
    if (dbCached.length >= 20) {
      const quote = this.getLatestQuote(instrument);
      if (quote && dbCached.length > 0) {
        const lastIndex = dbCached.length - 1;
        const currentMid = (quote.bid + quote.ask) / 2;
        dbCached[lastIndex] = {
          ...dbCached[lastIndex],
          close: currentMid,
          high: Math.max(dbCached[lastIndex].high, currentMid),
          low: Math.min(dbCached[lastIndex].low, currentMid),
          time: new Date().toISOString(),
        };
      }
      this.candleCache[cacheKey] = { candles: dbCached, timestamp: now };
      return dbCached;
    }

    // --- SECONDARY: Massive.com (Polygon.io) ---
    try {
      await this.throttleMassiveCall();
      const ticker = toMassiveTicker(instrument);
      const timespan = (granularity.includes('day') || granularity.includes('d')) ? 'day' : 'hour';
      const toDate = new Date().toISOString().split('T')[0];
      const fromDate = new Date(Date.now() - (timespan === 'day' ? 90 : 14) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const apiKey = process.env.MASSIVE_API_KEY || 'RPlbk0FN2femlRAfRNE_SafThj2x3TYj';

      logger.info(`Fetching ${count} ${granularity} candles for ${instrument} (${ticker}) from Massive.com...`);

      const response = await axios.get(
        `${this.massiveBaseURL}/v2/aggs/ticker/${ticker}/range/1/${timespan}/${fromDate}/${toDate}`,
        {
          params: { apiKey, limit: 5000 },
          timeout: 10000,
        }
      );

      if (response.data && response.data.results && response.data.results.length > 0) {
        const rawResults = response.data.results;
        const candles: Candle[] = rawResults.slice(-count).map((r: any) => ({
          time: new Date(r.t).toISOString(),
          instrument,
          granularity,
          open: parseFloat(r.o),
          high: parseFloat(r.h),
          low: parseFloat(r.l),
          close: parseFloat(r.c),
          volume: parseInt(r.v, 10) || 0,
        }));

        this.saveCandlesToDb(candles);
        this.candleCache[cacheKey] = { candles, timestamp: now };
        logger.info(`Massive.com: successfully fetched ${candles.length} ${granularity} candles for ${instrument}`);
        return candles;
      } else {
        throw new Error('Massive.com returned empty results');
      }
    } catch (massiveErr: any) {
      logger.warn(`Massive.com candle fetch failed for ${instrument}: ${massiveErr.message}. Trying fallbacks...`);
    }

    // --- SECONDARY: Alpha Vantage (daily candles only) ---
    const avInterval = toAVInterval(granularity);
    if (avInterval === 'daily') {
      try {
        const { from, to } = toAVSymbol(instrument);
        const response = await axios.get(this.avBaseURL, {
          params: {
            function: 'FX_DAILY',
            from_symbol: from,
            to_symbol: to,
            outputsize: count > 100 ? 'full' : 'compact',
            apikey: process.env.ALPHA_VANTAGE_API_KEY || '4CNBP4CEGSL5EQU9',
          },
          timeout: 10000,
        });

        const data = response.data;
        const series = data['Time Series FX (Daily)'];
        if (series) {
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
          return candles;
        }
      } catch (avError: any) {
        logger.warn(`Alpha Vantage daily candle fetch failed: ${avError.message}`);
      }
    }

    // --- TERTIARY FALLBACK: Twelve Data ---
    try {
      const response = await axios.get(`${this.tdBaseURL}/time_series`, {
        params: {
          symbol: instrument,
          interval: granularity,
          outputsize: count,
          apikey: config.TWELVE_DATA_API_KEY,
        },
        timeout: 8000,
      });

      if (response.data && response.data.values) {
        const candles: Candle[] = response.data.values.map((v: any) => ({
          time: new Date(v.datetime + ' UTC').toISOString(),
          instrument, granularity,
          open: parseFloat(v.open), high: parseFloat(v.high),
          low: parseFloat(v.low), close: parseFloat(v.close),
          volume: parseInt(v.volume, 10) || 0,
        })).reverse();

        this.saveCandlesToDb(candles);
        this.candleCache[cacheKey] = { candles, timestamp: now };
        return candles;
      }
    } catch (tdError: any) {
      logger.error(`Twelve Data candle fetch failed: ${tdError.message}`);
    }

    // --- QUATERNARY: cached / simulated ---
    if (cached) { cached.timestamp = now; return cached.candles; }
    const fallbackDb = this.getCachedCandles(instrument, count, granularity);
    if (fallbackDb.length > 0) {
      this.candleCache[cacheKey] = { candles: fallbackDb, timestamp: now };
      return fallbackDb;
    }
    const simCandles = this.generateSimulatedCandles(instrument, count, granularity);
    this.candleCache[cacheKey] = { candles: simCandles, timestamp: now };
    return simCandles;
  }

  /**
   * Fetches latest bid/ask quotes.
   * Primary: Redis cache (populated by WebSocketManager).
   */
  public static async fetchLatestQuotes(instruments: string[]): Promise<Quote[]> {
    const quotes: Quote[] = [];
    // Ensure redis is imported at the top of priceFeed.ts
    const { redis } = await import('../db/redis');

    for (const inst of instruments) {
      const normInst = inst.replace('_', '/');

      // 1. Try to get from Redis (ultra-fast)
      const cachedQuote = await redis.getCache<Quote>(`quote:${normInst}`);
      if (cachedQuote) {
        quotes.push(cachedQuote);
        continue;
      }

      // 2. Fallback if Redis is empty (e.g. WebSocket just disconnected)
      // We will pull the latest close price from the local db candle cache
      const fallbackDb = this.getCachedCandles(normInst, 1, '1min');
      let basePrice = fallbackDb.length > 0 ? fallbackDb[0].close : (simPrices[normInst] || BASE_PRICES[normInst] || 1.0850);
      
      const spread = SPREADS[normInst] || (normInst.includes('JPY') ? 0.015 : 0.00015);
      const isSpecial = normInst.includes('JPY') || normInst.includes('XAU');
      
      quotes.push({
        instrument: normInst,
        time: new Date().toISOString(),
        bid: parseFloat((basePrice - spread / 2).toFixed(isSpecial ? 3 : 5)),
        ask: parseFloat((basePrice + spread / 2).toFixed(isSpecial ? 3 : 5)),
      });
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
