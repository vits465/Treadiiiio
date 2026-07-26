import { TradingEngine } from '../src/engine/tradingEngine';
import { db, initDb } from '../src/db';

describe('Order Lifecycle State Machine', () => {
  beforeAll(() => {
    initDb();
  });

  test('records order transitions into database', () => {
    const orderId = 'test_order_123';
    TradingEngine.recordOrderTransition(orderId, 'SUBMITTED', 'FILLED', 'Mock fill success');
    TradingEngine.recordOrderTransition(orderId, 'FILLED', 'CLOSED', 'Target TP hit');

    const transitions = db.prepare(`
      SELECT * FROM order_transitions WHERE order_id = ? ORDER BY timestamp ASC
    `).all(orderId) as any[];

    expect(transitions.length).toBe(2);
    expect(transitions[0].from_state).toBe('SUBMITTED');
    expect(transitions[0].to_state).toBe('FILLED');
    expect(transitions[1].from_state).toBe('FILLED');
    expect(transitions[1].to_state).toBe('CLOSED');
  });
});
