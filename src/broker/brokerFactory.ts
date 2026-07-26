import { BrokerAdapter } from './brokerAdapter.interface';
import { MockBrokerAdapter } from './mockBroker';
import { MT5BrokerAdapter } from './mt5Broker';
import { config } from '../config';

export class BrokerFactory {
  private static instance: BrokerAdapter | null = null;

  public static getAdapter(): BrokerAdapter {
    if (!this.instance) {
      if (config.USE_SIMULATOR) {
        this.instance = new MockBrokerAdapter();
      } else {
        this.instance = new MT5BrokerAdapter();
      }
    }
    return this.instance;
  }
}
