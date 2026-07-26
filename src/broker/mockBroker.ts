import { BrokerAdapter, OrderRequest, OrderResult, AccountSummary } from './brokerAdapter.interface';
import { Quote } from '../data/priceFeed';
import { logger } from '../logger';
import { v4 as uuidv4 } from 'uuid';

export class MockBrokerAdapter implements BrokerAdapter {
  public readonly name = 'MockBroker';

  public async placeOrder(request: OrderRequest, currentQuote: Quote): Promise<OrderResult> {
    const startTime = Date.now();
    const isJpy = request.instrument.includes('JPY');
    const isXau = request.instrument.includes('XAU');
    const pipSize = (isJpy || isXau) ? 0.01 : 0.0001;

    // Simulate realistic slippage (0.1 to 0.8 pips randomized)
    const randomizedSlippagePips = Math.round((0.1 + Math.random() * 0.7) * 10) / 10;
    const slippageOffset = randomizedSlippagePips * pipSize;

    // Apply bid/ask spread & slippage
    const basePrice = request.action === 'BUY' ? currentQuote.ask : currentQuote.bid;
    const entryPrice = request.action === 'BUY' 
      ? basePrice + slippageOffset 
      : basePrice - slippageOffset;

    const latencyMs = Date.now() - startTime;
    const orderId = uuidv4();
    const mockTicket = `mock_${Math.floor(Math.random() * 1000000000)}`;

    logger.info(`[MOCK BROKER] Placed ${request.action} order for ${request.units} units of ${request.instrument} @ ${entryPrice.toFixed(4)} (Slippage: ${randomizedSlippagePips} pips)`);

    return {
      orderId,
      brokerOrderId: mockTicket,
      instrument: request.instrument,
      action: request.action,
      units: request.units,
      entryPrice,
      entryTime: new Date().toISOString(),
      status: 'FILLED',
      slippagePips: randomizedSlippagePips,
      latencyMs,
      stopLoss: request.stopLoss,
      takeProfit: request.takeProfit,
      tp1Price: request.tp1Price,
      tp2Price: request.tp2Price,
    };
  }

  public async closeOrder(orderId: string, currentQuote: Quote, reason?: string): Promise<{ realizedPnL: number; closePrice: number }> {
    const closePrice = currentQuote.bid;
    logger.info(`[MOCK BROKER] Closed order ${orderId} @ ${closePrice.toFixed(4)} (${reason || 'Manual'})`);
    return { realizedPnL: 0, closePrice };
  }

  public async modifyOrder(orderId: string, newStopLoss?: number, newTakeProfit?: number): Promise<boolean> {
    logger.info(`[MOCK BROKER] Modified order ${orderId} -> SL: ${newStopLoss ?? 'UNCHANGED'}, TP: ${newTakeProfit ?? 'UNCHANGED'}`);
    return true;
  }

  public async getAccountSummary(): Promise<AccountSummary> {
    return {
      balance: 10000,
      equity: 10000,
      freeMargin: 10000,
      openPositionsCount: 0,
    };
  }
}
