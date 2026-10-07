import { Candle, Quote } from '../data/priceFeed';
export { Candle, Quote };

export type SignalAction = 'BUY' | 'SELL' | 'CLOSE';

export interface StrategyEvaluationResult {
  signal: 'BUY' | 'SELL' | 'CLOSE' | 'NONE';
  confidence: number;
  reason: string;
  sl: number;
  tp: number;
  stopLossPips?: number;
  takeProfitPips?: number;
  tp1Pips?: number;
  tp2Pips?: number;
  requestedLots?: number;
  amountToRecover?: number;
  atr?: number;
}

export interface Signal {
  action: SignalAction;
  instrument: string;
  strategy: string;
  confidence?: number; // 0 to 1
  reason?: string;
  atr?: number; // Added for ATR-based TP/SL sizing
  stopLossPips?: number;
  takeProfitPips?: number;
  tp1Pips?: number; // 1:2 RRR Partial Profit Pips
  tp2Pips?: number; // 1:3 RRR Full Exit Pips
  amountToRecover?: number;
  requestedLots?: number;
  modelId?: string; // ML model version tracking
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
  tp1Price?: number;
  tp2Price?: number;
  partialTpHit?: number;
  initialUnits?: number;
  strategy: string;
  brokerOrderId?: string;
  modelId?: string;
}

export interface MarketContext {
  historicalCandles: Candle[]; // sorted chronologically (oldest first, newest/latest at end)
  macroCandles?: Candle[]; // Multi-timeframe trend context (e.g. Daily candles)
  hourlyCandles?: Candle[]; // 1-hour candles for MTF confirmation
  hourlyTrend?: 'UP' | 'DOWN' | 'NEUTRAL'; // 1-hour trend direction
  currentQuote: Quote;
  activePosition: PositionInfo | null;
  accountEquity: number;
  openPositionsCount: number;
  currentRegime?: string; // TRENDING, RANGING, HIGH_VOLATILITY
}

export interface Strategy {
  name: string;
  onCandle(candle: Candle, context: MarketContext): Signal | null;
  evaluate(candles: Candle[], context: MarketContext): StrategyEvaluationResult;
}
