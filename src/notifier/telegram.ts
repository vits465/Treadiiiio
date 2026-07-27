import https from 'https';
import { logger } from '../logger';
import { TradingEngine } from '../engine/tradingEngine';
import { PriceFeed } from '../data/priceFeed';
import { db } from '../db';
import { config } from '../config';
export class TelegramNotifier {
  private static botToken: string | undefined;
  private static chatId: string | undefined;
  private static enabled = false;
  private static lastUpdateId = 0;
  private static isPolling = false;
  private static killConfirmPending = false;
  private static killConfirmTimeout: NodeJS.Timeout | null = null;

  public static initialize(token?: string, chat?: string) {
    this.botToken = token;
    this.chatId = chat;
    if (this.botToken && this.chatId && this.botToken.trim() !== '' && this.chatId.trim() !== '') {
      this.enabled = true;
      logger.info('Telegram Notifier & Command Listener configured successfully.');
      this.sendMessage('🟢 *Antigravity Trading Bot Started* \n\nSystem is online. Type /start for a list of commands.');
      this.startPolling();
    } else {
      logger.info('Telegram Notifier skipped (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID).');
    }
  }

  private static startPolling() {
    if (this.isPolling) return;
    this.isPolling = true;
    
    // Start the recursive poll
    this.pollUpdates();
  }

  private static async pollUpdates() {
    if (!this.enabled || !this.botToken) return;

    const url = `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=5`;

    try {
      const data = await this.makeGetRequest(url);
      const json = JSON.parse(data);

      if (json.ok && json.result.length > 0) {
        for (const update of json.result) {
          this.lastUpdateId = update.update_id;
          
          if (update.message && update.message.text) {
            const chatId = update.message.chat.id.toString();
            if (chatId === this.chatId) {
              const text = update.message.text.trim();
              logger.info(`[TELEGRAM] Received command: ${text}`);
              await this.handleCommand(text);
            }
          }
        }
      }
    } catch (e: any) {
      if (e.message && !e.message.includes('TIMEDOUT')) {
        logger.warn(`Telegram polling error: ${e.message}`);
      }
    }

    // Recursively poll
    if (this.enabled) {
      setTimeout(() => this.pollUpdates(), 500);
    }
  }

  private static async handleCommand(command: string) {
    try {
      const text = command.toLowerCase();
      logger.info(`[TELEGRAM] Processing command: ${text}`);
      
      if (text === '/start' || text === '/help') {
        await this.sendMessage(
          "🤖 *Antigravity Telegram Control Center*\n\n" +
          "Available Commands:\n" +
          "🔹 /status - Check live engine status, balance & equity\n" +
          "🔹 /today - View today's PnL & trade counts\n" +
          "🔹 /targets - View daily profit target ($35.00) & 5-trade cap\n" +
          "🔹 /list - View all active open positions\n" +
          "🔹 /history - View last 5 closed trade outcomes\n" +
          "🔹 /rejections - View recent filtered trade signals\n" +
          "🔹 /config - View risk settings & active lot bounds (0.01-0.07)\n" +
          "🔹 /pause - Pause engine entry scanner\n" +
          "🔹 /resume - Resume engine entry scanner\n" +
          "🔹 /reset - Reset daily profit lock & clear stale data\n" +
          "🔹 /closeall - Instantly emergency close all open positions\n" +
          "🔹 /kill - Emergency pause + kill switch (with confirmation)"
        );
      }
      
      else if (text === '/status') {
        try {
          const isPaused = TradingEngine.isPaused();
          const balance = TradingEngine.getBalance();
          const positions = TradingEngine.getOpenPositions();
          let unrealized = 0;
          for (const p of positions) {
            unrealized += (p.unrealizedPnL || 0);
          }
          const equity = balance + unrealized;
          
          await this.sendMessage(`📊 *System Status*\n\nEngine: ${isPaused ? '⏸ PAUSED' : '▶ RUNNING'}\nPair Focus: XAU/USD (Gold)\nBalance: $${balance.toFixed(2)}\nFloating PnL: $${unrealized.toFixed(2)}\nNet Equity: $${equity.toFixed(2)}\nOpen Positions: ${positions.length}`);
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching status: ' + err.message);
        }
      }

      else if (text === '/targets') {
        try {
          const todayStr = new Date().toISOString().substring(0, 10);
          const row = db.prepare(`
            SELECT SUM(pnl) as totalPnL, COUNT(*) as tradesCount 
            FROM trades 
            WHERE exit_time LIKE ? AND status = 'CLOSED'
          `).get(`${todayStr}%`) as any;

          const pnl = row?.totalPnL || 0;
          const count = row?.tradesCount || 0;
          const target = config.RISK_DAILY_PROFIT_TARGET_USD || 35.0;
          const maxTrades = config.RISK_MAX_DAILY_TRADES || 5;

          const progressPct = Math.min(100, Math.max(0, (pnl / target) * 100));

          await this.sendMessage(
            `🎯 *Daily Target & Limits Status*\n\n` +
            `Daily Profit Target: $${target.toFixed(2)}\n` +
            `Today Realized PnL: $${pnl.toFixed(2)}\n` +
            `Target Progress: ${progressPct.toFixed(1)}%\n` +
            `Daily Trades Executed: ${count} / ${maxTrades}\n` +
            `Target Met: ${pnl >= target ? '✅ YES (Lock Active)' : '⏳ IN PROGRESS'}`
          );
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching target status: ' + err.message);
        }
      }
      
      else if (text === '/list') {
        try {
          const positions = TradingEngine.getOpenPositions();
          if (positions.length === 0) {
            await this.sendMessage('📝 *Active Trades*\n\nNo open positions right now.');
            return;
          }
          
          let msg = `📝 *Active Trades (${positions.length})*\n\n`;
          for (const p of positions) {
            const pnl = p.unrealizedPnL || 0;
            const emoji = pnl >= 0 ? '🟢' : '🔴';
            msg += `${emoji} ${p.action} ${p.instrument}\nEntry: ${p.entryPrice}\nPnL: $${pnl.toFixed(2)}\nLots: ${(p.units / 100).toFixed(2)}\nStrategy: ${p.strategy}\n\n`;
          }
          await this.sendMessage(msg);
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching positions: ' + err.message);
        }
      }
      
      else if (text === '/today') {
        try {
          const today = new Date().toISOString().split('T')[0];
          const result = db.prepare('SELECT SUM(pnl) as totalPnL, COUNT(*) as tradesCount FROM trades WHERE exit_time LIKE ? AND status = \'CLOSED\'').get(today + '%') as any;
          const pnl = result?.totalPnL || 0;
          const count = result?.tradesCount || 0;
          
          await this.sendMessage(`📅 *Today's Performance*\n\nTrades: ${count} / ${config.RISK_MAX_DAILY_TRADES || 5}\nRealized PnL: $${pnl.toFixed(2)}`);
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching today data: ' + err.message);
        }
      }
      
      else if (text === '/history') {
        try {
          const trades = db.prepare("SELECT instrument, action, pnl, strategy, exit_time FROM trades WHERE status = 'CLOSED' ORDER BY exit_time DESC LIMIT 5").all() as any[];
          if (!trades || trades.length === 0) {
            await this.sendMessage('📜 *Trade History*\n\nNo closed trades yet.');
            return;
          }
          
          let msg = '📜 *Recent Closed Trades*\n\n';
          for (const t of trades) {
            const emoji = t.pnl >= 0 ? '🟢' : '🔴';
            msg += `${emoji} ${t.action} ${t.instrument}\nPnL: $${t.pnl.toFixed(2)}\nStrategy: ${t.strategy}\nClosed: ${new Date(t.exit_time).toLocaleTimeString()}\n\n`;
          }
          await this.sendMessage(msg);
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching history: ' + err.message);
        }
      }

      else if (text === '/rejections') {
        try {
          const rejections = db.prepare("SELECT timestamp, filter_name, reason_code, instrument, details FROM filter_rejections ORDER BY timestamp DESC LIMIT 5").all() as any[];
          if (!rejections || rejections.length === 0) {
            await this.sendMessage('🛡️ *Recent Signal Rejections*\n\nNo rejected signals recorded.');
            return;
          }

          let msg = '🛡️ *Recent Signal Rejections*\n\n';
          for (const r of rejections) {
            msg += `• [${r.reason_code}] ${r.instrument}\nFilter: ${r.filter_name}\nDetails: ${r.details || 'N/A'}\n\n`;
          }
          await this.sendMessage(msg);
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching rejections: ' + err.message);
        }
      }
      
      else if (text === '/config') {
        try {
          const strats = config.ENABLED_STRATEGIES.map(s => s.replace(/_/g, '\\_')).join(', ');
          const msg = `⚙️ *System Configuration*\n\nTarget Asset: XAU/USD (Gold Only)\nLot Size Range: 0.01 - 0.07 lots\nDaily Target: $${config.RISK_DAILY_PROFIT_TARGET_USD}\nDaily Max Trades: ${config.RISK_MAX_DAILY_TRADES || 5}\nConfidence Gate: ${config.RISK_CONFIDENCE_MIN_THRESHOLD || 0.78}\nTake Profit ATR: ${config.ATR_TP_MULTIPLIER}x\nStop Loss ATR: ${config.ATR_SL_MULTIPLIER}x\n\nActive Strategies:\n${strats}`;
          await this.sendMessage(msg);
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching config: ' + err.message);
        }
      }
      
      else if (text === '/pause') {
        if (TradingEngine.isPaused()) {
          await this.sendMessage('⏸ Engine is already paused.');
        } else {
          TradingEngine.setPaused(true);
          await this.sendMessage('⏸ Engine Paused\nBot will stop taking new trades.');
        }
      }
      
      else if (text === '/resume') {
        if (!TradingEngine.isPaused()) {
          await this.sendMessage('▶ Engine is already running.');
        } else {
          TradingEngine.setPaused(false);
          await this.sendMessage('▶ Engine Resumed\nBot is now scanning for new entries.');
        }
      }

      else if (text === '/reset') {
        try {
          db.prepare("DELETE FROM trades").run();
          db.prepare("DELETE FROM equity_snapshots").run();
          db.prepare("DELETE FROM filter_rejections").run();
          TradingEngine.setBalance(config.STARTING_BALANCE || 150.00);
          TradingEngine.setPaused(false);
          await this.sendMessage("🔄 *DATABASE & DAILY TARGET RESET SUCCESSFUL*\nAll trade histories cleared. Engine set to $150.00 balance.");
        } catch (err: any) {
          await this.sendMessage('⚠ Reset failed: ' + err.message);
        }
      }

      else if (text === '/closeall') {
        try {
          const openPositions = TradingEngine.getOpenPositions();
          if (openPositions.length === 0) {
            await this.sendMessage('ℹ️ No open positions to close.');
            return;
          }
          let closedCount = 0;
          for (const pos of openPositions) {
            const quote = PriceFeed.getLatestQuote(pos.instrument);
            if (quote) {
              await TradingEngine.closePosition(pos.id, quote, 'TELEGRAM /closeall EMERGENCY');
              closedCount++;
            }
          }
          await this.sendMessage(`🚨 *EMERGENCY CLOSE COMPLETE*\n${closedCount} position(s) closed immediately.`);
        } catch (err: any) {
          await this.sendMessage('⚠ Emergency close failed: ' + err.message);
        }
      }
      
      else if (text === '/kill') {
        this.killConfirmPending = true;
        if (this.killConfirmTimeout) clearTimeout(this.killConfirmTimeout);
        this.killConfirmTimeout = setTimeout(() => {
          this.killConfirmPending = false;
          this.killConfirmTimeout = null;
        }, 30000);
        await this.sendMessage('⚠️ *KILL SWITCH WARNING*\nThis will PAUSE the engine AND CLOSE ALL open positions.\n\nType /kill\_confirm within 30 seconds to proceed.');
      }

      else if (text === '/kill_confirm') {
        if (!this.killConfirmPending) {
          await this.sendMessage('❌ No pending kill switch. Send /kill first.');
          return;
        }
        this.killConfirmPending = false;
        if (this.killConfirmTimeout) {
          clearTimeout(this.killConfirmTimeout);
          this.killConfirmTimeout = null;
        }

        TradingEngine.setPaused(true);
        const openPositions = TradingEngine.getOpenPositions();
        let closedCount = 0;

        for (const pos of openPositions) {
          try {
            const quote = PriceFeed.getLatestQuote(pos.instrument);
            if (quote) {
              await TradingEngine.closePosition(pos.id, quote, 'KILL SWITCH (Telegram)');
              closedCount++;
            }
          } catch (err: any) {
            logger.error(`[TELEGRAM] Failed to close position ${pos.id}: ${err.message}`);
          }
        }

        await this.sendMessage(`🛑 *KILL SWITCH ACTIVATED*\n${closedCount} position(s) closed.\nTrading HALTED.\n\nUse /resume to restart.`);
      }
      
      else {
        await this.sendMessage('❌ Unknown command. Type /start or /help to see available commands.');
      }
    } catch (err: any) {
      logger.error(`[TELEGRAM] handleCommand crashed: ${err.message}`);
    }
  }

  private static makeGetRequest(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', (e) => reject(e));
    });
  }

  public static async sendMessage(text: string): Promise<void> {
    if (!this.enabled || !this.botToken || !this.chatId) return;

    const payload = JSON.stringify({
      chat_id: this.chatId,
      text: text,
      parse_mode: 'Markdown'
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${this.botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            logger.error(`[TELEGRAM] Failed to send message. Status: ${res.statusCode}. Response: ${data}`);
          }
          resolve();
        });
      });

      req.on('error', (e) => {
        logger.error(`[TELEGRAM] Network error: ${e.message}`);
        resolve();
      });
      req.write(payload);
      req.end();
    });
  }
}
