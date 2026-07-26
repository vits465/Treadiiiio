import { MockBrokerAdapter } from '../src/broker/mockBroker';
import { MT5BrokerAdapter } from '../src/broker/mt5Broker';
import { BrokerFactory } from '../src/broker/brokerFactory';
import { Quote } from '../src/data/priceFeed';

const mockQuote: Quote = {
  instrument: 'EUR/USD',
  time: new Date().toISOString(),
  bid: 1.0800,
  ask: 1.08015,
};

describe('BrokerAdapter Interface & Factory', () => {
  test('MockBrokerAdapter applies realistic spread and slippage', async () => {
    const broker = new MockBrokerAdapter();
    const result = await broker.placeOrder({
      instrument: 'EUR/USD',
      action: 'BUY',
      units: 10000,
      strategy: 'ma_crossover',
    }, mockQuote);

    expect(result.status).toBe('FILLED');
    expect(result.entryPrice).toBeGreaterThan(mockQuote.ask);
    expect(result.slippagePips).toBeGreaterThanOrEqual(0.1);
  });

  test('MT5BrokerAdapter transmits order cleanly', async () => {
    const broker = new MT5BrokerAdapter();
    const result = await broker.placeOrder({
      instrument: 'EUR/USD',
      action: 'BUY',
      units: 10000,
      strategy: 'ma_crossover',
    }, mockQuote);

    expect(result.status).toBe('FILLED');
    expect(result.brokerOrderId).toBeDefined();
  });

  test('BrokerFactory returns appropriate adapter instance', () => {
    const adapter = BrokerFactory.getAdapter();
    expect(adapter).toBeDefined();
    expect(['MockBroker', 'MetaTrader5']).toContain(adapter.name);
  });
});
