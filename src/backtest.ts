import { MaCrossoverStrategy } from './strategy/maCrossover';
import { Candle, MarketContext, PositionInfo, Signal } from './strategy/strategy.interface';
import * as fs from 'fs';
import * as path from 'path';
import { initDb, db } from './db/index';

function generateMockCandles(count: number, intervalSeconds: number = 30): Candle[] {
  const candles: Candle[] = [];
  let price = 1.1000;
  const now = Date.now();
  
  for (let i = 0; i < count; i++) {
    // Generate an upward trend with distinct sine waves (pullbacks)
    // This allows the fast MA to cross below and then back above the slow MA
    const timeScale = intervalSeconds / 900; 
    
    // Upward drift + distinct waves
    const drift = 0.0030 * timeScale;
    const wave = Math.sin(i / 15) * (0.0050 * timeScale); // Faster, sharper waves
    const trend = drift + wave;
    
    // Low noise
    const noise = (Math.random() - 0.5) * (0.0005 * Math.sqrt(timeScale));
    
    const open = price;
    const close = price + trend + noise;
    const high = Math.max(open, close) + Math.random() * (0.0002 * Math.sqrt(timeScale));
    const low = Math.min(open, close) - Math.random() * (0.0002 * Math.sqrt(timeScale));
    
    const granularity = intervalSeconds === 30 ? 'S30' : (intervalSeconds === 60 ? 'M1' : 'M15');

    candles.push({
      time: new Date(now - (count - i) * intervalSeconds * 1000).toISOString(),
      open,
      high,
      low,
      close,
      volume: Math.floor(Math.random() * 100),
      instrument: 'EUR/USD',
      granularity
    });
    
    price = close;
  }
  return candles;
}

async function runBacktest() {
  console.log('--- Starting Backtest Engine ---');
  initDb();
  
  // 1. Load Data (Simulating 30-second timeframe)
  const candles = generateMockCandles(2000, 30);
  console.log(`Loaded ${candles.length} candles for backtesting.`);

  // 2. Initialize Strategy
  const strategy = new MaCrossoverStrategy(3, 8);
  console.log(`Testing Strategy: ${strategy.name}`);

  // 3. Engine State
  let accountEquity = 10000; // Starting with $10k
  let activePosition: PositionInfo | null = null;
  const tradeHistory: any[] = [];
  
  // Context to pass to strategy
  const context: MarketContext = {
    historicalCandles: [],
    currentQuote: { instrument: 'EUR/USD', bid: 0, ask: 0, time: '' },
    activePosition: null,
    accountEquity,
    openPositionsCount: 0
  };

  // 4. Run Simulation
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    context.historicalCandles.push(candle);
    
    // Maintain mock quote
    context.currentQuote = {
      instrument: candle.instrument,
      bid: candle.close - 0.0001, // 1 pip spread
      ask: candle.close + 0.0001,
      time: candle.time
    };
    
    context.activePosition = activePosition;
    context.accountEquity = accountEquity;
    context.openPositionsCount = activePosition ? 1 : 0;

    // Evaluate Risk Management (Stop Loss / Take Profit)
    if (activePosition) {
      if (activePosition.action === 'BUY') {
        const pnl = (candle.close - activePosition.entryPrice) * activePosition.units;
        const pnlPips = (candle.close - activePosition.entryPrice) * 10000;
        
        if (activePosition.stopLoss && pnlPips <= -activePosition.stopLoss) {
          tradeHistory.push({ ...activePosition, exitTime: candle.time, exitPrice: candle.close, pnl, reason: 'StopLoss' });
          accountEquity += pnl;
          activePosition = null;
        } else if (activePosition.takeProfit && pnlPips >= activePosition.takeProfit) {
          tradeHistory.push({ ...activePosition, exitTime: candle.time, exitPrice: candle.close, pnl, reason: 'TakeProfit' });
          accountEquity += pnl;
          activePosition = null;
        }
      } else if (activePosition.action === 'SELL') {
        const pnl = (activePosition.entryPrice - candle.close) * activePosition.units;
        const pnlPips = (activePosition.entryPrice - candle.close) * 10000;
        
        if (activePosition.stopLoss && pnlPips <= -activePosition.stopLoss) {
          tradeHistory.push({ ...activePosition, exitTime: candle.time, exitPrice: candle.close, pnl, reason: 'StopLoss' });
          accountEquity += pnl;
          activePosition = null;
        } else if (activePosition.takeProfit && pnlPips >= activePosition.takeProfit) {
          tradeHistory.push({ ...activePosition, exitTime: candle.time, exitPrice: candle.close, pnl, reason: 'TakeProfit' });
          accountEquity += pnl;
          activePosition = null;
        }
      }
    }

    // Refresh context after risk management
    context.activePosition = activePosition;

    // Evaluate Strategy
    const signal: Signal | null = strategy.onCandle(candle, context);

    if (signal) {
      if (signal.action === 'CLOSE' && activePosition) {
         const isBuy = activePosition.action === 'BUY';
         const pnl = isBuy 
            ? (candle.close - activePosition.entryPrice) * activePosition.units 
            : (activePosition.entryPrice - candle.close) * activePosition.units;
         
         tradeHistory.push({ ...activePosition, exitTime: candle.time, exitPrice: candle.close, pnl, reason: 'StrategySignal' });
         accountEquity += pnl;
         activePosition = null;
      } 
      else if ((signal.action === 'BUY' || signal.action === 'SELL') && !activePosition) {
         // Open new position
         // Calculate position size based on risk. Risking 0.5% of equity per trade.
         const riskAmount = accountEquity * 0.005;
         const pipValue = 10; // Approx $10 per pip for a standard lot
         const slPips = signal.stopLossPips || 30;
         const riskPerUnit = slPips * (pipValue / 100000);
         
         // Simplified unit calculation (using fixed units for simple backtest)
         const units = 10000; // mini lot
         
         activePosition = {
             id: `pos_${i}`,
             instrument: candle.instrument,
             action: signal.action,
             entryTime: candle.time,
             entryPrice: signal.action === 'BUY' ? context.currentQuote.ask : context.currentQuote.bid,
             units,
             unrealizedPnL: 0,
             stopLoss: signal.stopLossPips,
             takeProfit: signal.takeProfitPips,
             strategy: strategy.name
         };
      }
    }
  }

  // 5. Results
  const winTrades = tradeHistory.filter(t => t.pnl > 0);
  const loseTrades = tradeHistory.filter(t => t.pnl <= 0);
  
  // SAVE TO DATABASE FOR DASHBOARD VIEWING
  console.log('\n--- Saving to Database for Dashboard ---');
  db.prepare('DROP TABLE trades').run(); // Clear old live trades
  db.prepare('DROP TABLE equity_snapshots').run(); // Clear old live equity

  let runningEquity = 10000;
  for (const t of tradeHistory) {
      db.prepare(`
        INSERT INTO trades (id, instrument, action, entry_time, exit_time, entry_price, exit_price, units, pnl, strategy, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        t.id, t.instrument, t.action, t.entryTime, t.exitTime, t.entryPrice, t.exitPrice, t.units, t.pnl, t.strategy, 'CLOSED'
      );
      
      runningEquity += t.pnl;
      // Save an equity snapshot for the chart
      db.prepare(`
        INSERT INTO equity_snapshots (time, balance, equity, unrealized_pnl, drawdown)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        t.exitTime, runningEquity, runningEquity, 0, 0
      );
  }
  console.log(`Saved ${tradeHistory.length} backtest trades and equity history to dashboard database.`);

  console.log('\n--- Trade Log ---');
  // Format the trade log for better readability in the terminal
  const formattedLog = tradeHistory.map(t => ({
      ID: t.id,
      Side: t.action,
      EntryTime: new Date(t.entryTime).toLocaleTimeString(),
      ExitTime: new Date(t.exitTime).toLocaleTimeString(),
      Entry: t.entryPrice.toFixed(4),
      Exit: t.exitPrice.toFixed(4),
      PnL: `$${t.pnl.toFixed(2)}`,
      Reason: t.reason
  }));
  console.table(formattedLog);

  console.log('\n--- Backtest Results ---');
  console.log(`Total Trades: ${tradeHistory.length}`);
  console.log(`Wins: ${winTrades.length} | Losses: ${loseTrades.length}`);
  console.log(`Win Rate: ${tradeHistory.length > 0 ? (winTrades.length / tradeHistory.length * 100).toFixed(2) : 0}%`);
  console.log(`Final Equity: $${accountEquity.toFixed(2)} (Start: $10000.00)`);
  console.log(`Total Return: ${((accountEquity - 10000) / 100).toFixed(2)}%`);
}

runBacktest().catch(console.error);
