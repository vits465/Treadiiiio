import { db } from '../db';
import { logger } from '../logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Reason codes for trade filter rejections.
 * Each code corresponds to a specific risk/safety check that blocked a trade.
 */
export type RejectionReasonCode =
  | 'POSITION_LIMIT'
  | 'DAILY_LOSS_LIMIT'
  | 'WEEKLY_LOSS_LIMIT'
  | 'CORRELATION_EXPOSURE'
  | 'NEWS_WINDOW'
  | 'ML_CONFIDENCE_LOW'
  | 'ML_NO_RULE_CONFIRM'
  | 'TOTAL_OPEN_RISK'
  | 'MIN_LOT_SIZE'
  | 'MIN_LOT_RISK_EXCEEDED'
  | 'ZERO_UNITS'
  | 'DAILY_PROFIT_LOCK'
  | 'DIRECTION_RESTRICTION'
  | 'TIME_FILTER'
  | 'CONSECUTIVE_LOSS_COOLDOWN'
  | 'DAILY_CIRCUIT_BREAKER'
  | 'RECOVERY_DISABLED';

/**
 * Logs a trade rejection into the filter_rejections table for audit purposes.
 */
export class RejectionLogger {
  public static log(
    filterName: string,
    reasonCode: RejectionReasonCode,
    instrument: string,
    direction?: string,
    strategy?: string,
    details?: string,
    mlConfidence?: number
  ): void {
    try {
      db.prepare(`
        INSERT INTO filter_rejections (id, timestamp, filter_name, reason_code, instrument, direction, strategy, details, ml_confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        uuidv4(),
        new Date().toISOString(),
        filterName,
        reasonCode,
        instrument,
        direction || null,
        strategy || null,
        details || null,
        mlConfidence ?? null
      );
    } catch (err) {
      logger.debug(`Failed to log rejection: ${err}`);
    }
  }
}
