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

          return {
            title: e.title,
            country: e.country,
            date: e.date,
            time: e.time,
            impact: e.impact,
            forecast: e.forecast,
            previous: e.previous,
            timestamp
          };
        });

        // Filter out invalid dates
        this.cachedEvents = parsedEvents.filter(e => !isNaN(e.timestamp) && e.timestamp > 0);
        this.lastFetchTime = Date.now();
        logger.info(`Fetched and cached ${this.cachedEvents.length} news events from ForexFactory.`);
      }
    } catch (error) {
      logger.error(`Error fetching ForexFactory calendar: ${error}`);
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
}
