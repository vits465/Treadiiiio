import { NewsFilter } from '../src/risk/newsFilter';
import { config } from '../src/config';

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('NewsFilter', () => {
  let originalConfig: any;

  beforeEach(() => {
    jest.resetModules();
    originalConfig = {
      NEWS_BLACKOUT_MINUTES_BEFORE: config.NEWS_BLACKOUT_MINUTES_BEFORE,
      NEWS_BLACKOUT_MINUTES_AFTER: config.NEWS_BLACKOUT_MINUTES_AFTER,
      NEWS_RESTRICT_IMPACT: config.NEWS_RESTRICT_IMPACT,
    };
    config.NEWS_BLACKOUT_MINUTES_BEFORE = 30;
    config.NEWS_BLACKOUT_MINUTES_AFTER = 30;
    config.NEWS_RESTRICT_IMPACT = ['HIGH'];
    
    // Clear internal cache by leveraging any
    (NewsFilter as any).cachedEvents = [];
    (NewsFilter as any).lastFetchTime = 0;
  });

  afterEach(() => {
    Object.assign(config, originalConfig);
    jest.restoreAllMocks();
  });

  it('should fetch and parse XML correctly', async () => {
    const xmlMock = `
      <weeklyevents>
        <event>
          <title>Non-Farm Employment Change</title>
          <country>USD</country>
          <date>07-16-2026</date>
          <time>8:30am</time>
          <impact>High</impact>
          <forecast>200K</forecast>
          <previous>190K</previous>
        </event>
      </weeklyevents>
    `;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => xmlMock,
    });

    await NewsFilter.fetchCalendar();
    
    const events = (NewsFilter as any).cachedEvents;
    expect(events.length).toBe(1);
    expect(events[0].title).toBe('Non-Farm Employment Change');
    expect(events[0].impact).toBe('High');
    expect(events[0].timestamp).toBeGreaterThan(0);
  });

  it('should block trade if within blackout window for matched currency', async () => {
    const now = Date.now();
    (NewsFilter as any).cachedEvents = [
      {
        title: 'Interest Rate Decision',
        country: 'USD',
        impact: 'High',
        timestamp: now + (15 * 60 * 1000) // 15 minutes from now
      }
    ];
    (NewsFilter as any).lastFetchTime = now;

    // Check EUR/USD
    const res = await NewsFilter.canTrade('EUR_USD');
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('Interest Rate Decision');
  });

  it('should allow trade if outside blackout window', async () => {
    const now = Date.now();
    (NewsFilter as any).cachedEvents = [
      {
        title: 'Interest Rate Decision',
        country: 'USD',
        impact: 'High',
        timestamp: now + (45 * 60 * 1000) // 45 minutes from now (outside 30m window)
      }
    ];
    (NewsFilter as any).lastFetchTime = now;

    const res = await NewsFilter.canTrade('EUR_USD');
    expect(res.allowed).toBe(true);
  });

  it('should allow trade if currency does not match', async () => {
    const now = Date.now();
    (NewsFilter as any).cachedEvents = [
      {
        title: 'Interest Rate Decision',
        country: 'GBP',
        impact: 'High',
        timestamp: now + (15 * 60 * 1000)
      }
    ];
    (NewsFilter as any).lastFetchTime = now;

    const res = await NewsFilter.canTrade('EUR_USD');
    expect(res.allowed).toBe(true);
  });

  it('should allow trade if impact is not restricted', async () => {
    const now = Date.now();
    (NewsFilter as any).cachedEvents = [
      {
        title: 'Minor Report',
        country: 'USD',
        impact: 'Low',
        timestamp: now + (15 * 60 * 1000)
      }
    ];
    (NewsFilter as any).lastFetchTime = now;

    const res = await NewsFilter.canTrade('EUR_USD');
    expect(res.allowed).toBe(true);
  });
});
