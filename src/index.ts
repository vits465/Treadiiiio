import cron from 'node-cron';
import { config } from './config/index';
import { logger } from './logger/index';
import { initDb } from './db/index';
// Re-boot trigger for new Telegram credentials
import { TradingEngine, engineEvents } from './engine/tradingEngine';
import { PriceFeed } from './data/priceFeed';
import { startApiServer, broadcastEvent } from './api/server';
import { TelegramNotifier } from './notifier/telegram';
import { Strategy, MarketContext } from './strategy/strategy.interface';
import { MaCrossoverStrategy } from './strategy/maCrossover';
import { RsiMeanReversionStrategy } from './strategy/rsiMeanReversion';
import { BollingerBandsStrategy } from './strategy/bollingerBands';
import { LossRecoveryStrategy } from './strategy/lossRecovery';
import { MLClient } from './ml-client/index';

async function bootstrap() {
  logger.info('==================================================');
  logger.info('   Starting Forex Paper Trading Bot Engine        ');
  logger.info('==================================================');

  // 1. Initialize SQLite database & trading engine
  initDb();
  TradingEngine.initialize();

  // Initialize Notifier
  TelegramNotifier.initialize(config.TELEGRAM_BOT_TOKEN, config.TELEGRAM_CHAT_ID);

  engineEvents.on('position_update', (pos, price) => {
    logger.info(`[POSITION UPDATE] ${pos.instrument} @ ${price}`);
    // If unrealizedPnL is exactly 0 and it just opened, we can treat it as a new position alert
    // But better yet, let's just alert if the PnL is 0 which happens right at execution
    if (pos.unrealizedPnL === 0) {
      const emoji = pos.action === 'BUY' ? '🟢' : '🔴';
      TelegramNotifier.sendMessage(`${emoji} *Position Opened: ${pos.instrument}*\nAction: ${pos.action}\nEntry: ${pos.entryPrice}\nStrategy: ${pos.strategy}`);
    }
  });

  engineEvents.on('trade_closed', (trade) => {
    const emoji = trade.pnl >= 0 ? '🟢' : '🔴';
    TelegramNotifier.sendMessage(`${emoji} *Trade Closed: ${trade.instrument}*\nStrategy: ${trade.strategy}\nPnL: $${trade.pnl.toFixed(2)}`);
  });

  // 2. Instantiate strategies
  const strategyInstances: Record<string, Strategy> = {
    ma_crossover: new MaCrossoverStrategy(),
    rsi_reversion: new RsiMeanReversionStrategy(),
    bollinger_bands: new BollingerBandsStrategy(),
    loss_recovery: new LossRecoveryStrategy(),
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

  // 3. Pre-train ML models if they don't exist
  if (config.ENABLED_STRATEGIES.includes('ml_signal')) {
    logger.info('Checking ML Service connectivity and models...');
    for (const pair of config.CURRENCY_PAIRS) {
      try {
        // Fetch 50 candles to see if we can connect and if a model exists
        const testCandles = await PriceFeed.fetchCandles(pair, 50, config.CANDLE_GRANULARITY);
        await MLClient.predict(pair, testCandles);
        logger.info(`ML model for ${pair} is loaded and ready.`);
      } catch (err: any) {
        if (err.message === 'MODEL_NOT_FOUND') {
          logger.warn(`No model found for ${pair} in ML service. Auto-triggering initial training...`);
          // Fetch more candles for training
          const trainCandles = await PriceFeed.fetchCandles(pair, 500, config.CANDLE_GRANULARITY);
          await MLClient.train(pair, trainCandles);
        } else {
          logger.error(`Failed to verify or pre-train ML model for ${pair}. Make sure the Python service is running at ${config.ML_SERVICE_URL}. Error: ${err.message}`);
        }
      }
    }
  }

  // 4. Start the Express API server
  startApiServer();

  // 5. Run the core polling loop
  const intervalMs = config.POLL_INTERVAL_SECONDS * 1000;
  logger.info(`Starting execution loop. Polling interval: ${config.POLL_INTERVAL_SECONDS} seconds.`);

  async function executionLoop() {
    try {
      logger.debug('Polling market price quotes...');
      const quotes = await PriceFeed.fetchLatestQuotes(config.CURRENCY_PAIRS);

        // A. Update open positions and evaluate stop loss / take profit
      await TradingEngine.updatePositionsAndCheckSLTP(quotes);

      // B. Process each instrument
      for (const pair of config.CURRENCY_PAIRS) {
        const quote = quotes.find((q) => q.instrument === pair);
        if (!quote) continue;

        // Fetch recent candles for indicator calculations
        // Fetching 100 candles covers SMA 21, RSI 14, BB 20
        const candles = await PriceFeed.fetchCandles(pair, 100, config.CANDLE_GRANULARITY);
        if (candles.length < 30) continue;

        // Fetch macro timeframe (Daily) for multi-timeframe trend filter
        const macroCandles = await PriceFeed.fetchCandles(pair, 30, '1day');

        const latestCandle = candles[candles.length - 1];

        // Process Rule-Based Strategies (Only if NOT PAUSED)
        if (!TradingEngine.isPaused()) {
          for (const strategy of enabledStrategies) {
            const activePosition = TradingEngine.getActivePosition(pair, strategy.name);
            const openPositionsCount = TradingEngine.getOpenPositionsCount();
            const accountEquity = TradingEngine.getBalance() + TradingEngine.getOpenPositions().reduce((sum, p) => sum + p.unrealizedPnL, 0);

            const context: MarketContext = {
              historicalCandles: candles,
              macroCandles,
              currentQuote: quote,
              activePosition,
              accountEquity,
              openPositionsCount,
            };

            const signal = strategy.onCandle(latestCandle, context);

            if (signal) {
              broadcastEvent({
                type: 'signal_generated',
                data: {
                  instrument: pair,
                  source: signal.strategy,
                  action: signal.action,
                }
              });

              if (signal.action === 'CLOSE' && activePosition) {
                await TradingEngine.closePosition(activePosition.id, quote, `Strategy signal CLOSE (${strategy.name})`);
              } else if ((signal.action === 'BUY' || signal.action === 'SELL') && !activePosition) {
                await TradingEngine.executeOrder(pair, signal.action, strategy.name, quote, signal.stopLossPips, signal.takeProfitPips, signal.amountToRecover);
              }
            }
          }
        }

        // Process ML Signal Strategy (runs side-by-side, Only if NOT PAUSED)
        if (!TradingEngine.isPaused() && config.ENABLED_STRATEGIES.includes('ml_signal')) {
          const activePosition = TradingEngine.getActivePosition(pair, 'ml_signal');
          const openPositionsCount = TradingEngine.getOpenPositionsCount();
          const accountEquity = TradingEngine.getBalance() + TradingEngine.getOpenPositions().reduce((sum, p) => sum + p.unrealizedPnL, 0);

          const signal = await MLClient.predict(pair, candles);

          if (signal) {
            broadcastEvent({
              type: 'signal_generated',
              data: {
                instrument: pair,
                source: signal.strategy,
                action: signal.action,
              }
            });

            if (signal.action === 'CLOSE' && activePosition) {
              await TradingEngine.closePosition(activePosition.id, quote, 'ML strategy signal CLOSE');
            } else if ((signal.action === 'BUY' || signal.action === 'SELL') && !activePosition) {
              await TradingEngine.executeOrder(pair, signal.action, 'ml_signal', quote, signal.stopLossPips, signal.takeProfitPips);
            }
          }
        }
      }

      // C. Save global equity snapshot
      const openPositions = TradingEngine.getOpenPositions();
      const currentUnrealized = openPositions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
      TradingEngine.saveEquitySnapshot(currentUnrealized);

      // Print status log to keep console updated
      const activePositionsList = openPositions.map((p) => `${p.strategy}:${p.instrument}(${p.action},PnL:$${p.unrealizedPnL.toFixed(2)})`).join(', ') || 'None';
      logger.info(`[TICK] ${TradingEngine.isPaused() ? '[PAUSED] ' : ''}Balance: $${TradingEngine.getBalance().toFixed(2)} | Equity: $${(TradingEngine.getBalance() + currentUnrealized).toFixed(2)} | Positions: [${activePositionsList}]`);

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
