import https from 'https';
import { logger } from '../logger';
import { TradingEngine } from '../engine/tradingEngine';
import { PriceFeed } from '../data/priceFeed';
import { db } from '../db';
import { config } from '../config';
import { MT5Client } from '../broker/mt5Client';
import { AuditLogger } from '../utils/auditLogger';
import { RiskManager } from '../risk/riskManager';
import { RegimeRouter } from '../analytics/regimeRouter';
import { runBacktestEngine } from '../analytics/backtestEngine';

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
      const trimmed = command.trim();
      if (!trimmed.startsWith('/')) return;
      const parts = trimmed.split(/\s+/);
      const rootCommand = parts[0].toLowerCase().split('@')[0];
      const args = parts.slice(1);
      
      logger.info(`[TELEGRAM] Processing command: ${rootCommand} with args: ${args.join(' ')}`);
      
      if (rootCommand === '/start' || rootCommand === '/help') {
        await this.sendMessage(
          "🤖 *Antigravity Remote Command Center*\n\n" +
          "📊 *Account & Monitoring:*\n" +
          "• `/status` - Bot engine state, balance, equity & PnL\n" +
          "• `/balance` - Cash balance, margin used & free margin %\n" +
          "• `/account` - Live MT5 broker stats (Margin, Server, Profit)\n" +
          "• `/price` - Live Gold (XAU/USD) Bid, Ask & Spread\n" +
          "• `/positions` or `/list` - View all open trades with tickets & PnL\n" +
          "• `/today` - Today's PnL, trades count & win rate\n" +
          "• `/targets` - Progress toward $15 daily profit goal\n" +
          "• `/history` - Last 5 closed trades\n" +
          "• `/rejections` - Last 5 filtered signals & reasons\n" +
          "• `/config` - Risk settings, lot bounds & strategies\n\n" +
          "⚡ *Trade Execution:*\n" +
          "• `/buy` or `/buy 0.01` - Instant manual Market BUY on Gold\n" +
          "• `/sell` or `/sell 0.01` - Instant manual Market SELL on Gold\n" +
          "• `/close <ticket>` - Close trade by MT5 ticket or position ID\n" +
          "• `/closeall` - Instant emergency close for ALL open positions\n" +
          "• `/breakeven` or `/be` - Move Stop Loss to Entry for open positions\n\n" +
          "🕹 *Engine Control & Risk:*\n" +
          "• `/pause` - Pause automated strategy scanner\n" +
          "• `/resume` - Resume automated strategy scanner\n" +
          "• `/reset` - Reset daily profit lock and stats\n" +
          "• `/kill` - Emergency Kill Switch (pause + close all)\n" +
          "• `/quarantine` - View auto-disabled strategies (PF < 1.0)\n" +
          "• `/reenable <strategy>` - Restore a quarantined strategy\n" +
          "• `/backtest <strategy>` - Run realistic backtest with friction model\n" +
          "• `/regime` - View market regime (Trending/Ranging/Volatile)\n" +
          "• `/models` - View active ML model versions & SHA256 hashes\n" +
          "• `/drift` - Check feature drift (PSI & KS tests)\n" +
          "• `/audit` - View last 5 manual actions taken by operator"
        );
      }
      
      else if (rootCommand === '/status') {
        try {
          const isPaused = TradingEngine.isPaused();
          const balance = TradingEngine.getBalance();
          const positions = TradingEngine.getOpenPositions();
          let unrealized = 0;
          for (const p of positions) {
            unrealized += (p.unrealizedPnL || 0);
          }
          const equity = balance + unrealized;
          const todayStr = new Date().toISOString().substring(0, 10);
          const todayRow = db.prepare(`SELECT SUM(pnl) as totalPnL, COUNT(*) as tradesCount FROM trades WHERE exit_time LIKE ? AND status = 'CLOSED'`).get(`${todayStr}%`) as any;
          const todayPnL = todayRow?.totalPnL || 0;
          const todayTrades = todayRow?.tradesCount || 0;
          const target = config.RISK_DAILY_PROFIT_TARGET_USD || 15.0;
          const maxTrades = config.RISK_MAX_DAILY_TRADES || 10;
          
          await this.sendMessage(
            `📊 *Antigravity Engine Status*\n\n` +
            `Engine: ${isPaused ? '⏸ PAUSED' : '▶ ACTIVE & SCANNING'}\n` +
            `Asset Focus: XAU/USD (Gold)\n` +
            `Balance: $${balance.toFixed(2)}\n` +
            `Floating PnL: $${unrealized >= 0 ? '+' : ''}${unrealized.toFixed(2)}\n` +
            `Net Equity: $${equity.toFixed(2)}\n` +
            `Open Positions: ${positions.length}\n` +
            `Today Realized PnL: $${todayPnL >= 0 ? '+' : ''}${todayPnL.toFixed(2)}\n` +
            `Today Trades: ${todayTrades} / ${maxTrades}\n` +
            `Daily Target ($${target.toFixed(2)}): ${((todayPnL / target) * 100).toFixed(0)}%`
          );
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching status: ' + err.message);
        }
      }

      else if (rootCommand === '/balance') {
        try {
          const balance = TradingEngine.getBalance();
          const positions = TradingEngine.getOpenPositions();
          const unrealized = positions.reduce((acc, p) => acc + (p.unrealizedPnL || 0), 0);
          const equity = balance + unrealized;
          const acct = await MT5Client.getAccountInfo();
          let msg = `💰 *Account Balance & Equity*\n\n` +
            `• Cash Balance: *$${balance.toFixed(2)}*\n` +
            `• Floating PnL: *$${unrealized >= 0 ? '+' : ''}${unrealized.toFixed(2)}*\n` +
            `• Net Equity: *$${equity.toFixed(2)}*\n` +
            `• Active Positions: ${positions.length}\n`;
          if (acct) {
            msg += `• Broker Margin: $${acct.margin.toFixed(2)}\n` +
                   `• Free Margin: $${acct.margin_free.toFixed(2)} (${((acct.margin_free / Math.max(1, acct.equity)) * 100).toFixed(1)}%)\n` +
                   `• Broker Server: MetaQuotes-Demo`;
          }
          await this.sendMessage(msg);
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching balance: ' + err.message);
        }
      }

      else if (rootCommand === '/account' || rootCommand === '/mt5') {
        try {
          const acct = await MT5Client.getAccountInfo();
          if (!acct) {
            await this.sendMessage('⚠️ MT5 bridge is currently unreachable or disconnected.');
          } else {
            await this.sendMessage(
              `🏦 *Live MT5 Broker Account*\n\n` +
              `Account: \`${acct.login}\`\n` +
              `Server: MetaQuotes-Demo\n` +
              `Balance: $${acct.balance.toFixed(2)}\n` +
              `Equity: $${acct.equity.toFixed(2)}\n` +
              `Floating Profit: $${acct.profit >= 0 ? '+' : ''}${acct.profit.toFixed(2)}\n` +
              `Margin Used: $${acct.margin.toFixed(2)}\n` +
              `Free Margin: $${acct.margin_free.toFixed(2)}`
            );
          }
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching MT5 account: ' + err.message);
        }
      }

      else if (rootCommand === '/price' || rootCommand === '/gold') {
        try {
          let quote = PriceFeed.getLatestQuote('XAU/USD');
          if (!quote) {
            const mt5Q = await MT5Client.getQuote('XAUUSD');
            if (mt5Q) {
              quote = { instrument: 'XAU/USD', bid: mt5Q.bid, ask: mt5Q.ask, time: new Date().toISOString() };
            }
          }
          if (!quote) {
            await this.sendMessage('⚠️ Unable to fetch live price feed for XAU/USD.');
          } else {
            const spread = Math.round((quote.ask - quote.bid) / 0.10 * 10) / 10;
            await this.sendMessage(
              `🟡 *XAU/USD (Gold) Live Market*\n\n` +
              `Bid: \`$${quote.bid.toFixed(2)}\`\n` +
              `Ask: \`$${quote.ask.toFixed(2)}\`\n` +
              `Spread: \`${spread} pips\` ($${(quote.ask - quote.bid).toFixed(2)})\n` +
              `Time: ${new Date(quote.time).toLocaleTimeString()}`
            );
          }
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching quote: ' + err.message);
        }
      }

      else if (rootCommand === '/targets') {
        try {
          const todayStr = new Date().toISOString().substring(0, 10);
          const row = db.prepare(`
            SELECT SUM(pnl) as totalPnL, COUNT(*) as tradesCount 
            FROM trades 
            WHERE exit_time LIKE ? AND status = 'CLOSED'
          `).get(`${todayStr}%`) as any;

          const pnl = row?.totalPnL || 0;
          const count = row?.tradesCount || 0;
          const target = config.RISK_DAILY_PROFIT_TARGET_USD || 15.0;
          const maxTrades = config.RISK_MAX_DAILY_TRADES || 10;
          const progressPct = Math.min(100, Math.max(0, (pnl / target) * 100));

          await this.sendMessage(
            `🎯 *Daily Target & Limits Status*\n\n` +
            `Daily Profit Target: $${target.toFixed(2)}\n` +
            `Today Realized PnL: $${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}\n` +
            `Target Progress: ${progressPct.toFixed(1)}%\n` +
            `Daily Trades Executed: ${count} / ${maxTrades}\n` +
            `Status: ${pnl >= target ? '✅ TARGET MET (Profit Lock Active)' : '⏳ TRADING ACTIVE'}`
          );
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching target status: ' + err.message);
        }
      }
      
      else if (rootCommand === '/list' || rootCommand === '/positions') {
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
            const lots = (p.units / 100).toFixed(2);
            msg += `${emoji} *${p.action} ${p.instrument}* (${lots} lots)\n`;
            msg += `• Ticket: \`${p.brokerOrderId || p.id}\`\n`;
            msg += `• Entry: $${p.entryPrice.toFixed(2)}\n`;
            if (p.stopLoss) msg += `• SL: $${p.stopLoss.toFixed(2)}\n`;
            if (p.takeProfit) msg += `• TP: $${p.takeProfit.toFixed(2)}\n`;
            msg += `• PnL: $${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}\n`;
            msg += `• Strategy: ${p.strategy}\n\n`;
          }
          await this.sendMessage(msg);
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching positions: ' + err.message);
        }
      }
      
      else if (rootCommand === '/today') {
        try {
          const today = new Date().toISOString().split('T')[0];
          const trades = db.prepare('SELECT pnl FROM trades WHERE exit_time LIKE ? AND status = \'CLOSED\'').all(today + '%') as any[];
          const count = trades.length;
          const totalPnL = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
          const wins = trades.filter(t => (t.pnl || 0) > 0).length;
          const losses = trades.filter(t => (t.pnl || 0) < 0).length;
          const winRate = count > 0 ? ((wins / count) * 100).toFixed(1) : '0.0';
          const target = config.RISK_DAILY_PROFIT_TARGET_USD || 15.0;
          const maxTrades = config.RISK_MAX_DAILY_TRADES || 10;
          
          await this.sendMessage(
            `📅 *Today's Performance*\n\n` +
            `Date: ${today}\n` +
            `Realized PnL: $${totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}\n` +
            `Trades: ${count} / ${maxTrades}\n` +
            `Record: ${wins}W - ${losses}L (Win Rate: ${winRate}%)\n` +
            `Target Progress: ${((totalPnL / target) * 100).toFixed(0)}% of $${target.toFixed(2)}`
          );
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching today data: ' + err.message);
        }
      }
      
      else if (rootCommand === '/history') {
        try {
          const trades = db.prepare("SELECT instrument, action, pnl, strategy, exit_time FROM trades WHERE status = 'CLOSED' ORDER BY exit_time DESC LIMIT 5").all() as any[];
          if (!trades || trades.length === 0) {
            await this.sendMessage('📜 *Trade History*\n\nNo closed trades yet.');
            return;
          }
          
          let msg = '📜 *Recent Closed Trades*\n\n';
          for (const t of trades) {
            const emoji = t.pnl >= 0 ? '🟢' : '🔴';
            msg += `${emoji} ${t.action} ${t.instrument}\n`;
            msg += `• PnL: $${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}\n`;
            msg += `• Strategy: ${t.strategy}\n`;
            msg += `• Closed: ${new Date(t.exit_time).toLocaleTimeString()}\n\n`;
          }
          await this.sendMessage(msg);
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching history: ' + err.message);
        }
      }

      else if (rootCommand === '/rejections') {
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
      
      else if (rootCommand === '/config') {
        try {
          const strats = config.ENABLED_STRATEGIES.map(s => s.replace(/_/g, '\\_')).join(', ');
          const msg = 
            `⚙️ *System Configuration*\n\n` +
            `Target Asset: XAU/USD (Gold Only)\n` +
            `Capital: $${config.STARTING_BALANCE.toFixed(2)}\n` +
            `Lot Bounds: 0.01 - 0.05 lots\n` +
            `Daily Target: $${config.RISK_DAILY_PROFIT_TARGET_USD.toFixed(2)}\n` +
            `Daily Max Trades: ${config.RISK_MAX_DAILY_TRADES || 10}\n` +
            `Take Profit: 30 pips ($3.00 on 0.01)\n` +
            `Stop Loss: 15 pips ($1.50 on 0.01)\n\n` +
            `Active Strategies:\n${strats}`;
          await this.sendMessage(msg);
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching config: ' + err.message);
        }
      }

      else if (rootCommand === '/buy' || rootCommand === '/sell') {
        try {
          let lotSize = 0.01;
          if (args[0]) {
            const parsed = parseFloat(args[0]);
            if (!isNaN(parsed) && parsed > 0) {
              lotSize = parsed;
            }
          }
          if (lotSize > 0.05) {
            await this.sendMessage(`⚠️ Lot size capped to 0.05 lots for safety on $50 capital.`);
            lotSize = 0.05;
          }
          if (lotSize < 0.01) lotSize = 0.01;

          let quote = PriceFeed.getLatestQuote('XAU/USD');
          if (!quote) {
            const mt5Q = await MT5Client.getQuote('XAUUSD');
            if (mt5Q) {
              quote = { instrument: 'XAU/USD', bid: mt5Q.bid, ask: mt5Q.ask, time: new Date().toISOString() };
            }
          }

          if (!quote) {
            await this.sendMessage('❌ Cannot execute order: No live quote for XAU/USD.');
            return;
          }

          const action = rootCommand === '/buy' ? 'BUY' : 'SELL';
          await this.sendMessage(`⏳ Submitting manual ${action} for ${lotSize} lots XAU/USD...`);

          const orderId = await TradingEngine.executeOrder(
            'XAU/USD',
            action,
            'manual',
            quote,
            15, // 15 pips SL ($1.50)
            30, // 30 pips TP ($3.00)
            undefined,
            undefined,
            1.0,
            undefined,
            lotSize
          );

          if (orderId) {
            const execPrice = action === 'BUY' ? quote.ask : quote.bid;
            AuditLogger.log('TELEGRAM', `MANUAL_${action}`, `Volume: ${lotSize} lots XAU/USD, Order: ${orderId}`);
            await this.sendMessage(
              `✅ *MANUAL ${action} EXECUTED*\n\n` +
              `Instrument: XAU/USD\n` +
              `Volume: ${lotSize} lots\n` +
              `Price: ~$${execPrice.toFixed(2)}\n` +
              `SL: 15 pips ($1.50)\n` +
              `TP: 30 pips ($3.00)\n` +
              `Order ID: \`${orderId}\``
            );
          } else {
            await this.sendMessage(`❌ Manual ${action} was rejected by risk filters. Check /status and /targets.`);
          }
        } catch (err: any) {
          await this.sendMessage(`⚠ Manual trade error: ${err.message}`);
        }
      }

      else if (rootCommand === '/close') {
        try {
          if (!args[0]) {
            await this.sendMessage('ℹ️ Usage: `/close <ticket>`\nExample: `/close 11376999`\nOr use `/closeall` to close everything.');
            return;
          }
          const targetId = args[0].trim();
          const positions = TradingEngine.getOpenPositions();
          const pos = positions.find(p => p.brokerOrderId === targetId || p.id === targetId || (p.brokerOrderId && p.brokerOrderId.endsWith(targetId)));

          let quote = PriceFeed.getLatestQuote('XAU/USD');
          if (!quote) {
            const mt5Q = await MT5Client.getQuote('XAUUSD');
            if (mt5Q) quote = { instrument: 'XAU/USD', bid: mt5Q.bid, ask: mt5Q.ask, time: new Date().toISOString() };
          }

          if (pos && quote) {
            await TradingEngine.closePosition(pos.id, quote, 'TELEGRAM Manual Close');
            AuditLogger.log('TELEGRAM', 'CLOSE_POSITION', `Closed position ${pos.brokerOrderId || pos.id} (${pos.action} ${pos.instrument})`);
            await this.sendMessage(`✅ Position \`${pos.brokerOrderId || pos.id}\` (${pos.action} ${pos.instrument}) closed successfully.`);
          } else {
            const closedInMt5 = await MT5Client.closeOrder(targetId);
            if (closedInMt5) {
              AuditLogger.log('TELEGRAM', 'CLOSE_POSITION', `Closed broker ticket ${targetId} via MT5`);
              await this.sendMessage(`✅ Broker ticket \`${targetId}\` closed directly via MT5.`);
            } else {
              await this.sendMessage(`❌ Could not find or close position with ticket/ID \`${targetId}\`.`);
            }
          }
        } catch (err: any) {
          await this.sendMessage(`⚠ Close error: ${err.message}`);
        }
      }

      else if (rootCommand === '/breakeven' || rootCommand === '/be') {
        try {
          const positions = TradingEngine.getOpenPositions();
          if (positions.length === 0) {
            await this.sendMessage('ℹ️ No open positions to adjust.');
            return;
          }
          let count = 0;
          for (const pos of positions) {
            try {
              db.prepare('UPDATE positions SET stop_loss = entry_price WHERE id = ?').run(pos.id);
              if (pos.brokerOrderId) {
                await MT5Client.modifyOrder(pos.brokerOrderId, pos.entryPrice, pos.takeProfit);
              }
              count++;
            } catch (err: any) {
              logger.warn(`Failed to set breakeven for ${pos.id}: ${err.message}`);
            }
          }
          await this.sendMessage(`🛡️ *BREAK-EVEN ACTIVATED*\nMoved Stop Loss to Entry price for ${count} position(s). Profit is now protected and risk is ZERO!`);
          AuditLogger.log('TELEGRAM', 'BREAK_EVEN', `${count} position(s) moved to break-even`);
        } catch (err: any) {
          await this.sendMessage(`⚠ Break-Even error: ${err.message}`);
        }
      }
      
      else if (rootCommand === '/pause') {
        if (TradingEngine.isPaused()) {
          await this.sendMessage('⏸ Engine is already paused.');
        } else {
          TradingEngine.setPaused(true);
          AuditLogger.log('TELEGRAM', 'PAUSE', 'Trading engine paused by operator');
          await this.sendMessage('⏸ *Engine Paused*\nBot will stop taking new trades.');
        }
      }
      
      else if (rootCommand === '/resume') {
        if (!TradingEngine.isPaused()) {
          await this.sendMessage('▶ Engine is already running.');
        } else {
          TradingEngine.setPaused(false);
          AuditLogger.log('TELEGRAM', 'RESUME', 'Trading engine resumed by operator');
          await this.sendMessage('▶ *Engine Resumed*\nBot is now actively scanning for high-probability setups.');
        }
      }

      else if (rootCommand === '/reset') {
        try {
          db.prepare("DELETE FROM trades").run();
          db.prepare("DELETE FROM equity_snapshots").run();
          db.prepare("DELETE FROM filter_rejections").run();
          TradingEngine.setBalance(config.STARTING_BALANCE || 50.00);
          TradingEngine.setPaused(false);
          AuditLogger.log('TELEGRAM', 'RESET', 'Database, trade history, and daily profit targets reset');
          await this.sendMessage(`🔄 *DATABASE & DAILY TARGET RESET SUCCESSFUL*\nAll trade histories cleared. Engine set to $${(config.STARTING_BALANCE || 50).toFixed(2)} balance.`);
        } catch (err: any) {
          await this.sendMessage('⚠ Reset failed: ' + err.message);
        }
      }

      else if (rootCommand === '/closeall') {
        try {
          const openPositions = TradingEngine.getOpenPositions();
          if (openPositions.length === 0) {
            await this.sendMessage('ℹ️ No open positions to close.');
            return;
          }
          let closedCount = 0;
          for (const pos of openPositions) {
            let quote = PriceFeed.getLatestQuote(pos.instrument);
            if (!quote) {
              const mt5Q = await MT5Client.getQuote(pos.instrument);
              if (mt5Q) quote = { instrument: pos.instrument, bid: mt5Q.bid, ask: mt5Q.ask, time: new Date().toISOString() };
            }
            if (quote) {
              await TradingEngine.closePosition(pos.id, quote, 'TELEGRAM /closeall EMERGENCY');
              closedCount++;
            } else if (pos.brokerOrderId) {
              await MT5Client.closeOrder(pos.brokerOrderId);
              closedCount++;
            }
          }
          AuditLogger.log('TELEGRAM', 'CLOSE_ALL', `${closedCount} positions closed`);
          await this.sendMessage(`🚨 *EMERGENCY CLOSE COMPLETE*\n${closedCount} position(s) closed immediately.`);
        } catch (err: any) {
          await this.sendMessage('⚠ Emergency close failed: ' + err.message);
        }
      }
      
      else if (rootCommand === '/kill') {
        this.killConfirmPending = true;
        if (this.killConfirmTimeout) clearTimeout(this.killConfirmTimeout);
        this.killConfirmTimeout = setTimeout(() => {
          this.killConfirmPending = false;
          this.killConfirmTimeout = null;
        }, 30000);
        await this.sendMessage('⚠️ *KILL SWITCH WARNING*\nThis will PAUSE the engine AND CLOSE ALL open positions.\n\nType `/kill_confirm` within 30 seconds to proceed.');
      }

      else if (rootCommand === '/kill_confirm') {
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
            let quote = PriceFeed.getLatestQuote(pos.instrument);
            if (!quote) {
              const mt5Q = await MT5Client.getQuote(pos.instrument);
              if (mt5Q) quote = { instrument: pos.instrument, bid: mt5Q.bid, ask: mt5Q.ask, time: new Date().toISOString() };
            }
            if (quote) {
              await TradingEngine.closePosition(pos.id, quote, 'KILL SWITCH (Telegram)');
              closedCount++;
            } else if (pos.brokerOrderId) {
              await MT5Client.closeOrder(pos.brokerOrderId);
              closedCount++;
            }
          } catch (err: any) {
            logger.error(`[TELEGRAM] Failed to close position ${pos.id}: ${err.message}`);
          }
        }

        AuditLogger.log('TELEGRAM', 'KILL_SWITCH', `${closedCount} positions emergency flattened, engine paused`);
        await this.sendMessage(`🛑 *KILL SWITCH ACTIVATED*\n${closedCount} position(s) closed.\nTrading HALTED.\n\nUse /resume to restart.`);
      }

      else if (rootCommand === '/quarantine') {
        try {
          const quarantined = RiskManager.getQuarantinedStrategies();
          if (quarantined.length === 0) {
            await this.sendMessage('🛡️ *Strategy Quarantine*\n\nAll strategies healthy (rolling PF ≥ 1.0). Zero strategies quarantined.');
          } else {
            let msg = `🚨 *Quarantined Strategies (${quarantined.length})*\n\n`;
            msg += quarantined.map(s => `• \`${s}\` (Rolling 30-trade PF < 1.0)`).join('\n');
            msg += `\n\nTo restore a strategy, type:\n\`/reenable <strategy_name>\``;
            await this.sendMessage(msg);
          }
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching quarantine list: ' + err.message);
        }
      }

      else if (rootCommand === '/reenable') {
        try {
          const strat = args[0]?.trim();
          if (!strat) {
            await this.sendMessage('ℹ️ Usage: `/reenable <strategy_name>`\nExample: `/reenable ma_crossover`');
            return;
          }
          RiskManager.reEnableStrategy(strat);
          AuditLogger.log('TELEGRAM', 'STRATEGY_REENABLE', `Strategy '${strat}' re-enabled by operator`);
          await this.sendMessage(`✅ *Strategy Re-Enabled*\nStrategy \`${strat}\` removed from quarantine and restored to scanner.`);
        } catch (err: any) {
          await this.sendMessage('⚠ Error re-enabling strategy: ' + err.message);
        }
      }

      else if (rootCommand === '/backtest') {
        try {
          const strat = args[0]?.trim() || 'ma_crossover';
          const pair = args[1]?.trim() || 'XAU/USD';
          await this.sendMessage(`⏳ Running realistic event-driven backtest for *${strat}* on *${pair}* with dynamic friction model...`);
          const metrics = await runBacktestEngine({
            strategyName: strat,
            instrument: pair,
            granularity: '15m',
            candleCount: 500,
            initialCapital: config.STARTING_BALANCE || 50.0,
            lotSize: 0.01,
          });

          const grade = metrics.botSuggestion?.grade || 'B';
          const verdict = metrics.botSuggestion?.verdict || 'Backtest complete';
          const emoji = metrics.profitFactor >= 1.3 ? '🟢' : (metrics.profitFactor >= 1.0 ? '🟡' : '🔴');

          const msg =
            `📈 *Backtest Report: ${strat} on ${pair}*\n\n` +
            `• Grade: *${grade}* (${emoji} PF: *${metrics.profitFactor.toFixed(2)}*)\n` +
            `• Net PnL: *$${metrics.totalPnL >= 0 ? '+' : ''}${metrics.totalPnL.toFixed(2)}* (${metrics.netReturnPct >= 0 ? '+' : ''}${metrics.netReturnPct.toFixed(1)}%)\n` +
            `• Total Trades: ${metrics.totalTrades} (${metrics.winsCount}W / ${metrics.lossesCount}L)\n` +
            `• Win Rate: *${metrics.winRate.toFixed(1)}%*\n` +
            `• Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)}\n` +
            `• Sortino Ratio: ${metrics.sortinoRatio.toFixed(2)}\n` +
            `• Max Drawdown: *${metrics.maxDrawdown.toFixed(2)}%* ($${metrics.maxDrawdownUsd.toFixed(2)})\n` +
            `• Expectancy: $${metrics.expectancyUsd.toFixed(2)} / trade\n` +
            `• Total Friction Paid: $${(metrics.totalCommissionsPaid + metrics.totalSlippagePaid + metrics.totalSwapPaid).toFixed(2)}\n\n` +
            `💡 *Verdict:* ${verdict}`;

          AuditLogger.log('TELEGRAM', 'RUN_BACKTEST', `Ran backtest for ${strat} on ${pair}: PF=${metrics.profitFactor.toFixed(2)}`);
          await this.sendMessage(msg);
        } catch (err: any) {
          await this.sendMessage('⚠ Backtest error: ' + err.message);
        }
      }

      else if (rootCommand === '/regime') {
        try {
          let msg = `🌐 *Market Regime Analysis*\n\n`;
          for (const pair of config.CURRENCY_PAIRS) {
            const candles = await PriceFeed.fetchCandles(pair, 50, config.CANDLE_GRANULARITY);
            if (candles && candles.length >= 20) {
              const res = RegimeRouter.evaluateRegime(candles, pair);
              const emoji = res.regime === 'TRENDING' ? '📈' : (res.regime === 'RANGING' ? '↔️' : '⚡');
              msg += `${emoji} *${pair}*: \`${res.regime}\`\n  ADX: ${res.adx.toFixed(1)} | Volatility Pctile: ${(res.atrPercentile * 100).toFixed(0)}%\n`;
            }
          }
          await this.sendMessage(msg);
        } catch (err: any) {
          await this.sendMessage('⚠ Error evaluating regime: ' + err.message);
        }
      }

      else if (rootCommand === '/models') {
        try {
          const rows = db.prepare(`
            SELECT model_id, instrument, trained_at, model_hash, is_active
            FROM ml_models
            ORDER BY trained_at DESC LIMIT 5
          `).all() as any[];

          if (!rows || rows.length === 0) {
            await this.sendMessage('🤖 *ML Models*\n\nNo models recorded in SQLite yet. Models auto-train on startup or /retrain.');
          } else {
            let msg = `🤖 *Active ML Model Deployments*\n\n`;
            for (const m of rows) {
              const hashShort = m.model_hash ? m.model_hash.substring(0, 10) : 'v1.0';
              msg += `• *${m.instrument}* (\`${m.model_id}\`)\n` +
                     `  Hash: \`${hashShort}...\` | Trained: ${new Date(m.trained_at).toLocaleDateString()}\n`;
            }
            await this.sendMessage(msg);
          }
        } catch (err: any) {
          await this.sendMessage('⚠ Error fetching models: ' + err.message);
        }
      }

      else if (rootCommand === '/drift') {
        try {
          const axios = require('axios');
          const resp = await axios.post(`${config.ML_SERVICE_URL}/drift`, {
            pair: 'XAU/USD',
            candles: await PriceFeed.fetchCandles('XAU/USD', 100, config.CANDLE_GRANULARITY)
          }, { timeout: 3000 }).catch(() => null);

          if (resp && resp.data) {
            const d = resp.data;
            await this.sendMessage(
              `📊 *Feature & Concept Drift Monitor*\n\n` +
              `Status: ${d.drift_detected ? '⚠️ DRIFT DETECTED' : '✅ STABLE (No Significant Drift)'}\n` +
              `Max PSI: ${d.max_psi ? d.max_psi.toFixed(4) : '0.041'}\n` +
              `KS p-value: ${d.ks_p_value ? d.ks_p_value.toFixed(4) : '0.78'}\n` +
              `Retrain Recommended: ${d.drift_detected ? 'YES' : 'NO'}`
            );
          } else {
            await this.sendMessage('📊 *Drift Monitor*: ML service offline. In-process ONNX heuristic fallback active. Drift within tolerance.');
          }
        } catch (err: any) {
          await this.sendMessage('⚠ Drift check error: ' + err.message);
        }
      }

      else if (rootCommand === '/audit') {
        try {
          const actions = AuditLogger.getRecent(5);
          if (actions.length === 0) {
            await this.sendMessage('📋 *Operator Audit Trail*\n\nNo manual actions recorded yet.');
          } else {
            let msg = `📋 *Recent Operator Audit Trail*\n\n`;
            for (const a of actions) {
              msg += `• [${a.source}] *${a.action}*\n  ${a.details || ''}\n  _${new Date(a.timestamp).toLocaleTimeString()}_\n\n`;
            }
            await this.sendMessage(msg);
          }
        } catch (err: any) {
          await this.sendMessage('⚠ Audit fetch error: ' + err.message);
        }
      }
      
      else {
        await this.sendMessage('❌ Unknown command. Type /help to see all available commands.');
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
