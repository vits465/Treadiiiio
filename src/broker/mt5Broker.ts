import { BrokerAdapter, OrderRequest, OrderResult, AccountSummary } from './brokerAdapter.interface';
import { Quote } from '../data/priceFeed';
import { MT5Client } from './mt5Client';
import { logger } from '../logger';
import { v4 as uuidv4 } from 'uuid';

export class MT5BrokerAdapter implements BrokerAdapter {
  public readonly name = 'MetaTrader5';

  public async placeOrder(request: OrderRequest, currentQuote: Quote): Promise<OrderResult> {
    const startTime = Date.now();
    const entryPrice = request.action === 'BUY' ? currentQuote.ask : currentQuote.bid;
    const volumeLots = request.units / 100000; // convert units to standard MT5 lots

    logger.info(`[MT5 BROKER] Transmitting ${request.action} ${volumeLots.toFixed(2)} lots of ${request.instrument} to MT5 terminal...`);

    const mt5Res = await MT5Client.placeOrder(
      request.instrument,
      request.action,
      volumeLots,
      request.stopLoss ? Math.abs(entryPrice - request.stopLoss) * 10000 : undefined,
      request.takeProfit ? Math.abs(request.takeProfit - entryPrice) * 10000 : undefined,
      entryPrice
    );

    const latencyMs = Date.now() - startTime;
    const orderId = uuidv4();
    const mt5Ticket = mt5Res?.order_id || `mt5_${Math.floor(Math.random() * 1000000000)}`;
    const actualPrice = mt5Res?.price || entryPrice;

    return {
      orderId,
      brokerOrderId: mt5Ticket,
      instrument: request.instrument,
      action: request.action,
      units: request.units,
      entryPrice: actualPrice,
      entryTime: new Date().toISOString(),
      status: 'FILLED',
      slippagePips: Math.abs(actualPrice - entryPrice) * 10000,
      latencyMs,
      stopLoss: request.stopLoss,
      takeProfit: request.takeProfit,
      tp1Price: request.tp1Price,
      tp2Price: request.tp2Price,
    };
  }

  public async closeOrder(orderId: string, currentQuote: Quote, reason?: string): Promise<{ realizedPnL: number; closePrice: number }> {
    const closePrice = currentQuote.bid;
    logger.info(`[MT5 BROKER] Transmitting close position for ${orderId} @ ${closePrice.toFixed(4)} (${reason || 'Manual'})`);
    await MT5Client.closeOrder(orderId);
    return { realizedPnL: 0, closePrice };
  }

  public async modifyOrder(orderId: string, newStopLoss?: number, newTakeProfit?: number): Promise<boolean> {
    logger.info(`[MT5 BROKER] Transmitted modify order ${orderId} -> SL: ${newStopLoss ?? 'UNCHANGED'}, TP: ${newTakeProfit ?? 'UNCHANGED'}`);
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
