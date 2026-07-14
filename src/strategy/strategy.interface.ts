import { Candle, Quote } from '../data/priceFeed';
export { Candle, Quote };

export type SignalAction = 'BUY' | 'SELL' | 'CLOSE';

export interface Signal {
  action: SignalAction;
  instrument: string;
  strategy: string;
  confidence?: number; // 0 to 1
  stopLossPips?: number;
  takeProfitPips?: number;
  amountToRecover?: number;
}

export interface PositionInfo {
  id: string;
  instrument: string;
  action: 'BUY' | 'SELL';
  entryTime: string;
  entryPrice: number;
  units: number;
  unrealizedPnL: number;
  stopLoss?: number;
  takeProfit?: number;
  strategy: string;
}

export interface MarketContext {
  historicalCandles: Candle[]; // sorted chronologically (oldest first, newest/latest at end)
  macroCandles?: Candle[]; // Multi-timeframe trend context (e.g. Daily candles)
  currentQuote: Quote;
  activePosition: PositionInfo | null;
  accountEquity: number;
  openPositionsCount: number;
}

export interface Strategy {
  name: string;
  onCandle(candle: Candle, context: MarketContext): Signal | null;
}
