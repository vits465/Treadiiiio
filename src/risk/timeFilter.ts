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

    if (!this.isWithinActiveSession(date)) {
      return { allowed: false, reason: 'OUTSIDE_ACTIVE_SESSION' };
    }

    return { allowed: true };
  }
}
