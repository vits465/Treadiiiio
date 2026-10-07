import { config } from '../config';
import { logger } from '../logger';

// Standard session windows in UTC
const SESSIONS = {
  ASIAN:  { start: 23, end: 8 },   // 23:00 - 08:00 UTC (Tokyo/Sydney)
  LONDON: { start: 8,  end: 16 },  // 08:00 - 16:00 UTC
  NY:     { start: 13, end: 21 },  // 13:00 - 21:00 UTC
};

// Static holiday list (Format: MM-DD)
// Covers major global closures.
const MAJOR_HOLIDAYS = [
  '01-01', // New Year's Day
  '12-25', // Christmas Day
  '12-26', // Boxing Day / Day after Christmas (very thin liquidity)
  '12-31', // New Year's Eve (thin liquidity)
];

export class TimeFilter {
  /**
   * Checks if the current time is within one of the configured active trading sessions.
   */
  public static isWithinActiveSession(date: Date = new Date()): boolean {
    const activeSessions = config.TRADING_SESSIONS;
    if (!activeSessions || activeSessions.length === 0) {
      return true; // No sessions configured, allow all
    }

    const currentHour = date.getUTCHours();

    for (const session of activeSessions) {
      const window = SESSIONS[session as keyof typeof SESSIONS];
      if (!window) continue;

      if (window.start > window.end) {
        // Crosses midnight (e.g., Asian session 23:00 - 08:00)
        if (currentHour >= window.start || currentHour < window.end) {
          return true;
        }
      } else {
        // Normal daytime session (e.g., London 08:00 - 16:00)
        if (currentHour >= window.start && currentHour < window.end) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Checks if the current day of the week is an allowed trading day (1=Mon, 5=Fri).
   */
  public static isValidTradingDay(date: Date = new Date()): boolean {
    const allowedDays = config.TRADING_DAYS;
    // getUTCDay() returns 0 for Sunday, 1 for Monday, etc.
    const currentDay = date.getUTCDay();
    return allowedDays.includes(currentDay);
  }

  /**
   * Checks if the current day is a major holiday.
   */
  public static isHoliday(date: Date = new Date()): boolean {
    if (!config.HOLIDAY_GUARD_ENABLED) {
      return false;
    }

    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const dateString = `${month}-${day}`;

    return MAJOR_HOLIDAYS.includes(dateString);
  }

  /**
   * Checks if current time is within Friday close to Sunday open weekend blackout in UTC.
   * - Friday 20:00 UTC through Sunday 22:00 UTC
   */
  public static isWeekendClose(date: Date = new Date()): boolean {
    const day = date.getUTCDay(); // 0 = Sun, 5 = Fri, 6 = Sat
    const hour = date.getUTCHours();

    // Friday after 20:00 UTC
    if (day === 5 && hour >= 20) return true;
    // Saturday all day
    if (day === 6) return true;
    // Sunday before 22:00 UTC
    if (day === 0 && hour < 22) return true;

    return false;
  }

  /**
   * Checks if Sunday market open has occurred (Sunday 22:00 UTC or later).
   */
  public static isSundayOpen(date: Date = new Date()): boolean {
    const day = date.getUTCDay();
    const hour = date.getUTCHours();
    return day === 0 && hour >= 22;
  }

  /**
   * Checks if time is in the daily bank rollover window (21:55 - 22:05 UTC).
   * Spreads typically widen dramatically during this window.
   */
  public static isMidnightRollover(date: Date = new Date()): boolean {
    const hour = date.getUTCHours();
    const min = date.getUTCMinutes();
    const totalMinutes = hour * 60 + min;
    // 21:55 = 1315 min, 22:05 = 1325 min
    return totalMinutes >= 1315 && totalMinutes <= 1325;
  }

  /**
   * Main entry point to check all time-based filters.
   * Returns an object with { allowed: boolean, reason?: string }
   */
  public static canTrade(date: Date = new Date()): { allowed: boolean; reason?: string } {
    if (this.isHoliday(date)) {
      return { allowed: false, reason: 'HOLIDAY_GUARD' };
    }

    if (!this.isValidTradingDay(date)) {
      return { allowed: false, reason: 'OUTSIDE_TRADING_DAYS' };
    }

    if (config.HOLIDAY_GUARD_ENABLED && this.isWeekendClose(date)) {
      return { allowed: false, reason: 'WEEKEND_CLOSE' };
    }

    if (config.HOLIDAY_GUARD_ENABLED && this.isMidnightRollover(date)) {
      return { allowed: false, reason: 'MIDNIGHT_ROLLOVER' };
    }

    if (!this.isWithinActiveSession(date)) {
      return { allowed: false, reason: 'OUTSIDE_ACTIVE_SESSION' };
    }

    return { allowed: true };
  }
}
