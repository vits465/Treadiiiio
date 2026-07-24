import cron from 'node-cron';
import { config } from './config/index';
import { logger } from './logger/index';
import { initDb } from './db/index';
import { TradingEngine, engineEvents } from './engine/tradingEngine';
import { PriceFeed } from './data/priceFeed';
import { startApiServer, broadcastEvent } from './api/server';
import { TelegramNotifier } from './notifier/telegram';
import { Strategy, MarketContext } from './strategy/strategy.interface';
import { MaCrossoverStrategy } from './strategy/maCrossover';
import { RsiMeanReversionStrategy } from './strategy/rsiMeanReversion';
import { BollingerBandsStrategy } from './strategy/bollingerBands';
import { LossRecoveryStrategy } from './strategy/lossRecovery';
import { SmartMoneyConceptsStrategy } from './strategy/smartMoneyConcepts';
import { AsianKillZoneStrategy } from './strategy/asianKillZone';
import { MLClient } from './ml-client/index';
import { RejectionLogger } from './risk/rejectionLogger';
import { checkRuleConfirmations } from './risk/confirmations';

async function bootstrap() {
  logger.info('==================================================');
  logger.info('   Starting Forex Paper Trading Bot Engine        ');
  logger.info('==================================================');

  // 1. Initialize SQLite database & trading engine
  initDb();
  TradingEngine.initialize();

  // Initialize Notifier
  TelegramNotifier.initialize(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID);

  const lastTelegramUpdate = new Map<string, number>();

  engineEvents.on('position_update', (pos, price) => {
    logger.info(`[POSITION UPDATE] ${pos.instrument} @ ${price}`);
    const now = Date.now();
    const lastUpdate = lastTelegramUpdate.get(pos.id) || 0;

    if (pos.unrealizedPnL === 0) {
      const emoji = pos.action === 'BUY' ? '🟢' : '🔴';
      const safeStrategy = pos.strategy.replace(/_/g, ' ');
      TelegramNotifier.sendMessage(`${emoji} *Position Opened: ${pos.instrument}*\nAction: ${pos.action}\nEntry: ${pos.entryPrice}\nStrategy: ${safeStrategy}`);
      lastTelegramUpdate.set(pos.id, now);
    } else if (now - lastUpdate > 5 * 60 * 1000) {
      const pnlEmoji = pos.unrealizedPnL >= 0 ? '📈' : '📉';
      TelegramNotifier.sendMessage(`⏳ *Position Update: ${pos.instrument}*\nAction: ${pos.action}\nCurrent PnL: $${pos.unrealizedPnL.toFixed(2)} ${pnlEmoji}`);
      lastTelegramUpdate.set(pos.id, now);
    }
  });

  engineEvents.on('trade_closed', (trade) => {
    const emoji = trade.pnl >= 0 ? '🟢' : '🔴';
    const safeStrategy = trade.strategy.replace(/_/g, ' ');
    TelegramNotifier.sendMessage(`${emoji} *Trade Closed: ${trade.instrument}*\nStrategy: ${safeStrategy}\nPnL: $${trade.pnl.toFixed(2)}`);
  });

  // 2. Instantiate strategies
  const strategyInstances: Record<string, Strategy> = {
    ma_crossover: new MaCrossoverStrategy(),
    rsi_reversion: new RsiMeanReversionStrategy(),
    bollinger_bands: new BollingerBandsStrategy(),
    loss_recovery: new LossRecoveryStrategy(),
    smc_liquidity: new SmartMoneyConceptsStrategy(),
    asian_killzone: new AsianKillZoneStrategy(),
  };

  const enabledStrategies: Strategy[] = [];
  for (const name of config.ENABLED_STRATEGIES) {
    if (strategyInstances[name]) {
      enabledStrategies.push(strategyInstances[name]);
      logger.info(`Enabled Strategy: ${name}`);
    } else if (name === 'ml_signal') {
      logger.info('Enabled Strategy: ml_signal (Python microservice)');
    } else {
      logger.warn(`Unknown strategy in configuration: ${name}`);
    }
  }

  // 3. Pre-warm ML models in the BACKGROUND (non-blocking so engine starts immediately)
  if (config.ENABLED_STRATEGIES.includes('ml_signal')) {
    logger.info('Checking ML Service connectivity (background warm-up)...');
    // Run async background warm-up — doesn't block engine startup
    (async () => {
      for (const pair of config.CURRENCY_PAIRS) {
        try {
          // short timeout for candle fetch at startup — fall back to simulator if slow
          const testCandles = await Promise.race([
            PriceFeed.fetchCandles(pair, 50, config.CANDLE_GRANULARITY),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 8000))
          ]) as any;
          await MLClient.predict(pair, testCandles, true);
          logger.info(`ML model for ${pair} is loaded and ready.`);
        } catch (err: any) {
          if (err.message === 'MODEL_NOT_FOUND') {
            logger.warn(`No model for ${pair} — triggering background training...`);
            try {
              const trainCandles = await PriceFeed.fetchCandles(pair, 500, config.CANDLE_GRANULARITY);
              await MLClient.train(pair, trainCandles);
            } catch (trainErr: any) {
              logger.error(`ML training failed for ${pair}: ${trainErr.message}`);
            }
          } else if (err.message === 'TIMEOUT') {
            logger.warn(`ML warm-up timeout for ${pair} — will retry on next tick.`);
          } else {
            logger.warn(`ML warm-up skipped for ${pair}: ${err.message}`);
          }
        }
      }
      logger.info('ML warm-up complete. Engine fully operational.');
    })().catch((e) => logger.warn(`ML warm-up failed: ${e.message}`));
  }

  // 4. Start the Express API server
  startApiServer();

  // 5. Run the core polling loop
  const intervalMs = config.POLL_INTERVAL_SECONDS * 1000;
  logger.info(`Starting execution loop. Polling interval: ${config.POLL_INTERVAL_SECONDS} seconds.`);

  async function executionLoop() {
    try {
      // PROP FIRM MODE: Weekend Guard (Friday 20:00 UTC auto-liquidation)
      const now = new Date();
      if (now.getUTCDay() === 5 && now.getUTCHours() >= 20) {
        if (!TradingEngine.isPaused()) {
          logger.warn('Weekend Guard activated: Pausing engine and liquidating all positions.');
          TradingEngine.setPaused(true);
          const posList = TradingEngine.getOpenPositions();
          if (posList.length > 0) {
            const quotes = await PriceFeed.fetchLatestQuotes(config.CURRENCY_PAIRS);
            for (const pos of posList) {
              const qt = quotes.find(q => q.instrument === pos.instrument) || PriceFeed.getLatestQuote(pos.instrument);
              if (qt) await TradingEngine.closePosition(pos.id, qt, 'WEEKEND_AUTO_CLOSE');
            }
            TelegramNotifier.sendMessage(`🛑 *WEEKEND GUARD ACTIVATED*\n${posList.length} position(s) closed and trading paused until Sunday open.`);
          }
        }
        return; // Halt execution loop early during weekend closed hours
      }

      logger.debug('Polling market price quotes...');
      const quotes = await PriceFeed.fetchLatestQuotes(config.CURRENCY_PAIRS);

      // A. Update open positions and evaluate stop loss / take profit
      await TradingEngine.updatePositionsAndCheckSLTP(quotes);

      // A2. Area 4: Every-tick circuit breaker evaluation — catches purely-realized
      // drawdowns that occur with zero open positions (updatePositionsAndCheckSLTP
      // previously early-returned in that case so a realized-only drawdown could
      // never trip the breaker).
      const openPositions = TradingEngine.getOpenPositions();
      const currentUnrealized = openPositions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
      const currentEquity = TradingEngine.getBalance() + currentUnrealized;
      TradingEngine.checkCircuitBreakers(currentEquity);

      // Evaluate daily profit target every tick to enable automatic offline transition
      const { RiskManager } = require('./risk/riskManager');
      RiskManager.checkDailyProfitLock(TradingEngine.getBalance(), currentUnrealized, 'GLOBAL');

      // B. Process each instrument
      for (const pair of config.CURRENCY_PAIRS) {
        const quote = quotes.find((q) => q.instrument === pair);
        if (!quote) continue;

        // Fetch recent candles for indicator calculations
        const candles = await PriceFeed.fetchCandles(pair, 100, config.CANDLE_GRANULARITY);
        if (candles.length < 30) continue;

        // Fetch macro timeframe (Daily) for multi-timeframe trend filter
        const macroCandles = await PriceFeed.fetchCandles(pair, 30, '1day');

        const latestCandle = candles[candles.length - 1];

        // MTF FILTER: Calculate Macro Trend (Simple 20-period SMA slope or Price vs SMA)
        let macroTrend: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
        if (macroCandles.length >= 20) {
          const closePrices = macroCandles.slice(-20).map(c => c.close);
          const sma20 = closePrices.reduce((a, b) => a + b, 0) / 20;
          macroTrend = latestCandle.close > sma20 ? 'UP' : 'DOWN';
        }

        // VOLATILITY (ATR) Calculation
        let currentAtr = 0;
        if (candles.length >= 15) {
          const trs = [];
          for (let i = candles.length - 14; i < candles.length; i++) {
            const high = candles[i].high;
            const low = candles[i].low;
            const prevClose = candles[i - 1].close;
            const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
            trs.push(tr);
          }
          currentAtr = trs.reduce((a, b) => a + b, 0) / 14;
        }

        if (!TradingEngine.isPaused()) {
          for (const strategy of enabledStrategies) {
            const activePosition = TradingEngine.getActivePosition(pair, strategy.name);
            const openPositionsCount = TradingEngine.getOpenPositionsCount();
            const accountEquity = TradingEngine.getBalance() + TradingEngine.getOpenPositions().reduce((sum, p) => sum + p.unrealizedPnL, 0);

            let strategyCandles = candles;
            if (strategy.name === 'asian_killzone') {
              strategyCandles = await PriceFeed.fetchCandles(pair, 100, '5m');
            }

            const context: MarketContext = {
              historicalCandles: strategyCandles,
              macroCandles,
              currentQuote: quote,
              activePosition,
              accountEquity,
              openPositionsCount,
            };

            const evalCandle = strategyCandles[strategyCandles.length - 1] || latestCandle;
            const signal = strategy.onCandle(evalCandle, context);

            if (signal) {
              broadcastEvent({
                type: 'signal_generated',
                data: { instrument: pair, source: signal.strategy, action: signal.action },
              });

              if (signal.action === 'CLOSE' && activePosition) {
                await TradingEngine.closePosition(activePosition.id, quote, `Strategy signal CLOSE (${strategy.name})`);
              } else if ((signal.action === 'BUY' || signal.action === 'SELL') && !activePosition) {
                // MTF Trend Alignment Filter
                if ((signal.action === 'BUY' && macroTrend === 'DOWN') || (signal.action === 'SELL' && macroTrend === 'UP')) {
                  logger.info(`[MTF TREND WARNING] Executing ${pair} ${signal.action} from ${strategy.name} — note counter-trend to Daily ${macroTrend} trend.`);
                }

                await TradingEngine.executeOrder(
                  pair, signal.action, strategy.name, quote,
                  signal.stopLossPips, signal.takeProfitPips, signal.amountToRecover,
                  currentAtr, // pass ATR for dynamic lot sizing
                  undefined,
                  undefined,
                  signal.requestedLots,
                  signal.tp1Pips,
                  signal.tp2Pips
                );
              }
            }
          }
        }

        // Process ML Signal Strategy (runs side-by-side, Only if NOT PAUSED)
        if (!TradingEngine.isPaused() && config.ENABLED_STRATEGIES.includes('ml_signal')) {
          const activePosition = TradingEngine.getActivePosition(pair, 'ml_signal');
          const accountEquity = TradingEngine.getBalance() + TradingEngine.getOpenPositions().reduce((sum, p) => sum + p.unrealizedPnL, 0);

          const signal = await MLClient.predict(pair, candles);

          if (signal) {
            broadcastEvent({
              type: 'signal_generated',
              data: { instrument: pair, source: signal.strategy, action: signal.action },
            });

            if (signal.action === 'CLOSE' && activePosition) {
              // CLOSE signals bypass the rule-confirmation gate — exits are never blocked
              await TradingEngine.closePosition(activePosition.id, quote, 'ML strategy signal CLOSE');
            } else if ((signal.action === 'BUY' || signal.action === 'SELL') && !activePosition) {
              // Area 2: ML Gate Hardening — require rule-based confirmation
              let gatePass = true;
              if (config.ML_REQUIRE_RULE_CONFIRMATION) {
                const gateResult = checkRuleConfirmations(signal.action, candles, config.ML_MIN_RULE_CONFIRMATIONS);
                if (!gateResult.passed) {
                  logger.info(
                    `[ML GATE] ${pair} ${signal.action} rejected — insufficient rule agreement. ` +
                    `${gateResult.details}`
                  );
                  RejectionLogger.log(
                    'MLGate.ruleConfirmation',
                    'ML_NO_RULE_CONFIRM',
                    pair,
                    signal.action,
                    'ml_signal',
                    gateResult.details,
                    signal.confidence
                  );
                  gatePass = false;
                }
              }

              if (gatePass) {
                // MTF Trend Alignment Filter for ML
                if ((signal.action === 'BUY' && macroTrend === 'DOWN') || (signal.action === 'SELL' && macroTrend === 'UP')) {
                  logger.info(`[MTF TREND WARNING] Executing ${pair} ML ${signal.action} — note counter-trend to Daily ${macroTrend} trend.`);
                }

                // Area 1: pass confidence for dynamic sizing
                // Area 2 bug fix: pass signal.atr into executeOrder so ATR-based SL/TP activates
                await TradingEngine.executeOrder(
                  pair,
                  signal.action,
                  'ml_signal',
                  quote,
                  signal.stopLossPips,
                  signal.takeProfitPips,
                  undefined,            // amountToRecover — not applicable to ML signals
                  signal.atr,           // ← bug fix: was undefined before
                  signal.confidence,    // ← dynamic confidence scaling
                  undefined             // atrPercentile — computed in riskManager if needed
                );
              }
            }
          }
        }
      }

      // C. Save global equity snapshot
      const finalOpenPositions = TradingEngine.getOpenPositions();
      const finalUnrealized = finalOpenPositions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
      TradingEngine.saveEquitySnapshot(finalUnrealized);

      // Print status log
      const activePositionsList = finalOpenPositions.map((p) => `${p.strategy}:${p.instrument}(${p.action},PnL:$${p.unrealizedPnL.toFixed(2)})`).join(', ') || 'None';
      logger.info(`[TICK] ${TradingEngine.isPaused() ? '[PAUSED] ' : ''}Balance: $${TradingEngine.getBalance().toFixed(2)} | Equity: $${(TradingEngine.getBalance() + finalUnrealized).toFixed(2)} | Positions: [${activePositionsList}]`);

    } catch (error: any) {
      logger.error('Error encountered in execution loop:', error);
    }
  }

  // Initial trigger
  await executionLoop();
  
  // Schedule recurring intervals
  setInterval(executionLoop, intervalMs);

  // Background R&D Scheduler: Retrain ML models every 4 hours
  if (config.ENABLED_STRATEGIES.includes('ml_signal')) {
    cron.schedule('0 */4 * * *', async () => {
      logger.info('⏰ Running scheduled background R&D: Retraining ML models...');
      for (const pair of config.CURRENCY_PAIRS) {
        try {
          const trainCandles = await PriceFeed.fetchCandles(pair, 500, config.CANDLE_GRANULARITY);
          await MLClient.train(pair, trainCandles);
        } catch (err: any) {
          logger.error(`Scheduled ML training failed for ${pair}: ${err.message}`);
        }
      }
    });
  }
}

bootstrap().catch((err) => {
  logger.error('Bootstrap failed:', err);
});
