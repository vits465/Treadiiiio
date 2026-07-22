import { db } from '../db';
import { config } from '../config';
import { logger } from '../logger';
import { Quote } from '../data/priceFeed';
import { PositionInfo } from '../strategy/strategy.interface';
import { RiskManager } from '../risk/riskManager';
import { TimeFilter } from '../risk/timeFilter';
import { NewsFilter } from '../risk/newsFilter';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { MT5Client } from '../broker/mt5Client';
import { TelegramNotifier } from '../notifier/telegram';
import { RejectionLogger } from '../risk/rejectionLogger';

export const engineEvents = new EventEmitter();

export class TradingEngine {
  private static balance: number = config.STARTING_BALANCE;
  private static paused: boolean = false;
  /** Peak equity observed since engine start — for the circuit breaker. */
  private static peakEquity: number = config.STARTING_BALANCE;

  public static isPaused(): boolean {
    return this.paused;
  }

  public static setPaused(state: boolean) {
    this.paused = state;
    logger.info(`Trading Engine ${state ? 'PAUSED' : 'RESUMED'} by user.`);
  }

  /**
   * Initializes trading engine balance by checking database trade logs.
   * Also restores peak equity from historical snapshots.
   */
  public static initialize() {
    const row = db.prepare(`
      SELECT SUM(pnl) as totalPnL
      FROM trades
      WHERE status = 'CLOSED'
    `).get() as { totalPnL: number | null };

    const realizedPnL = row?.totalPnL || 0;
    this.balance = config.STARTING_BALANCE + realizedPnL;

    // Restore peak equity from DB snapshots
    const peakRow = db.prepare(`
      SELECT MAX(equity) as peak FROM equity_snapshots
    `).get() as { peak: number | null };
    this.peakEquity = Math.max(config.STARTING_BALANCE, peakRow?.peak || config.STARTING_BALANCE, this.balance);

    logger.info(
      `Trading Engine Initialized. Realized PnL: $${realizedPnL.toFixed(2)}. ` +
      `Current Balance: $${this.balance.toFixed(2)}. Peak Equity: $${this.peakEquity.toFixed(2)}.`
    );

    // Ensure we have an initial equity snapshot if database is empty
    const snapshotsCount = db.prepare(`SELECT COUNT(*) as count FROM equity_snapshots`).get() as { count: number };
    if (snapshotsCount.count === 0) {
      this.saveEquitySnapshot(0);
    }
  }

  public static getBalance(): number {
    return this.balance;
  }

  public static getPeakEquity(): number {
    return this.peakEquity;
  }

  /**
   * Returns the dollar level at which the peak-equity drawdown circuit breaker trips.
   */
  public static getCircuitBreakerLevel(): number {
    return this.peakEquity * (1 - config.RISK_MAX_DRAWDOWN_PCT / 100);
  }

  /**
   * Fetches all currently open positions from DB.
   */
  public static getOpenPositions(): PositionInfo[] {
    const rows = db.prepare(`
      SELECT id, instrument, action, entry_time as entryTime, entry_price as entryPrice, 
             units, unrealized_pnl as unrealizedPnL, stop_loss as stopLoss, 
             take_profit as takeProfit, strategy, broker_order_id as brokerOrderId
      FROM positions
    `).all();
    return rows as PositionInfo[];
  }

  /**
   * Fetches count of open positions.
   */
  public static getOpenPositionsCount(): number {
    const row = db.prepare(`SELECT COUNT(*) as count FROM positions`).get() as { count: number };
    return row.count;
  }

  /**
   * Fetches open position for specific instrument and strategy.
   */
  public static getActivePosition(instrument: string, strategy?: string): PositionInfo | null {
    if (strategy) {
      const row = db.prepare(`
        SELECT id, instrument, action, entry_time as entryTime, entry_price as entryPrice, 
               units, unrealized_pnl as unrealizedPnL, stop_loss as stopLoss, 
               take_profit as takeProfit, strategy, broker_order_id as brokerOrderId
        FROM positions
        WHERE instrument = ? AND strategy = ?
      `).get(instrument, strategy);
      return (row as PositionInfo) || null;
    } else {
      const row = db.prepare(`
        SELECT id, instrument, action, entry_time as entryTime, entry_price as entryPrice, 
               units, unrealized_pnl as unrealizedPnL, stop_loss as stopLoss, 
               take_profit as takeProfit, strategy, broker_order_id as brokerOrderId
        FROM positions
        WHERE instrument = ?
      `).get(instrument);
      return (row as PositionInfo) || null;
    }
  }

  /**
   * Executes a market order via MT5 (or simulator) and saves it locally.
   *
   * Area 1: Uses calculateSizedOrder for dynamic sizing and persists risk_pct.
   * Area 4: Checks consecutive-loss cooldown before executing.
   *
   * Works for both real MT5 mode (USE_SIMULATOR=false) and paper trading
   * (USE_SIMULATOR=true) — MT5Client handles the branching internally.
   */
  public static async executeOrder(
    instrument: string,
    action: 'BUY' | 'SELL',
    strategy: string,
    quote: Quote,
    stopLossPips?: number,
    takeProfitPips?: number,
    amountToRecover?: number,
    atr?: number,
    mlConfidence?: number,
    atrPercentile?: number
  ): Promise<string | null> {
    if (this.paused) {
      logger.debug('Engine is paused, rejecting order.');
      return null;
    }

    if (!RiskManager.checkTradeDirection(action, instrument)) {
      return null;
    }

    // Area 4: Consecutive-loss cooldown
    if (!RiskManager.checkConsecutiveLossCooldown(instrument, strategy)) {
      return null;
    }

    const timeCheck = TimeFilter.canTrade();
    if (!timeCheck.allowed) {
      logger.warn(`[TIME FILTER] Rejected automated ${action} signal for ${instrument}. Reason: ${timeCheck.reason}`);
      RejectionLogger.log('TradingEngine.timeFilter', timeCheck.reason as any || 'TIME_FILTER', instrument, action, strategy, 'Outside allowed trading window');
      return null;
    }

    const newsCheck = await NewsFilter.canTrade(instrument);
    if (!newsCheck.allowed) {
      logger.warn(`[NEWS FILTER] Rejected automated ${action} signal for ${instrument}. Reason: ${newsCheck.reason}`);
      RejectionLogger.log('TradingEngine.newsFilter', 'NEWS_WINDOW', instrument, action, strategy, newsCheck.reason);
      return null;
    }

    const openCount = this.getOpenPositionsCount();

    if (!RiskManager.checkPositionLimit(openCount, instrument)) {
      return null;
    }

    const openPositions = this.getOpenPositions();
    const currentUnrealized = openPositions.reduce((acc, pos) => acc + pos.unrealizedPnL, 0);
    
    if (!RiskManager.checkDailyProfitLock(this.balance, currentUnrealized, instrument)) {
      return null;
    }

    if (!RiskManager.checkDailyLossLimit(this.balance, currentUnrealized, instrument)) {
      return null;
    }

    if (!RiskManager.checkWeeklyLossLimit(this.balance, currentUnrealized, instrument)) {
      return null;
    }

    if (!RiskManager.checkCorrelationExposure(instrument, openPositions, action)) {
      return null;
    }

    const isJpy = instrument.includes('JPY');
    const isXau = instrument.includes('XAU');
    const pipSize = (isJpy || isXau) ? 0.01 : 0.0001;
    
    // To achieve a ~75% win rate (3-4 wins out of 5) in a random walk, we set SL to be 3x larger than TP.
    // This also has the side effect of making the lot size 3x smaller!
    let slPips = stopLossPips || (isXau ? 900 : 45);
    let tpPips = takeProfitPips || (isXau ? 300 : 15);

    if (config.USE_ATR_SIZING && atr && atr > 0) {
      // ATR is in raw price points. Convert to pips.
      const atrPips = atr / pipSize;
      slPips = atrPips * config.ATR_SL_MULTIPLIER;
      tpPips = atrPips * config.ATR_TP_MULTIPLIER;
      logger.info(`[ATR SIZING] Used ATR (${atr.toFixed(5)}) for ${instrument} to calculate SL: ${slPips.toFixed(1)} pips, TP: ${tpPips.toFixed(1)} pips`);
    }
    
    // Area 1: Dynamic sizing with confidence + volatility scalars
    const currentPrice = action === 'BUY' ? quote.ask : quote.bid;
    const sized = RiskManager.calculateSizedOrder(
      instrument,
      slPips,
      this.balance,
      mlConfidence,   // undefined for rule-based strategies → no confidence scaling
      atrPercentile,  // undefined if not computed → no volatility scaling
      currentPrice    // used for USD/XXX quote currency conversion
    );

    if (sized.units <= 0) {
      logger.warn(`Calculated unit size is 0 for ${instrument}. Cancelling execution.`);
      RejectionLogger.log('TradingEngine.executeOrder', 'ZERO_UNITS', instrument, action, strategy, 'Position size calculated as 0');
      return null;
    }

    // Final total-open-risk check using the actual risk that will be used
    if (!RiskManager.checkTotalOpenRisk(this.balance, openPositions, sized.riskPctUsed, instrument)) {
      return null;
    }

    // Determine lot size from units; MT5 takes volume in lots. Gold is 100 oz per lot, Forex is 100,000.
    const contractSize = isXau ? 100 : 100000;
    let volume = sized.units / contractSize;
    const minVolume = isXau ? 0.001 : 0.01;
    if (volume < minVolume) volume = minVolume; // Enforce minimum lot size

    // Call MT5 API (handles both live and simulator modes)
    const mt5Result = await MT5Client.placeOrder(instrument, action, volume, slPips, tpPips, currentPrice);
    
    if (!mt5Result) {
      logger.error(`MT5 execution failed for ${instrument} ${action}. Local DB not updated.`);
      return null;
    }

    const entryPrice = mt5Result.price;
    const brokerOrderId = mt5Result.order_id;
    const orderId = uuidv4();
    const entryTime = new Date().toISOString();

    let slPrice: number | null = null;
    let tpPrice: number | null = null;

    if (slPips) {
      slPrice = action === 'BUY'
        ? entryPrice - slPips * pipSize
        : entryPrice + slPips * pipSize;
      slPrice = parseFloat(slPrice.toFixed((isJpy || isXau) ? 3 : 5));
    }

    if (tpPips) {
      tpPrice = action === 'BUY'
        ? entryPrice + tpPips * pipSize
        : entryPrice - tpPips * pipSize;
      tpPrice = parseFloat(tpPrice.toFixed((isJpy || isXau) ? 3 : 5));
    }

    db.prepare(`
      INSERT INTO positions (id, instrument, action, entry_time, entry_price, units, unrealized_pnl, stop_loss, take_profit, strategy, broker_order_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orderId, instrument, action, entryTime, entryPrice, sized.units, 0, slPrice, tpPrice, strategy, brokerOrderId);

    // Persist actual risk_pct taken for downstream accounting (recovery budget, audits)
    db.prepare(`
      INSERT INTO trades (id, instrument, action, entry_time, entry_price, units, strategy, status, broker_order_id, risk_pct)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)
    `).run(orderId, instrument, action, entryTime, entryPrice, sized.units, strategy, brokerOrderId, sized.riskPctUsed);

    logger.info(`[ORDER EXECUTED] MT5 Ticket: ${brokerOrderId} | ${action} ${volume.toFixed(2)} lots ${instrument} @ ${entryPrice.toFixed((isJpy || isXau) ? 3 : 5)} | SL: ${slPrice} | TP: ${tpPrice} | Risk: ${sized.riskPctUsed.toFixed(3)}%`);

    const newPos = this.getActivePosition(instrument, strategy);
    if (newPos) {
      engineEvents.emit('position_update', newPos, entryPrice);
    }

    return orderId;
  }

  /**
   * Closes an active position via MT5 and calculates realized PnL.
   * Works for both live and simulator modes.
   */
  public static async closePosition(positionId: string, quote: Quote, reason: string): Promise<number> {
    const pos = db.prepare(`
      SELECT id, instrument, action, entry_price, units, strategy, broker_order_id
      FROM positions
      WHERE id = ?
    `).get(positionId) as { id: string; instrument: string; action: string; entry_price: number; units: number; strategy: string; broker_order_id: string } | undefined;

    if (!pos) {
      logger.warn(`Could not close position: Position with ID ${positionId} not found locally.`);
      return 0;
    }

    if (pos.broker_order_id) {
      const closedInMt5 = await MT5Client.closeOrder(pos.broker_order_id);
      if (!closedInMt5) {
        logger.error(`Failed to close order ${pos.broker_order_id} in MT5. Please check MT5 terminal.`);
      }
    }

    const isJpy = pos.instrument.includes('JPY');
    let exitPrice = pos.action === 'BUY' ? quote.bid : quote.ask;
    exitPrice = parseFloat(exitPrice.toFixed(isJpy ? 3 : 5));

    let pnl = 0;
    if (pos.action === 'BUY') {
      pnl = (exitPrice - pos.entry_price) * pos.units;
    } else {
      pnl = (pos.entry_price - exitPrice) * pos.units;
    }

    const exitTime = new Date().toISOString();

    db.prepare(`DELETE FROM positions WHERE id = ?`).run(positionId);

    db.prepare(`
      UPDATE trades
      SET exit_time = ?, exit_price = ?, pnl = ?, status = 'CLOSED'
      WHERE id = ?
    `).run(exitTime, exitPrice, pnl, positionId);

    this.balance += pnl;

    const closedTrade = db.prepare(`SELECT * FROM trades WHERE id = ?`).get(positionId);
    if (closedTrade) {
      engineEvents.emit('trade_closed', closedTrade);
    }

    logger.info(`[POSITION CLOSED] ${pos.action} ${pos.instrument} closed @ ${exitPrice.toFixed(isJpy ? 3 : 5)} | Realized PnL: $${pnl.toFixed(2)} | Reason: ${reason}`);

    return pnl;
  }

  /**
   * Syncs active positions from MT5 and triggers closures if hit SL/TP externally.
   * Also implements local Trailing Stop logic if position crosses threshold.
   *
   * Area 4: The peak-equity drawdown breaker is now also evaluated here,
   * but the every-tick call in the main loop ensures it trips even with
   * zero open positions (purely realized drawdown case).
   */
  public static async updatePositionsAndCheckSLTP(quotes: Quote[]) {
    const localPositions = this.getOpenPositions();

    // Fetch MT5 live positions
    const mt5Positions = await MT5Client.getPositions();
    const mt5Ids = new Set(mt5Positions.map(p => p.order_id));

    for (const pos of localPositions) {
      const quote = quotes.find((q) => q.instrument === pos.instrument);
      
      // If position was closed in MT5 (e.g. SL or TP hit)
      if ((pos as any).brokerOrderId && !mt5Ids.has((pos as any).brokerOrderId)) {
        logger.info(`Position ${pos.id} (Broker: ${(pos as any).brokerOrderId}) no longer found in MT5. Assuming closed by broker.`);
        if (quote) {
           await this.closePosition(pos.id, quote, 'Closed by MT5 (SL/TP/Manual)');
        }
        continue;
      }

      const mt5Match = mt5Positions.find(p => p.order_id === (pos as any).brokerOrderId);
      let unrealizedPnL = 0;
      
      if (mt5Match) {
        unrealizedPnL = mt5Match.profit;
      } else if (quote) {
        unrealizedPnL = pos.action === 'BUY' 
          ? (quote.bid - pos.entryPrice) * pos.units 
          : (pos.entryPrice - quote.ask) * pos.units;
      }

      db.prepare(`
        UPDATE positions
        SET unrealized_pnl = ?
        WHERE id = ?
      `).run(unrealizedPnL, pos.id);

      // --- Trailing Stop Logic ---
      if (quote) {
        const isJpy = pos.instrument.includes('JPY');
        const pipSize = isJpy ? 0.01 : 0.0001;
        const currentPrice = pos.action === 'BUY' ? quote.bid : quote.ask;
        
        // Trailing Stop Logic (Trail by 15 pips once in 15 pips profit)
        const trailingPips = 15; 
        
        const posRow = db.prepare(`SELECT max_favorable_price FROM positions WHERE id = ?`).get(pos.id) as any;
        let maxFavorable = posRow?.max_favorable_price || pos.entryPrice;
        
        let trailingStopHit = false;

        if (pos.action === 'BUY') {
          if (currentPrice > maxFavorable) {
            maxFavorable = currentPrice;
            db.prepare(`UPDATE positions SET max_favorable_price = ? WHERE id = ?`).run(maxFavorable, pos.id);
          }
          // Only trail after 15 pips profit
          if (maxFavorable - pos.entryPrice > 15 * pipSize) { 
             if (currentPrice <= maxFavorable - (trailingPips * pipSize)) {
               trailingStopHit = true;
             }
          }
        } else {
          // SELL
          if (currentPrice < maxFavorable) {
            maxFavorable = currentPrice;
            db.prepare(`UPDATE positions SET max_favorable_price = ? WHERE id = ?`).run(maxFavorable, pos.id);
          }
          if (pos.entryPrice - maxFavorable > 15 * pipSize) {
             if (currentPrice >= maxFavorable + (trailingPips * pipSize)) {
               trailingStopHit = true;
             }
          }
        }

        if (trailingStopHit) {
          logger.info(`Trailing stop of ${trailingPips} pips hit for ${pos.id}. Closing...`);
          await this.closePosition(pos.id, quote, 'Trailing Stop Triggered');
          continue;
        }

        const updatedPos = this.getActivePosition(pos.instrument, pos.strategy);
        if (updatedPos) {
          engineEvents.emit('position_update', updatedPos, currentPrice);
        }
      }
    }

    // Area 4: Circuit breaker evaluation (also runs every tick in the main loop)
    const totalUnrealized = this.getOpenPositions().reduce((acc, p) => acc + p.unrealizedPnL, 0);
    const currentEquity = this.balance + totalUnrealized;
    this.checkCircuitBreakers(currentEquity);
  }

  /**
   * Area 4: Peak-equity drawdown circuit breaker.
   *
   * The kill-switch level is max(STARTING_BALANCE, peakEquity) × (1 − RISK_MAX_DRAWDOWN_PCT/100).
   * An account that grew to $12,000 halts at $8,400 (30% drawdown from peak),
   * not at the old static $7,000 from starting balance.
   *
   * Once tripped the engine pauses and requires manual re-arm (dashboard Start
   * or Telegram /resume) — it never auto-resumes.
   *
   * This method is called both from updatePositionsAndCheckSLTP AND from the
   * main loop every tick so purely realized drawdowns (zero open positions)
   * can still trip the breaker.
   */
  public static checkCircuitBreakers(currentEquity: number): void {
    // Update peak equity
    if (currentEquity > this.peakEquity) {
      this.peakEquity = currentEquity;
    }

    const circuitBreakerLevel = this.getCircuitBreakerLevel();

    if (currentEquity < circuitBreakerLevel && !this.isPaused()) {
      logger.error(
        `🚨 EQUITY CIRCUIT BREAKER TRIGGERED 🚨 ` +
        `Equity ($${currentEquity.toFixed(2)}) dropped below ${config.RISK_MAX_DRAWDOWN_PCT}% ` +
        `drawdown from peak ($${this.peakEquity.toFixed(2)}) = limit $${circuitBreakerLevel.toFixed(2)}. ` +
        `Halting trading — manual re-arm required.`
      );
      this.paused = true;
      TelegramNotifier.sendMessage(
        `🚨 *CIRCUIT BREAKER TRIGGERED*\n` +
        `Equity: $${currentEquity.toFixed(2)}\n` +
        `Peak was: $${this.peakEquity.toFixed(2)}\n` +
        `Drawdown limit: ${config.RISK_MAX_DRAWDOWN_PCT}% → floor $${circuitBreakerLevel.toFixed(2)}\n` +
        `Trading HALTED. Use dashboard Start or /resume to restart.`
      );
      this.saveEquitySnapshot(currentEquity - this.balance);
    }
  }

  /**
   * Saves a snapshot of account status.
   */
  public static saveEquitySnapshot(unrealizedPnL: number) {
    const time = new Date().toISOString();
    const equity = this.balance + unrealizedPnL;

    // Update in-memory peak
    if (equity > this.peakEquity) {
      this.peakEquity = equity;
    }

    const row = db.prepare(`
      SELECT MAX(equity) as peak
      FROM equity_snapshots
    `).get() as { peak: number | null };

    const peak = Math.max(row?.peak || config.STARTING_BALANCE, equity);
    const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0;

    db.prepare(`
      INSERT OR REPLACE INTO equity_snapshots (time, balance, equity, unrealized_pnl, drawdown)
      VALUES (?, ?, ?, ?, ?)
    `).run(time, this.balance, equity, unrealizedPnL, drawdown);

    engineEvents.emit('equity_tick', { balance: this.balance, equity, timestamp: time });
  }

  /**
   * Pause engine and close all active positions.
   */
  public static async killAndFlatten(reason: string = 'KILL SWITCH'): Promise<number> {
    this.paused = true;
    logger.info(`Trading Engine paused and flattening all positions. Reason: ${reason}`);
    
    const openPositions = this.getOpenPositions();
    let closedCount = 0;

    const { PriceFeed } = require('../data/priceFeed');
    for (const pos of openPositions) {
      const quote = PriceFeed.getLatestQuote(pos.instrument);
      if (quote) {
        await this.closePosition(pos.id, quote, reason);
        closedCount++;
      }
    }
    return closedCount;
  }
}
