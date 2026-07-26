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
        await this.sendMessage("🤖 Antigravity Command Center\n\nAvailable Commands:\n/status - Check engine status\n/today - View today's PnL\n/history - View last 5 closed trades\n/config - View bot configuration\n/list - View all active trades\n/pause - Stop taking new trades\n/resume - Resume taking trades\n/kill - EMERGENCY: Pause + close ALL positions\n\n⚠ /kill requires confirmation within 30s");
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
          
          await this.sendMessage(`📊 System Status\n\nEngine: ${isPaused ? '⏸ PAUSED' : '▶ RUNNING'}\nBalance: $${balance.toFixed(2)}\nFloating PnL: $${unrealized.toFixed(2)}\nNet Equity: $${equity.toFixed(2)}\nOpen Trades: ${positions.length}`);
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching status: ' + err.message);
        }
      }
      
      else if (text === '/list') {
        try {
          const positions = TradingEngine.getOpenPositions();
          if (positions.length === 0) {
            await this.sendMessage('📝 Active Trades\n\nNo open positions right now.');
            return;
          }
          
          let msg = `📝 Active Trades (${positions.length})\n\n`;
          for (const p of positions) {
            const pnl = p.unrealizedPnL || 0;
            const emoji = pnl >= 0 ? '🟢' : '🔴';
            msg += `${emoji} ${p.action} ${p.instrument}\nEntry: ${p.entryPrice}\nPnL: $${pnl.toFixed(2)}\nAI: ${p.strategy}\n\n`;
          }
          await this.sendMessage(msg);
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching positions: ' + err.message);
        }
      }
      
      else if (text === '/today') {
        try {
          const today = new Date().toISOString().split('T')[0];
          const result = db.prepare('SELECT SUM(pnl) as totalPnL, COUNT(*) as tradesCount FROM trades WHERE exit_time LIKE ?').get(today + '%') as any;
          const pnl = result?.totalPnL || 0;
          const count = result?.tradesCount || 0;
          
          await this.sendMessage(`📅 *Today's Performance*\n\nTrades: ${count}\nRealized PnL: $${pnl.toFixed(2)}`);
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
      
      else if (text === '/config') {
        try {
          const strats = config.ENABLED_STRATEGIES.map(s => s.replace(/_/g, '\\_')).join(', ');
          const msg = `⚙️ *System Configuration*\n\nTarget Profit: $${config.RISK_DAILY_PROFIT_TARGET_USD}\nTake Profit: $${config.RISK_TRADE_TAKE_PROFIT_USD}\nMax Drawdown: ${config.RISK_MAX_DRAWDOWN_PCT}%\nSlippage Alert: ${config.ALERT_SLIPPAGE_PIPS} pips\nSimulator Mode: ${config.USE_SIMULATOR}\n\nStrategies:\n${strats}`;
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
        await this.sendMessage('❌ Unknown command. Type /start to see available commands.');
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
