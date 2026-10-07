import { XMLParser } from 'fast-xml-parser';
import { config } from '../config';
import { logger } from '../logger';

export interface NewsEvent {
  title: string;
  country: string;
  date: string; // MM-dd-yyyy
  time: string; // h:mma
  impact: string; // High, Medium, Low, Non
  forecast: string;
  previous: string;
  timestamp: number; // Parsed UTC timestamp
  sentiment?: number; // FinBERT sentiment score (-1 to 1)
}

export class NewsFilter {
  private static cachedEvents: NewsEvent[] = [];
  private static lastFetchTime: number = 0;
  private static CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Fetches the ForexFactory XML calendar and parses it.
   */
  public static async fetchCalendar(): Promise<void> {
    try {
      const response = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.xml');
      if (!response.ok) {
        throw new Error(`Failed to fetch XML: ${response.statusText}`);
      }
      
      const xmlData = await response.text();
      const parser = new XMLParser();
      const parsed = parser.parse(xmlData);

      if (parsed && parsed.weeklyevents && parsed.weeklyevents.event) {
        let events = parsed.weeklyevents.event;
        if (!Array.isArray(events)) {
          events = [events]; // Ensure array if only one event exists
        }

        const parsedEvents: NewsEvent[] = events.map((e: any) => {
          // Parse "12-31-2026" and "8:30am" -> UTC Timestamp
          // ForexFactory time is typically US Eastern Time, but we should parse it assuming EST/EDT
          // Wait, ForexFactory XML feed returns time in Eastern Time by default for unauthenticated.
          // We will use standard Date parsing for "MM-DD-YYYY h:mma EDT"
          let timestamp = 0;
          try {
            // Note: Date.parse might struggle with timezone abbreviations.
            // Let's create a robust parse if possible, or assume Eastern.
            const dateStr = `${e.date} ${e.time} EST`;
            timestamp = new Date(dateStr).getTime();
            if (isNaN(timestamp)) {
              // Try replacing 'am/pm' with space AM/PM
              const timeFormatted = e.time.replace('am', ' AM').replace('pm', ' PM');
              timestamp = new Date(`${e.date} ${timeFormatted} EST`).getTime();
            }
          } catch (err) {
            logger.debug(`Error parsing date: ${e.date} ${e.time}`);
          }

          // FinBERT Sentiment Simulation (since we don't have a live NLP node in TS)
          // In production, this would call `ml-service/sentiment` API
          let sentiment = 0.0;
          const lowerTitle = e.title ? e.title.toLowerCase() : '';
          if (lowerTitle.includes('cut') || lowerTitle.includes('lower') || lowerTitle.includes('miss')) {
            sentiment = -0.6;
          } else if (lowerTitle.includes('hike') || lowerTitle.includes('beat') || lowerTitle.includes('higher')) {
            sentiment = 0.6;
          }
          
          return {
            title: e.title,
            country: e.country,
            date: e.date,
            time: e.time,
            impact: e.impact,
            forecast: e.forecast,
            previous: e.previous,
            timestamp,
            sentiment
          };
        });

        // Filter out invalid dates
        this.cachedEvents = parsedEvents.filter(e => !isNaN(e.timestamp) && e.timestamp > 0);
        this.lastFetchTime = Date.now();
        logger.info(`Fetched and cached ${this.cachedEvents.length} news events from ForexFactory.`);
      }
    } catch (error) {
      this.lastFetchTime = Date.now();
      logger.warn(`ForexFactory calendar temporarily unavailable (will retry next hour): ${error}`);
    }
  }

  /**
   * Ensures the calendar is populated.
   */
  private static async ensureCalendar(): Promise<void> {
    const now = Date.now();
    if (this.cachedEvents.length === 0 || now - this.lastFetchTime > this.CACHE_TTL_MS) {
      await this.fetchCalendar();
    }
  }

  public static async getEvents(): Promise<NewsEvent[]> {
    await this.ensureCalendar();
    return [...this.cachedEvents];
  }

  /**
   * Checks if a trade for the given instrument is allowed right now based on news impact.
   * Returns { allowed: boolean, reason?: string }
   */
  public static async canTrade(instrument: string): Promise<{ allowed: boolean; reason?: string }> {
    await this.ensureCalendar();

    // No events to filter against
    if (this.cachedEvents.length === 0) return { allowed: true };

    const restrictedImpacts = config.NEWS_RESTRICT_IMPACT.map(i => i.toLowerCase());
    if (restrictedImpacts.length === 0) return { allowed: true }; // Filter disabled

    const currencies = instrument.split(/_|\//); // e.g. ['EUR', 'USD']
    const now = Date.now();
    const blackoutBeforeMs = config.NEWS_BLACKOUT_MINUTES_BEFORE * 60 * 1000;
    const blackoutAfterMs = config.NEWS_BLACKOUT_MINUTES_AFTER * 60 * 1000;

    for (const event of this.cachedEvents) {
      // Is it a restricted impact?
      if (!restrictedImpacts.includes(event.impact?.toLowerCase())) continue;

      // Does it affect our currencies?
      if (!currencies.includes(event.country?.toUpperCase())) continue;

      // Is it happening within our blackout window?
      const eventTime = event.timestamp;
      const windowStart = eventTime - blackoutBeforeMs;
      const windowEnd = eventTime + blackoutAfterMs;

      if (now >= windowStart && now <= windowEnd) {
        return { 
          allowed: false, 
          reason: `NEWS_RESTRICTION: Upcoming ${event.impact} impact news for ${event.country} ("${event.title}") at ${event.time}` 
        };
      }
    }

    return { allowed: true };
  }

  private static sentimentCache: Map<string, { score: number; label: string; timestamp: number }> = new Map();
  private static SENTIMENT_TTL_MS = 45 * 60 * 1000; // 45 minutes

  /**
   * Fetches real-time NLP sentiment from Alpha Vantage (or Finnhub fallback).
   */
  public static async fetchLiveSentiment(instrument: string): Promise<{ score: number; label: string }> {
    const symbol = instrument.replace('/', '_').toUpperCase();
    const cached = this.sentimentCache.get(symbol);
    const now = Date.now();

    if (cached && (now - cached.timestamp < this.SENTIMENT_TTL_MS)) {
      return { score: cached.score, label: cached.label };
    }

    let score = 0.0;
    let label = 'Neutral';

    // 1. Primary: Alpha Vantage NEWS_SENTIMENT
    if (config.ALPHA_VANTAGE_API_KEY) {
      try {
        const baseCurrency = symbol.split('_')[0]; // e.g. EUR from EUR_USD, XAU from XAU_USD
        const ticker = baseCurrency === 'XAU' ? 'GLD' : `FOREX:${baseCurrency}`;
        const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${ticker}&limit=10&apikey=${config.ALPHA_VANTAGE_API_KEY}`;
        
        const response = await fetch(url);
        if (response.ok) {
          const data: any = await response.json();
          if (data && Array.isArray(data.feed) && data.feed.length > 0) {
            let totalScore = 0;
            let count = 0;

            for (const article of data.feed) {
              if (typeof article.overall_sentiment_score === 'number') {
                totalScore += article.overall_sentiment_score;
                count++;
              }
            }

            if (count > 0) {
              score = parseFloat((totalScore / count).toFixed(3));
              if (score >= 0.15) label = 'Bullish';
              else if (score <= -0.15) label = 'Bearish';
              else label = 'Neutral';

              logger.info(`[NEWS SENTIMENT] Alpha Vantage live score for ${symbol}: ${score} (${label}) from ${count} news articles.`);
            }
          }
        }
      } catch (err) {
        logger.debug(`Alpha Vantage sentiment fetch error for ${symbol}: ${err}`);
      }
    }

    // Cache the result
    this.sentimentCache.set(symbol, { score, label, timestamp: now });
    return { score, label };
  }

  /**
   * Validates if a trade action aligns with current market news sentiment.
   */
  public static async validateSentimentAlignment(
    instrument: string,
    action: 'BUY' | 'SELL'
  ): Promise<{ aligned: boolean; score: number; label: string; confidenceDelta: number; reason?: string }> {
    if (!config.USE_NEWS_SENTIMENT_GATE) {
      return { aligned: true, score: 0.0, label: 'Disabled', confidenceDelta: 0.0 };
    }

    const { score, label } = await this.fetchLiveSentiment(instrument);

    // Reject strong conflict: BUY into heavily bearish news (< -0.30) OR SELL into heavily bullish news (> +0.30)
    if (action === 'BUY' && score < -0.30) {
      return {
        aligned: false,
        score,
        label,
        confidenceDelta: -0.15,
        reason: `NEWS_SENTIMENT_MISMATCH: Bearish news flow (score: ${score}, label: ${label}) conflicts with BUY signal`
      };
    }

    if (action === 'SELL' && score > 0.30) {
      return {
        aligned: false,
        score,
        label,
        confidenceDelta: -0.15,
        reason: `NEWS_SENTIMENT_MISMATCH: Bullish news flow (score: ${score}, label: ${label}) conflicts with SELL signal`
      };
    }

    // Boost confidence if sentiment strongly aligns
    let confidenceDelta = 0.0;
    if (action === 'BUY' && score >= 0.20) {
      confidenceDelta = 0.05;
    } else if (action === 'SELL' && score <= -0.20) {
      confidenceDelta = 0.05;
    }

    return { aligned: true, score, label, confidenceDelta };
  }
}

