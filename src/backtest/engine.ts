import { Candle, Quote } from '../data/priceFeed';
import { Strategy, MarketContext } from '../strategy/strategy.interface';
import { BacktestTrade, BacktestMetrics, BacktestMetricsCalculator } from './metrics';
import { v4 as uuidv4 } from 'uuid';

export interface BacktestOptions {
  startingBalance?: number;
  spreadPips?: number;
  commissionPerLotUsd?: number; // default $7/lot round turn
  slippagePips?: number;
}

export class EventDrivenBacktestEngine {
  /**
   * Runs an event-driven backtest across historical candles for a strategy.
   */
  public static runBacktest(
    strategy: Strategy,
    candles: Candle[],
    options: BacktestOptions = {}
  ): { trades: BacktestTrade[]; metrics: BacktestMetrics; equityCurve: { time: string; equity: number }[] } {
    const startingBalance = options.startingBalance || 10000;
    const spreadPips = options.spreadPips || 1.5;
    const commissionPerLot = options.commissionPerLotUsd || 7.0;
    const slippagePips = options.slippagePips || 0.5;

    let balance = startingBalance;
    const trades: BacktestTrade[] = [];
    const equityCurve: { time: string; equity: number }[] = [];

    if (candles.length < 30) {
      const metrics = BacktestMetricsCalculator.calculate([], startingBalance);
      return { trades: [], metrics, equityCurve: [] };
    }

    let activePosition: {
      id: string;
      action: 'BUY' | 'SELL';
      entryPrice: number;
      entryTime: string;
      units: number;
      stopLoss: number;
      takeProfit: number;
    } | null = null;

    const isJpy = candles[0].instrument.includes('JPY');
    const isXau = candles[0].instrument.includes('XAU');
    const pipSize = (isJpy || isXau) ? 0.01 : 0.0001;

    for (let i = 25; i < candles.length; i++) {
      const currentCandle = candles[i];
      const history = candles.slice(0, i + 1);

      const quote: Quote = {
        instrument: currentCandle.instrument,
        time: currentCandle.time,
        bid: currentCandle.close,
        ask: currentCandle.close + spreadPips * pipSize,
      };

      // 1. Manage active position SL/TP triggers
      if (activePosition) {
        let closed = false;
        let exitPrice = currentCandle.close;
        let exitReason = '';

        if (activePosition.action === 'BUY') {
          if (currentCandle.low <= activePosition.stopLoss) {
            exitPrice = activePosition.stopLoss;
            exitReason = 'SL';
            closed = true;
          } else if (currentCandle.high >= activePosition.takeProfit) {
            exitPrice = activePosition.takeProfit;
            exitReason = 'TP';
            closed = true;
          }
        } else if (activePosition.action === 'SELL') {
          if (currentCandle.high >= activePosition.stopLoss) {
            exitPrice = activePosition.stopLoss;
            exitReason = 'SL';
            closed = true;
          } else if (currentCandle.low <= activePosition.takeProfit) {
            exitPrice = activePosition.takeProfit;
            exitReason = 'TP';
            closed = true;
          }
        }

        if (closed) {
          const rawPnl = activePosition.action === 'BUY'
            ? (exitPrice - activePosition.entryPrice) * activePosition.units
            : (activePosition.entryPrice - exitPrice) * activePosition.units;

          const contractSize = isXau ? 100 : 100000;
          const lots = activePosition.units / contractSize;
          const commCost = lots * commissionPerLot;
          const netPnl = rawPnl - commCost;

          balance += netPnl;

          trades.push({
            id: activePosition.id,
            instrument: currentCandle.instrument,
            action: activePosition.action,
            entryPrice: activePosition.entryPrice,
            exitPrice,
            entryTime: activePosition.entryTime,
            exitTime: currentCandle.time,
            units: activePosition.units,
            pnl: netPnl,
            strategy: strategy.name,
          });

          activePosition = null;
        }
      }

      // 2. Evaluate strategy signal on candle
      if (!activePosition) {
        const context: MarketContext = {
          historicalCandles: history,
          currentQuote: quote,
          activePosition: null,
          accountEquity: balance,
          openPositionsCount: 0,
        };

        const signal = strategy.onCandle(currentCandle, context);
        if (signal && (signal.action === 'BUY' || signal.action === 'SELL')) {
          const slPips = signal.stopLossPips || 30;
          const tpPips = signal.takeProfitPips || 60;
          const slDist = slPips * pipSize;
          const tpDist = tpPips * pipSize;

          const fillSlippage = slippagePips * pipSize;
          const entryPrice = signal.action === 'BUY' ? quote.ask + fillSlippage : quote.bid - fillSlippage;
          const stopLoss = signal.action === 'BUY' ? entryPrice - slDist : entryPrice + slDist;
          const takeProfit = signal.action === 'BUY' ? entryPrice + tpDist : entryPrice - tpDist;

          // Sizing: 1% risk
          const riskUsd = balance * 0.01;
          const units = Math.max(1000, Math.floor(riskUsd / slDist));

          activePosition = {
            id: uuidv4(),
            action: signal.action,
            entryPrice,
            entryTime: currentCandle.time,
            units,
            stopLoss,
            takeProfit,
          };
        }
      }

      equityCurve.push({ time: currentCandle.time, equity: balance });
    }

    const metrics = BacktestMetricsCalculator.calculate(trades, startingBalance);
    return { trades, metrics, equityCurve };
  }
}
