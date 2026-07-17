// Set up environment for tests (using in-memory DB)
process.env.DB_PATH = ':memory:';
process.env.USE_SIMULATOR = 'true';
process.env.CURRENCY_PAIRS = 'EUR_USD';
process.env.STARTING_BALANCE = '10000';
process.env.API_SECRET_KEY = 'test_api_key_for_unit_tests_1234';
process.env.CORS_ALLOWED_ORIGIN = 'http://localhost:3000';

import { initDb, db } from '../src/db';
import { TradingEngine } from '../src/engine/tradingEngine';
import { Quote, PriceFeed } from '../src/data/priceFeed';
import { MT5Client } from '../src/broker/mt5Client';

// Mock MT5Client
jest.mock('../src/broker/mt5Client', () => ({
  MT5Client: {
    placeOrder: jest.fn(),
    closeOrder: jest.fn().mockResolvedValue(true),
    getPositions: jest.fn().mockResolvedValue([]),
    getQuote: jest.fn(),
  }
}));

// Mock TelegramNotifier to avoid actual API calls in tests
jest.mock('../src/notifier/telegram', () => ({
  TelegramNotifier: {
    sendMessage: jest.fn(),
    initialize: jest.fn(),
  }
}));

describe('TradingEngine Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    try {
      db.prepare('DELETE FROM positions').run();
      db.prepare('DELETE FROM trades').run();
      db.prepare('DELETE FROM candles').run();
      db.prepare('DELETE FROM equity_snapshots').run();
      db.prepare('DELETE FROM model_runs').run();
      db.prepare('DELETE FROM filter_rejections').run();
    } catch (e) {}
    
    initDb();
    TradingEngine.initialize();
  });

  afterAll(() => {
    db.close();
  });

  test('should execute market BUY order with spread and slippage', async () => {
    const quote: Quote = {
      instrument: 'EUR_USD',
      time: new Date().toISOString(),
      bid: 1.0800,
      ask: 1.0802, // spread is 2 pips
    };

    // Slippage is 0.5 pips -> 0.00005. So entry price = 1.0802 + 0.00005 = 1.08025
    (MT5Client.placeOrder as jest.Mock).mockResolvedValueOnce({
      order_id: 'mock_1',
      instrument: 'EUR_USD',
      action: 'BUY',
      price: 1.08025,
      volume: 0.5
    });

    const orderId = await TradingEngine.executeOrder('EUR_USD', 'BUY', 'ma_crossover', quote, 30, 60);

    expect(orderId).not.toBeNull();

    const openPositions = TradingEngine.getOpenPositions();
    expect(openPositions.length).toBe(1);
    expect(openPositions[0].instrument).toBe('EUR_USD');
    expect(openPositions[0].action).toBe('BUY');
    expect(openPositions[0].entryPrice).toBeCloseTo(1.08025, 5);
    expect(openPositions[0].stopLoss).toBeCloseTo(1.08025 - 30 * 0.0001, 5); // 1.07725
    expect(openPositions[0].takeProfit).toBeCloseTo(1.08025 + 60 * 0.0001, 5); // 1.08625
  });

  test('should execute market SELL order with spread and slippage', async () => {
    const quote: Quote = {
      instrument: 'EUR_USD',
      time: new Date().toISOString(),
      bid: 1.0800,
      ask: 1.0802,
    };

    // Sell at bid - slippage. Entry price = 1.0800 - 0.00005 = 1.07995
    (MT5Client.placeOrder as jest.Mock).mockResolvedValueOnce({
      order_id: 'mock_2',
      instrument: 'EUR_USD',
      action: 'SELL',
      price: 1.07995,
      volume: 0.5
    });

    const orderId = await TradingEngine.executeOrder('EUR_USD', 'SELL', 'ma_crossover', quote, 30, 60);

    expect(orderId).not.toBeNull();

    const openPositions = TradingEngine.getOpenPositions();
    expect(openPositions.length).toBe(1);
    expect(openPositions[0].action).toBe('SELL');
    expect(openPositions[0].entryPrice).toBeCloseTo(1.07995, 5);
    expect(openPositions[0].stopLoss).toBeCloseTo(1.07995 + 30 * 0.0001, 5); // 1.08295
    expect(openPositions[0].takeProfit).toBeCloseTo(1.07995 - 60 * 0.0001, 5); // 1.07395
  });

  test('should calculate realized PnL correctly when closing positions', async () => {
    const entryQuote: Quote = {
      instrument: 'EUR_USD',
      time: new Date().toISOString(),
      bid: 1.0800,
      ask: 1.0802,
    };

    (MT5Client.placeOrder as jest.Mock).mockResolvedValueOnce({
      order_id: 'mock_3',
      instrument: 'EUR_USD',
      action: 'BUY',
      price: 1.08025,
      volume: 0.5
    });

    const orderId = await TradingEngine.executeOrder('EUR_USD', 'BUY', 'ma_crossover', entryQuote, 30, 60);
    expect(orderId).not.toBeNull();

    const openPos = TradingEngine.getOpenPositions()[0];
    const units = openPos.units;

    // Exit Quote:
    const exitQuote: Quote = {
      instrument: 'EUR_USD',
      time: new Date().toISOString(),
      bid: 1.0850, // price went up
      ask: 1.0852,
    };

    // Close position: exit price = exitQuote.bid = 1.0850
    // PnL = (exitPrice - entryPrice) * units = (1.0850 - 1.08025) * units = 0.00475 * units
    const pnl = await TradingEngine.closePosition(orderId!, exitQuote, 'Test Close');
    
    expect(pnl).toBeCloseTo(0.00475 * units, 2);
    expect(TradingEngine.getBalance()).toBeCloseTo(10000 + pnl, 2);

    const activePositions = TradingEngine.getOpenPositions();
    expect(activePositions.length).toBe(0);
  });

  test('should trigger Stop Loss and Take Profit automatically', async () => {
    const entryQuote: Quote = {
      instrument: 'EUR_USD',
      time: new Date().toISOString(),
      bid: 1.0800,
      ask: 1.0802,
    };

    (MT5Client.placeOrder as jest.Mock).mockResolvedValueOnce({
      order_id: 'mock_4',
      instrument: 'EUR_USD',
      action: 'BUY',
      price: 1.08025,
      volume: 0.5
    });

    // Entry price: BUY @ 1.08025. SL = 1.07725. TP = 1.08625
    const orderId = await TradingEngine.executeOrder('EUR_USD', 'BUY', 'ma_crossover', entryQuote, 30, 60);
    expect(orderId).not.toBeNull();

    // 1. Move price to hit Stop Loss
    const slQuote: Quote = {
      instrument: 'EUR_USD',
      time: new Date().toISOString(),
      bid: 1.0770, // lower than SL (1.07725)
      ask: 1.0772,
    };

    await TradingEngine.updatePositionsAndCheckSLTP([slQuote]);

    // Position should be closed
    let openPositions = TradingEngine.getOpenPositions();
    expect(openPositions.length).toBe(0);

    // 2. Re-open to test Take Profit
    (MT5Client.placeOrder as jest.Mock).mockResolvedValueOnce({
      order_id: 'mock_5',
      instrument: 'EUR_USD',
      action: 'BUY',
      price: 1.08025,
      volume: 0.5
    });
    const orderId2 = await TradingEngine.executeOrder('EUR_USD', 'BUY', 'ma_crossover', entryQuote, 30, 60);
    expect(orderId2).not.toBeNull();

    // Move price to hit Take Profit
    const tpQuote: Quote = {
      instrument: 'EUR_USD',
      time: new Date().toISOString(),
      bid: 1.0870, // higher than TP (1.08625)
      ask: 1.0872,
    };

    await TradingEngine.updatePositionsAndCheckSLTP([tpQuote]);

    openPositions = TradingEngine.getOpenPositions();
    expect(openPositions.length).toBe(0);
  });
});
