import { db } from '../db';
import { config } from '../config';
import { logger } from '../logger';
import { Quote } from '../data/priceFeed';
import { PositionInfo } from '../strategy/strategy.interface';
import { RiskManager } from '../risk/riskManager';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { MT5Client } from '../broker/mt5Client';

export const engineEvents = new EventEmitter();

export class TradingEngine {
  private static balance: number = config.STARTING_BALANCE;
  private static paused: boolean = false;

  public static isPaused(): boolean {
    return this.paused;
  }

  public static setPaused(state: boolean) {
    this.paused = state;
    logger.info(`Trading Engine ${state ? 'PAUSED' : 'RESUMED'} by user.`);
  }

  /**
   * Initializes trading engine balance by checking database trade logs.
   */
  public static initialize() {
    const row = db.prepare(`
      SELECT SUM(pnl) as totalPnL
      FROM trades
      WHERE status = 'CLOSED'
    `).get() as { totalPnL: number | null };

    const realizedPnL = row?.totalPnL || 0;
    this.balance = config.STARTING_BALANCE + realizedPnL;
    logger.info(`Trading Engine Initialized. Realized PnL: $${realizedPnL.toFixed(2)}. Current Account Balance: $${this.balance.toFixed(2)}`);

    // Ensure we have an initial equity snapshot if database is empty
    const snapshotsCount = db.prepare(`SELECT COUNT(*) as count FROM equity_snapshots`).get() as { count: number };
    if (snapshotsCount.count === 0) {
      this.saveEquitySnapshot(0);
    }
  }

  public static getBalance(): number {
    return this.balance;
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
   * Executes a market order via MT5 and saves it locally.
   */
  public static async executeOrder(
    instrument: string,
    action: 'BUY' | 'SELL',
    strategy: string,
    quote: Quote,
    stopLossPips?: number,
    takeProfitPips?: number,
    amountToRecover?: number
  ): Promise<string | null> {
    
    // High-Impact News Filter (Block 12:30 PM - 2:00 PM UTC)
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMin = now.getUTCMinutes();
    const isVolatileWindow = (utcHour === 12 && utcMin >= 30) || (utcHour === 13);
    if (isVolatileWindow && strategy !== 'manual') {
      logger.warn(`[NEWS FILTER] Rejected automated ${action} signal for ${instrument} due to high-impact news window (12:30-14:00 UTC).`);
      return null;
    }

    const openCount = this.getOpenPositionsCount();

    if (!RiskManager.checkPositionLimit(openCount)) {
      return null;
    }

    const openPositions = this.getOpenPositions();
    const currentUnrealized = openPositions.reduce((acc, pos) => acc + pos.unrealizedPnL, 0);
    
    if (!RiskManager.checkDailyLossLimit(this.balance, currentUnrealized)) {
      return null;
    }

    if (!RiskManager.checkWeeklyLossLimit(this.balance, currentUnrealized)) {
      return null;
    }

    if (!RiskManager.checkCorrelationExposure(instrument, openPositions, action)) {
      return null;
    }

    const slPips = stopLossPips || 15;
    
    let units = 0;
    if (amountToRecover && amountToRecover > 0) {
      units = RiskManager.calculatePositionSize(instrument, slPips, this.balance);
      logger.info(`[Recovery Sizing] Executing recovery order for ${instrument} to recover $${amountToRecover.toFixed(2)}. Using standard calculated units: ${units}`);
    } else {
      units = RiskManager.calculatePositionSize(instrument, slPips, this.balance);
    }

    if (units <= 0) {
      logger.warn(`Calculated unit size is 0 for ${instrument}. Cancelling execution.`);
      return null;
    }

    const isJpy = instrument.includes('JPY');
    const pipSize = isJpy ? 0.01 : 0.0001;
    const newPositionRiskPct = ((units * slPips * pipSize) / this.balance) * 100;

    if (!RiskManager.checkTotalOpenRisk(this.balance, openPositions, newPositionRiskPct)) {
      return null;
    }

    // Determine lot size from units (e.g., 100,000 units = 1.0 lot)
    // MT5 usually takes volume in lots. E.g., 0.01 for micro lot.
    let volume = units / 100000;
    if (volume < 0.01) volume = 0.01; // Enforce minimum 0.01 lot

    // Call MT5 API
    const mt5Result = await MT5Client.placeOrder(instrument, action, volume, stopLossPips, takeProfitPips);
    
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

    if (stopLossPips) {
      slPrice = action === 'BUY'
        ? entryPrice - stopLossPips * pipSize
        : entryPrice + stopLossPips * pipSize;
      slPrice = parseFloat(slPrice.toFixed(isJpy ? 3 : 5));
    }

    if (takeProfitPips) {
      tpPrice = action === 'BUY'
        ? entryPrice + takeProfitPips * pipSize
        : entryPrice - takeProfitPips * pipSize;
      tpPrice = parseFloat(tpPrice.toFixed(isJpy ? 3 : 5));
    }

    try {
      // Check if column broker_order_id exists, if not add it
      db.prepare(`
        ALTER TABLE positions ADD COLUMN broker_order_id TEXT
      `).run();
    } catch (e) {} // Column probably exists

    try {
      db.prepare(`
        ALTER TABLE trades ADD COLUMN broker_order_id TEXT
      `).run();
    } catch (e) {}

    db.prepare(`
      INSERT INTO positions (id, instrument, action, entry_time, entry_price, units, unrealized_pnl, stop_loss, take_profit, strategy, broker_order_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orderId, instrument, action, entryTime, entryPrice, units, 0, slPrice, tpPrice, strategy, brokerOrderId);

    db.prepare(`
      INSERT INTO trades (id, instrument, action, entry_time, entry_price, units, strategy, status, broker_order_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
    `).run(orderId, instrument, action, entryTime, entryPrice, units, strategy, brokerOrderId);

    logger.info(`[ORDER EXECUTED] MT5 Ticket: ${brokerOrderId} | ${action} ${volume} lots ${instrument} @ ${entryPrice.toFixed(isJpy ? 3 : 5)} | SL: ${slPrice} | TP: ${tpPrice}`);

    const newPos = this.getActivePosition(instrument, strategy);
    if (newPos) {
      engineEvents.emit('position_update', newPos, entryPrice);
    }

    return orderId;
  }

  /**
   * Closes an active position via MT5 and calculates realized PnL.
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
   */
  public static async updatePositionsAndCheckSLTP(quotes: Quote[]) {
    const localPositions = this.getOpenPositions();
    if (localPositions.length === 0) return;

    // Fetch MT5 live positions
    const mt5Positions = await MT5Client.getPositions();
    const mt5Ids = new Set(mt5Positions.map(p => p.order_id));

    // Ensure trailing stop columns exist
    try {
      db.prepare(`ALTER TABLE positions ADD COLUMN max_favorable_price REAL`).run();
      db.prepare(`ALTER TABLE positions ADD COLUMN trailing_stop_pips REAL`).run();
    } catch (e) {} // Exists

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
          continue; // skip event emit below
        }

        const updatedPos = this.getActivePosition(pos.instrument, pos.strategy);
        if (updatedPos) {
          engineEvents.emit('position_update', updatedPos, currentPrice);
        }
      }
    }

    // Circuit Breaker Check
    const totalUnrealized = this.getOpenPositions().reduce((acc, p) => acc + p.unrealizedPnL, 0);
    const currentEquity = this.balance + totalUnrealized;
    const circuitBreakerLevel = config.STARTING_BALANCE * (1 - config.RISK_MAX_DRAWDOWN_PCT / 100);
    
    if (currentEquity < circuitBreakerLevel && !this.isPaused()) {
      logger.error(`🚨 EQUITY CIRCUIT BREAKER TRIGGERED 🚨 Equity ($${currentEquity.toFixed(2)}) dropped below ${config.RISK_MAX_DRAWDOWN_PCT}% drawdown limit ($${circuitBreakerLevel.toFixed(2)}). Halting trading.`);
      this.setPaused(true);
      this.saveEquitySnapshot(totalUnrealized);
    }
  }

  /**
   * Saves a snapshot of account status.
   */
  public static saveEquitySnapshot(unrealizedPnL: number) {
    const time = new Date().toISOString();
    const equity = this.balance + unrealizedPnL;

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
}
