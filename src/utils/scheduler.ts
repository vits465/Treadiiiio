import cron from 'node-cron';
import { logger } from '../logger';
import { TradingEngine } from '../engine/tradingEngine';

export class EngineScheduler {
  private static task: cron.ScheduledTask | null = null;

  /**
   * Initializes UTC-driven engine session schedules.
   * - Friday 20:00 UTC: Auto-pause & weekend risk reduction
   * - Sunday 22:00 UTC: Auto-resume trading session
   */
  public static initialize(): void {
    if (this.task) return;

    // Friday 20:00 UTC weekend exit guard (auto-close positions + pause)
    cron.schedule('0 20 * * 5', async () => {
      logger.warn('[SCHEDULER] Friday 20:00 UTC reached. Closing open positions & pausing trading engine for weekend.');
      try {
        const openPositions = TradingEngine.getOpenPositions();
        for (const pos of openPositions) {
          await TradingEngine.closePosition(pos.id, { instrument: pos.instrument, time: new Date().toISOString(), bid: pos.entryPrice, ask: pos.entryPrice }, 'Friday Weekend Guard Auto-Exit');
        }
      } catch (err: any) {
        logger.error(`[SCHEDULER] Error closing positions on Friday: ${err.message}`);
      }
      TradingEngine.setPaused(true);
    }, {
      timezone: 'UTC'
    });

    // Sunday 22:00 UTC market open auto-resume
    cron.schedule('0 22 * * 0', () => {
      logger.info('[SCHEDULER] Sunday 22:00 UTC reached. Resuming trading engine for week open.');
      TradingEngine.setPaused(false);
    }, {
      timezone: 'UTC'
    });

    logger.info('[SCHEDULER] Engine UTC cron scheduler initialized successfully.');
  }
}
