import { TimeFilter } from '../src/risk/timeFilter';
import { config } from '../src/config';

describe('TimeFilter', () => {
  let originalConfig: any;

  beforeEach(() => {
    originalConfig = {
      TRADING_SESSIONS: config.TRADING_SESSIONS,
      TRADING_DAYS: config.TRADING_DAYS,
      HOLIDAY_GUARD_ENABLED: config.HOLIDAY_GUARD_ENABLED,
    };
    config.TRADING_SESSIONS = ['LONDON', 'NY'];
    config.TRADING_DAYS = [1, 2, 3, 4, 5];
    config.HOLIDAY_GUARD_ENABLED = true;
  });

  afterEach(() => {
    Object.assign(config, originalConfig);
  });

  describe('isWithinActiveSession', () => {
    it('should allow trading during London session', () => {
      // London is 08:00 - 16:00 UTC
      const date = new Date('2026-07-15T10:00:00Z'); // 10:00 UTC
      expect(TimeFilter.isWithinActiveSession(date)).toBe(true);
    });

    it('should reject trading outside configured sessions', () => {
      // 06:00 UTC is outside London and NY
      const date = new Date('2026-07-15T06:00:00Z'); 
      expect(TimeFilter.isWithinActiveSession(date)).toBe(false);
    });

    it('should allow trading across midnight (Asian session)', () => {
      config.TRADING_SESSIONS = ['ASIAN'];
      // Asian is 23:00 - 08:00
      const date1 = new Date('2026-07-15T23:30:00Z');
      const date2 = new Date('2026-07-16T04:00:00Z');
      expect(TimeFilter.isWithinActiveSession(date1)).toBe(true);
      expect(TimeFilter.isWithinActiveSession(date2)).toBe(true);
    });
  });

  describe('isValidTradingDay', () => {
    it('should allow Monday to Friday', () => {
      const monday = new Date('2026-07-13T12:00:00Z');
      expect(TimeFilter.isValidTradingDay(monday)).toBe(true);
    });

    it('should reject Saturday and Sunday', () => {
      const saturday = new Date('2026-07-11T12:00:00Z');
      const sunday = new Date('2026-07-12T12:00:00Z');
      expect(TimeFilter.isValidTradingDay(saturday)).toBe(false);
      expect(TimeFilter.isValidTradingDay(sunday)).toBe(false);
    });
  });

  describe('isHoliday', () => {
    it('should block Christmas', () => {
      const xmas = new Date('2026-12-25T12:00:00Z');
      expect(TimeFilter.isHoliday(xmas)).toBe(true);
    });

    it('should allow normal days', () => {
      const normal = new Date('2026-07-15T12:00:00Z');
      expect(TimeFilter.isHoliday(normal)).toBe(false);
    });

    it('should bypass holiday guard if disabled', () => {
      config.HOLIDAY_GUARD_ENABLED = false;
      const xmas = new Date('2026-12-25T12:00:00Z');
      expect(TimeFilter.isHoliday(xmas)).toBe(false);
    });
  });

  describe('canTrade integration', () => {
    it('should return allowed for valid time', () => {
      // Wednesday (valid), 10:00 UTC (London), not a holiday
      const valid = new Date('2026-07-15T10:00:00Z');
      const res = TimeFilter.canTrade(valid);
      expect(res.allowed).toBe(true);
    });

    it('should return reason for invalid time', () => {
      // Sunday
      const invalid = new Date('2026-07-12T10:00:00Z');
      const res = TimeFilter.canTrade(invalid);
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('OUTSIDE_TRADING_DAYS');
    });
  });
});
