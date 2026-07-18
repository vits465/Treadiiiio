import express from 'express';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from '../config';
import { logger } from '../logger';
import { db } from '../db';
import { TradingEngine, engineEvents } from '../engine/tradingEngine';
import { PriceFeed } from '../data/priceFeed';
import { MLClient } from '../ml-client';
import { runMonteCarlo } from '../analysis/monteCarlo';
import { RiskManager } from '../risk/riskManager';
import { apiKeyAuth, validateWsApiKey } from './authMiddleware';
import rateLimit from 'express-rate-limit';
import axios from 'axios';

const app = express();
app.use(express.json());

// CORS — restricted to configured origin (not wildcard)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', config.CORS_ALLOWED_ORIGIN);
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-API-Key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// Rate limiters for sensitive endpoints
const configRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: 'Too many config update requests — try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const tradeRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Too many trade requests — try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public endpoints (no auth): /api/health
app.get('/api/health', async (req, res) => {
  try {
    let dbConnected = false;
    try {
      const row = db.prepare('SELECT 1 as ok').get() as any;
      dbConnected = row?.ok === 1;
    } catch { dbConnected = false; }

    let mlServiceReachable = false;
    try {
      const resp = await axios.get(`${config.ML_SERVICE_URL}/health`, { timeout: 3000 });
      mlServiceReachable = resp.data?.status === 'ok';
    } catch { mlServiceReachable = false; }

    res.json({
      status: 'ok',
      enginePaused: TradingEngine.isPaused(),
      dbConnected,
      mlServiceReachable,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Apply auth middleware to all /api/* routes AFTER the health endpoint
app.use('/api', apiKeyAuth);

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// WebSocket clients registry
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  logger.debug('New WebSocket client connected.');

  // Send initial data to client on connection
  try {
    const openPositions = TradingEngine.getOpenPositions();
    for (const pos of openPositions) {
      ws.send(JSON.stringify({
        type: 'position_update',
        data: {
          id: pos.id,
          instrument: pos.instrument,
          side: pos.action === 'BUY' ? 'LONG' : 'SHORT',
          entryPrice: pos.entryPrice,
          currentPrice: pos.action === 'BUY' ? pos.entryPrice + (pos.unrealizedPnL / pos.units) : pos.entryPrice - (pos.unrealizedPnL / pos.units),
          unrealizedPnl: pos.unrealizedPnL,
          openedAt: pos.entryTime,
          source: pos.strategy,
          units: pos.units,
          stopLoss: pos.stopLoss,
          takeProfit: pos.takeProfit
        }
      }));
    }
  } catch (err) {
    logger.error('Failed to send initial WS data:', err);
  }

  ws.on('close', () => {
    clients.delete(ws);
    logger.debug('WebSocket client disconnected.');
  });
});

// Subscribe to engine events and broadcast via WebSocket
engineEvents.on('position_update', (pos, currentPrice) => {
  broadcastEvent({
    type: 'position_update',
    data: {
      id: pos.id,
      instrument: pos.instrument,
      side: pos.action === 'BUY' ? 'LONG' : 'SHORT',
      entryPrice: pos.entryPrice,
      currentPrice: currentPrice,
      unrealizedPnl: pos.unrealizedPnL,
      openedAt: pos.entryTime,
      source: pos.strategy,
      units: pos.units,
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit
    }
  });
});

engineEvents.on('trade_closed', (trade) => {
  broadcastEvent({
    type: 'trade_closed',
    data: {
      id: trade.id,
      instrument: trade.instrument,
      side: trade.action === 'BUY' ? 'LONG' : 'SHORT',
      entryPrice: trade.entry_price,
      exitPrice: trade.exit_price,
      pnl: trade.pnl,
      openedAt: trade.entry_time,
      closedAt: trade.exit_time,
      source: trade.strategy,
    }
  });
});

engineEvents.on('equity_tick', ({ balance, equity, timestamp }) => {
  broadcastEvent({
    type: 'equity_tick',
    data: {
      timestamp,
      equity,
      balance,
    }
  });
});

// Upgrade HTTP to WS connection on /ws path (with API key validation)
server.on('upgrade', (request, socket, head) => {
  const url = request.url || '';
  const pathname = new URL(url, `http://${request.headers.host}`).pathname;
  if (pathname === '/ws') {
    // Validate API key for WebSocket connections
    if (!validateWsApiKey(url, request.headers as Record<string, string | string[] | undefined>)) {
      logger.warn(`[AUTH] Rejected WebSocket connection — invalid API key from ${request.socket.remoteAddress}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Broadcast Helper
export function broadcastEvent(event: { type: string; data: any }) {
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// REST Endpoints
app.get('/api/status', (req, res) => {
  try {
    const openPositions = TradingEngine.getOpenPositions();
    const unrealizedPnL = openPositions.reduce((acc, pos) => acc + pos.unrealizedPnL, 0);
    const balance = TradingEngine.getBalance();
    const equity = balance + unrealizedPnL;

    res.json({
      status: 'running',
      timestamp: new Date().toISOString(),
      balance,
      equity,
      unrealizedPnL,
      openPositionsCount: openPositions.length,
      useSimulator: config.USE_SIMULATOR,
      instruments: config.CURRENCY_PAIRS,
      granularity: config.CANDLE_GRANULARITY,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/summary', (req, res) => {
  try {
    const allClosedTrades = db.prepare(`
      SELECT id, instrument, action, entry_price, exit_price, pnl, strategy, status
      FROM trades
      WHERE status = 'CLOSED'
    `).all() as any[];

    const totalTradesCount = allClosedTrades.length;
    const winningTrades = allClosedTrades.filter((t) => t.pnl > 0);
    const totalPnL = allClosedTrades.reduce((acc, t) => acc + t.pnl, 0);
    const winRate = totalTradesCount > 0 ? winningTrades.length / totalTradesCount : 0;

    // Sharpe
    const pnls = allClosedTrades.map((t) => t.pnl);
    let sharpe = 0;
    if (pnls.length >= 2) {
      const mean = totalPnL / pnls.length;
      const variance = pnls.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (pnls.length - 1);
      const stdDev = Math.sqrt(variance);
      sharpe = stdDev > 0 ? mean / stdDev : 0;
    }

    // Max drawdown
    const maxDrawdownRow = db.prepare(`
      SELECT MAX(drawdown) as maxDd
      FROM equity_snapshots
    `).get() as { maxDd: number | null };
    const maxDrawdown = maxDrawdownRow?.maxDd || 0;

    // Breakdown by strategy (bySource)
    const bySource: Record<string, { pnl: number; trades: number; winRate: number }> = {};
    const allStrats = ['ma_crossover', 'rsi_reversion', 'bollinger_bands', 'ml_signal'];
    for (const strat of allStrats) {
      const stratTrades = allClosedTrades.filter((t) => t.strategy === strat);
      const sCount = stratTrades.length;
      const sWins = stratTrades.filter((t) => t.pnl > 0).length;
      const sPnL = stratTrades.reduce((acc, t) => acc + t.pnl, 0);
      bySource[strat] = {
        pnl: sPnL,
        trades: sCount,
        winRate: sCount > 0 ? sWins / sCount : 0,
      };
    }

    res.json({
      totalPnl: totalPnL,
      winRate,
      maxDrawdown,
      sharpeApprox: sharpe,
      bySource,
    });
  } catch (error: any) {
    logger.error('Failed to generate summary:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/trades', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const trades = db.prepare(`
      SELECT id, instrument, action, entry_time, exit_time,
             entry_price, exit_price, units, pnl, strategy, status
      FROM trades
      WHERE status = 'CLOSED'
      ORDER BY entry_time DESC
      LIMIT ?
    `).all(limit) as any[];

    const mapped = trades.map((t) => ({
      id: t.id,
      instrument: t.instrument,
      side: t.action === 'BUY' ? 'LONG' : 'SHORT',
      entryPrice: t.entry_price,
      exitPrice: t.exit_price || 0,
      pnl: t.pnl || 0,
      openedAt: t.entry_time,
      closedAt: t.exit_time || '',
      source: t.strategy,
    }));

    res.json({
      trades: mapped,
      total: trades.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/positions', (req, res) => {
  try {
    const positions = TradingEngine.getOpenPositions();
    const mapped = positions.map((pos) => ({
      id: pos.id,
      instrument: pos.instrument,
      side: pos.action === 'BUY' ? 'LONG' : 'SHORT',
      entryPrice: pos.entryPrice,
      currentPrice: pos.action === 'BUY' ? pos.entryPrice + (pos.unrealizedPnL / pos.units) : pos.entryPrice - (pos.unrealizedPnL / pos.units),
      unrealizedPnl: pos.unrealizedPnL,
      openedAt: pos.entryTime,
      source: pos.strategy,
      units: pos.units,
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit
    }));
    res.json(mapped);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/equity-curve', (req, res) => {
  try {
    const snaps = db.prepare(`
      SELECT time, balance, equity
      FROM equity_snapshots
      ORDER BY time DESC
      LIMIT 100
    `).all() as any[];

    const mapped = snaps.reverse().map((s) => ({
      timestamp: s.time,
      balance: s.balance,
      equity: s.equity,
    }));

    res.json(mapped);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/monte-carlo', (req, res) => {
  try {
    const target = parseFloat(req.query.target as string) || 300;
    const trades = parseInt(req.query.trades as string) || 200;
    const rawMethod = (req.query.method as string || 'bootstrap').toLowerCase();
    const method: 'bootstrap' | 'shuffle' = rawMethod === 'shuffle' ? 'shuffle' : 'bootstrap';
    const result = runMonteCarlo(target, trades, 1000, method);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Strategies endpoint
app.get('/api/strategies', (req, res) => {
  try {
    const allClosedTrades = db.prepare(`
      SELECT strategy, pnl
      FROM trades
      WHERE status = 'CLOSED'
    `).all() as any[];

    const list = ['ma_crossover', 'rsi_reversion', 'bollinger_bands', 'ml_signal', 'loss_recovery'];
    
    // Check which ones are currently enabled in .env
    const enabledStrats = config.ENABLED_STRATEGIES;

    const data = list.map((name) => {
      const sTrades = allClosedTrades.filter((t) => t.strategy === name);
      const wins = sTrades.filter((t) => t.pnl > 0).length;
      const winRate = sTrades.length > 0 ? (wins / sTrades.length) * 100 : 0;
      return {
        name,
        enabled: enabledStrats.includes(name),
        pnl: sTrades.reduce((acc, t) => acc + (t.pnl || 0), 0),
        trades: sTrades.length,
        winRate,
      };
    });

    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/strategies/:name', (req, res) => {
  const name = req.params.name;
  const enabled = req.body.enabled === true;

  if (enabled) {
    if (!config.ENABLED_STRATEGIES.includes(name)) {
      config.ENABLED_STRATEGIES.push(name);
    }
  } else {
    config.ENABLED_STRATEGIES = config.ENABLED_STRATEGIES.filter((s) => s !== name);
  }

  logger.info(`Strategy ${name} toggled to ${enabled ? 'ENABLED' : 'DISABLED'}`);
  res.json({ name, enabled, pnl: 0, trades: 0 });
});

// Risk configuration endpoint
app.get('/api/risk-status', (req, res) => {
  try {
    const openCount = TradingEngine.getOpenPositionsCount();
    const openPositions = TradingEngine.getOpenPositions();
    const unrealized = openPositions.reduce((acc, pos) => acc + pos.unrealizedPnL, 0);
    const balance = TradingEngine.getBalance();
    const dailyLimit = config.STARTING_BALANCE * (config.RISK_DAILY_LOSS_LIMIT_PCT / 100);

    // Sum today's realized losses
    const todayStr = new Date().toISOString().substring(0, 10);
    const row = db.prepare(`
      SELECT SUM(pnl) as realizedToday
      FROM trades
      WHERE exit_time LIKE ? AND status = 'CLOSED'
    `).get(`${todayStr}%`) as { realizedToday: number | null };

    const realizedToday = row?.realizedToday || 0;
    const dailyLossUsed = Math.max(0, -(realizedToday + unrealized));

    // Weekly drawdown
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const startStr = sevenDaysAgo.toISOString();
    const weeklyRow = db.prepare(`
      SELECT SUM(pnl) as realizedWeek
      FROM trades
      WHERE exit_time >= ? AND status = 'CLOSED'
    `).get(startStr) as { realizedWeek: number | null };
    const realizedWeek = weeklyRow?.realizedWeek || 0;
    const weeklyLossUsed = Math.max(0, -(realizedWeek + unrealized));

    let totalRiskDollars = 0;
    for (const pos of openPositions) {
      if (pos.stopLoss) {
        totalRiskDollars += pos.units * Math.abs(pos.entryPrice - pos.stopLoss);
      }
    }
    const currentTotalOpenRiskPct = (totalRiskDollars / balance) * 100;
    const effectiveRiskPct = RiskManager.getEffectiveRiskPct(balance, config.RISK_MODE);

    // Area 4: Peak-equity circuit breaker level (grows with account)
    const currentEquity = balance + unrealized;
    const peakEquity = TradingEngine.getPeakEquity();
    const circuitBreakerLevel = TradingEngine.getCircuitBreakerLevel();
    const distanceToCircuitBreaker = Math.max(0, currentEquity - circuitBreakerLevel);

    // Area 4: Consecutive-loss cooldown status (read-only, no rejection log)
    const consecutiveLossStatus = RiskManager.getConsecutiveLossStatus();

    res.json({
      dailyLossLimit: dailyLimit,
      dailyLossUsed,
      weeklyLossLimit: config.STARTING_BALANCE * (config.RISK_WEEKLY_LOSS_LIMIT_PCT / 100),
      weeklyLossUsed,
      maxPositionSizePct: config.RISK_MAX_POSITION_SIZE_PCT,
      effectiveRiskPct,
      currentTotalOpenRiskPct,
      distanceToCircuitBreaker,
      circuitBreakerLevel,
      peakEquity,
      enginePaused: TradingEngine.isPaused(),
      maxConcurrentPositions: config.RISK_MAX_CONCURRENT_POSITIONS,
      currentOpenPositions: openCount,
      consecutiveLossCooldown: {
        inCooldown: consecutiveLossStatus.inCooldown,
        consecutiveLosses: consecutiveLossStatus.consecutiveLosses,
        cooldownUntil: consecutiveLossStatus.cooldownUntil?.toISOString() || null,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/model-status', (req, res) => {
  const instrument = req.query.instrument as string || 'EUR_USD';
  
  // Find last model training run in DB
  const row = db.prepare(`
    SELECT timestamp, metrics_json
    FROM model_runs
    ORDER BY timestamp DESC
    LIMIT 1
  `).get() as { timestamp: string; metrics_json: string } | undefined;

  let metrics = { accuracy: 0.55, f1_score: 0.54 };
  let trainedAt = new Date().toISOString();
  if (row) {
    metrics = JSON.parse(row.metrics_json);
    trainedAt = row.timestamp;
  }

  res.json({
    modelId: `xgb_${instrument.toLowerCase()}_v1`,
    instrument,
    trainedAt,
    validationAccuracy: metrics.accuracy || 1.0,
    liveAccuracy: metrics.accuracy || 1.0,
    driftWarning: false,
  });
});

app.post('/api/model-retrain', async (req, res) => {
  const instrument = req.body.instrument || 'EUR_USD';
  logger.info(`Dashboard triggered manual model retrain for ${instrument}`);
  
  try {
    const candles = await PriceFeed.fetchCandles(instrument, 1000, config.CANDLE_GRANULARITY);
    const metrics = await MLClient.train(instrument, candles);
    res.json({ started: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Bot Control Endpoints
app.get('/api/bot/status', (req, res) => {
  res.json({
    paused: TradingEngine.isPaused(),
    uptime: process.uptime(),
  });
});

app.post('/api/bot/pause', (req, res) => {
  TradingEngine.setPaused(true);
  res.json({ paused: true });
});

app.post('/api/bot/start', (req, res) => {
  TradingEngine.setPaused(false);
  res.json({ paused: false });
});

// Kill Switch — pause AND flatten all open positions
app.post('/api/bot/kill', async (req, res) => {
  try {
    TradingEngine.setPaused(true);
    const openPositions = TradingEngine.getOpenPositions();
    let closedCount = 0;

    for (const pos of openPositions) {
      const quote = PriceFeed.getLatestQuote(pos.instrument);
      if (quote) {
        await TradingEngine.closePosition(pos.id, quote, 'KILL SWITCH');
        closedCount++;
      }
    }

    // Telegram alert is sent by tradingEngine's trade_closed event + the TelegramNotifier import
    const { TelegramNotifier } = require('../notifier/telegram');
    TelegramNotifier.sendMessage(`🛑 *KILL SWITCH ACTIVATED*\n${closedCount} position(s) closed. Trading HALTED.`);

    logger.warn(`🛑 KILL SWITCH ACTIVATED — ${closedCount} positions force-closed.`);
    res.json({ killed: true, closedCount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bot/restart', (req, res) => {
  logger.info('Dashboard triggered engine soft restart.');
  TradingEngine.initialize();
  res.json({ restarting: false, success: true, message: "Engine reset successfully" });
});

// Manual Trading Endpoints

app.post('/api/trade/execute', tradeRateLimiter, async (req, res) => {
  try {
    const { instrument, action, stopLoss, takeProfit } = req.body;
    const quote = PriceFeed.getLatestQuote(instrument);
    if (!quote) return res.status(400).json({ error: 'No live quote available for instrument.' });
    
    const orderId = await TradingEngine.executeOrder(instrument, action, 'manual', quote, stopLoss, takeProfit);
    if (orderId) {
      res.json({ success: true, orderId });
    } else {
      res.status(400).json({ error: 'Trade rejected by risk management.' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trade/close', async (req, res) => {
  try {
    const { positionId } = req.body;
    const pos = TradingEngine.getOpenPositions().find(p => p.id === positionId);
    if (!pos) return res.status(404).json({ error: 'Position not found' });
    
    const quote = PriceFeed.getLatestQuote(pos.instrument);
    if (!quote) return res.status(400).json({ error: 'No live quote available for instrument.' });
    
    await TradingEngine.closePosition(pos.id, quote, 'Manual Close');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Config Endpoints
import * as fs from 'fs';
import * as path from 'path';

/** Mask a Telegram bot token: show ••••••••XXXX (last 4 chars). */
function maskToken(token: string | undefined): string {
  if (!token || token.length === 0) return '';
  const visible = token.slice(-4);
  return `••••••••${visible}`;
}

/** Returns true if the value is our mask pattern (user did not change it). */
function isMasked(value: string): boolean {
  return /^•+/.test(value);
}

/** Strip \r and \n to block .env line-injection attacks. */
function sanitize(value: string): string {
  return value.replace(/[\r\n]/g, '');
}

app.get('/api/config', (req, res) => {
  // Area 7: Never echo the raw Telegram token to the browser.
  // Show a masked hint so the dashboard can display it without exposing it.
  res.json({
    RISK_MAX_POSITION_SIZE_PCT: config.RISK_MAX_POSITION_SIZE_PCT,
    CURRENCY_PAIRS: config.CURRENCY_PAIRS.join(', '),
    TELEGRAM_BOT_TOKEN: maskToken(config.TELEGRAM_BOT_TOKEN),
    TELEGRAM_CHAT_ID: config.TELEGRAM_CHAT_ID || '',
  });
});

app.post('/api/config', configRateLimiter, (req, res) => {
  try {
    const { RISK_MAX_POSITION_SIZE_PCT, CURRENCY_PAIRS, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = req.body;
    const envPath = path.resolve(process.cwd(), '.env');
    let envData = fs.readFileSync(envPath, 'utf-8');

    // Area 7: Validate before writing
    const validationErrors: string[] = [];

    if (RISK_MAX_POSITION_SIZE_PCT !== undefined) {
      const riskVal = parseFloat(sanitize(String(RISK_MAX_POSITION_SIZE_PCT)));
      if (isNaN(riskVal) || riskVal <= 0) {
        validationErrors.push('RISK_MAX_POSITION_SIZE_PCT must be a positive number.');
      } else if (riskVal > 2) {
        // Safety cap — the dashboard can tighten risk but never raise it past 2%
        return res.status(400).json({
          error: `RISK_MAX_POSITION_SIZE_PCT cannot exceed 2% (got ${riskVal}%). ` +
                 `This cap is a hard safety limit and cannot be raised via the API.`
        });
      }
    }

    if (CURRENCY_PAIRS !== undefined) {
      const pairs = sanitize(String(CURRENCY_PAIRS));
      // Must be a comma-separated list of AAA/BBB or AAA_BBB pairs
      if (!/^[A-Z]{3}[\/\_][A-Z]{3}(,[A-Z]{3}[\/\_][A-Z]{3})*$/.test(pairs.replace(/\s/g, ''))) {
        validationErrors.push('CURRENCY_PAIRS must be a comma-separated list of pairs like EUR/USD,GBP/USD');
      }
    }

    if (TELEGRAM_CHAT_ID !== undefined && TELEGRAM_CHAT_ID !== '') {
      const chatId = sanitize(String(TELEGRAM_CHAT_ID));
      if (!/^-?\d+$/.test(chatId)) {
        validationErrors.push('TELEGRAM_CHAT_ID must be numeric.');
      }
    }

    if (TELEGRAM_BOT_TOKEN !== undefined && !isMasked(String(TELEGRAM_BOT_TOKEN))) {
      const tokenVal = sanitize(String(TELEGRAM_BOT_TOKEN));
      if (tokenVal.length > 0 && !/^\d+:[A-Za-z0-9_-]+$/.test(tokenVal)) {
        validationErrors.push('TELEGRAM_BOT_TOKEN must match the Telegram format: digits:token');
      }
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join(' | ') });
    }

    const updateEnv = (key: string, value: string) => {
      const sanitized = sanitize(value);
      const regex = new RegExp(`^${key}=.*`, 'm');
      if (regex.test(envData)) {
        envData = envData.replace(regex, `${key}=${sanitized}`);
      } else {
        envData += `\n${key}=${sanitized}`;
      }
    };

    if (RISK_MAX_POSITION_SIZE_PCT !== undefined) {
      updateEnv('RISK_MAX_POSITION_SIZE_PCT', String(RISK_MAX_POSITION_SIZE_PCT));
    }
    if (CURRENCY_PAIRS !== undefined) {
      updateEnv('CURRENCY_PAIRS', String(CURRENCY_PAIRS));
    }
    // Only update Telegram token if the user actually typed a new one (not the mask)
    if (TELEGRAM_BOT_TOKEN !== undefined && !isMasked(String(TELEGRAM_BOT_TOKEN))) {
      updateEnv('TELEGRAM_BOT_TOKEN', String(TELEGRAM_BOT_TOKEN));
    }
    if (TELEGRAM_CHAT_ID !== undefined) {
      updateEnv('TELEGRAM_CHAT_ID', String(TELEGRAM_CHAT_ID));
    }

    fs.writeFileSync(envPath, envData);
    
    res.json({ success: true, message: 'Config updated. Restarting...' });
    
    // Auto restart to apply new env vars
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Rejection Audit Log endpoint
app.get('/api/rejections', (req, res) => {
  try {
    const instrument = req.query.instrument as string | undefined;
    const filterName = req.query.filter_name as string | undefined;
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;

    let sql = 'SELECT * FROM filter_rejections';
    const conditions: string[] = [];
    const params: any[] = [];

    if (instrument) {
      conditions.push('instrument = ?');
      params.push(instrument);
    }
    if (filterName) {
      conditions.push('filter_name = ?');
      params.push(filterName);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params);
    res.json({ rejections: rows, total: rows.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export function startApiServer() {
  const port = config.PORT;
  server.listen(port, () => {
    logger.info(`🚀 Unified REST & WebSocket server running at http://localhost:${port}`);
  });
}
