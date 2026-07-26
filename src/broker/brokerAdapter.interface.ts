import { Quote } from '../data/priceFeed';

export type OrderState = 'SUBMITTED' | 'PENDING' | 'FILLED' | 'REJECTED' | 'EXPIRED' | 'CLOSED';

export interface OrderRequest {
  instrument: string;
  action: 'BUY' | 'SELL';
  units: number;
  stopLoss?: number;
  takeProfit?: number;
  tp1Price?: number;
  tp2Price?: number;
  strategy: string;
  signalTime?: string;
  signalPrice?: number;
}

export interface OrderResult {
  orderId: string;
  brokerOrderId?: string;
  instrument: string;
  action: 'BUY' | 'SELL';
  units: number;
  entryPrice: number;
  entryTime: string;
  status: OrderState;
  slippagePips: number;
  latencyMs: number;
  stopLoss?: number;
  takeProfit?: number;
  tp1Price?: number;
  tp2Price?: number;
}

export interface AccountSummary {
  balance: number;
  equity: number;
  freeMargin: number;
  openPositionsCount: number;
}

export interface BrokerAdapter {
  name: string;
  placeOrder(request: OrderRequest, currentQuote: Quote): Promise<OrderResult>;
  closeOrder(orderId: string, currentQuote: Quote, reason?: string): Promise<{ realizedPnL: number; closePrice: number }>;
  modifyOrder(orderId: string, newStopLoss?: number, newTakeProfit?: number): Promise<boolean>;
  getAccountSummary(): Promise<AccountSummary>;
}
