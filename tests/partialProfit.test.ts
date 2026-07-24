import { initDb, db } from '../src/db';
import { TradingEngine } from '../src/engine/tradingEngine';
import { Quote } from '../src/data/priceFeed';

describe('Partial Profit & 1:2 / 1:3 RRR System', () => {
  beforeAll(() => {
    process.env.DB_PATH = ':memory:';
    initDb();
    TradingEngine.initialize();
  });

  beforeEach(() => {
    db.prepare('DELETE FROM positions').run();
    db.prepare('DELETE FROM trades').run();
  });

  it('should execute 50% partial profit at 1:2 RRR and move SL to Break-Even', async () => {
    const quote: Quote = {
      instrument: 'XAU/USD',
      bid: 2000.0,
      ask: 2000.5,
      time: new Date().toISOString(),
    };

    // Execute order with 200 pips SL ($2.00), 400 pips TP1 ($4.00, 1:2), 600 pips TP2 ($6.00, 1:3)
    const posId = await TradingEngine.executeOrder(
      'XAU/USD',
      'BUY',
      'asian_killzone',
      quote,
      200,
      600,
      undefined,
      undefined,
      undefined,
      undefined,
      0.02,
      400,
      600
    );

    expect(posId).not.toBeNull();

    let pos = TradingEngine.getActivePosition('XAU/USD', 'asian_killzone');
    expect(pos).not.toBeNull();
    const entryPrice = pos!.entryPrice;
    expect(pos?.units).toBe(2); // 0.02 Gold lots = 2 units
    expect(pos?.stopLoss).toBe(parseFloat((entryPrice - 2.0).toFixed(3)));
    expect(pos?.tp1Price).toBe(parseFloat((entryPrice + 4.0).toFixed(3)));
    expect(pos?.tp2Price).toBe(parseFloat((entryPrice + 6.0).toFixed(3)));

    // Simulate price reaching TP1
    const tp1Quote: Quote = {
      instrument: 'XAU/USD',
      bid: entryPrice + 4.1,
      ask: entryPrice + 4.2,
      time: new Date().toISOString(),
    };

    await TradingEngine.updatePositionsAndCheckSLTP([tp1Quote]);

    // Position should now have 50% units (1 unit), stopLoss updated to entryPrice, and partialTpHit = 1
    pos = TradingEngine.getActivePosition('XAU/USD', 'asian_killzone');
    expect(pos).not.toBeNull();
    expect(pos?.units).toBe(1);
    expect(pos?.stopLoss).toBe(entryPrice); // Moved to Break-Even!
    expect(pos?.partialTpHit).toBe(1);

    // Simulate price reaching TP2 -> should close position fully
    const tp2Quote: Quote = {
      instrument: 'XAU/USD',
      bid: entryPrice + 6.1,
      ask: entryPrice + 6.2,
      time: new Date().toISOString(),
    };

    await TradingEngine.updatePositionsAndCheckSLTP([tp2Quote]);

    pos = TradingEngine.getActivePosition('XAU/USD', 'asian_killzone');
    expect(pos).toBeNull(); // Fully closed at 1:3 RRR!
  });
});
