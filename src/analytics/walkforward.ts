import { Candle, MarketContext, Strategy } from '../strategy/strategy.interface';
import { PowerBreakoutStrategy } from '../strategy/powerBreakout';
import { Scalper1mStrategy } from '../strategy/scalper1m';
import { MaCrossoverStrategy } from '../strategy/maCrossover';
import { RsiMeanReversionStrategy } from '../strategy/rsiMeanReversion';
import { RegimeRouter, MarketRegimeType } from './regimeRouter';
import { config } from '../config';

export interface CostModel {
  spreadPips: number;        // e.g., 1.5 pips
  entrySlippagePips: number; // e.g., 0.5 pips
  stopSlippagePips: number;  // e.g., 0.5 pips
  commissionPerLotUsd: number; // e.g., $7 per lot ($0.70 per 0.10 lot)
}

export interface TradeMetrics {
  id: string;
  strategy: string;
  instrument: string;
  action: 'BUY' | 'SELL';
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  units: number;
  pnlUsd: number;
  pnlPips: number;
  holdingBars: number;
  exitReason: string;
  regimeAtEntry: MarketRegimeType;
}

export interface BacktestReport {
  strategyName: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  totalProfitUsd: number;
  totalLossUsd: number;
  profitFactor: number;
  expectancyUsdPerTrade: number;
  expectancyPipsPerTrade: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  avgHoldingTimeMinutes: number;
  costImpactUsd: number;
}

export interface WalkForwardResult {
  strategyName: string;
  inSampleReport: BacktestReport;
  outOfSampleReport: BacktestReport;
  stabilityIndex: number; // Out-of-sample expectancy / In-sample expectancy
}

export class WalkForwardBacktester {
  private costModel: CostModel;

  constructor(costModel?: Partial<CostModel>) {
    this.costModel = {
      spreadPips: costModel?.spreadPips ?? config.SPREAD_PIPS ?? 1.5,
      entrySlippagePips: costModel?.entrySlippagePips ?? config.SLIPPAGE_PIPS ?? 0.5,
      stopSlippagePips: costModel?.stopSlippagePips ?? 0.5,
      commissionPerLotUsd: costModel?.commissionPerLotUsd ?? 7.0,
    };
  }

  /**
   * Executes backtest pass over a array of candles with cost friction & regime filtering.
   */
  public runBacktestPass(
    strategy: Strategy,
    candles: Candle[],
    startingBalance: number = 10000,
    useRegimeFilter: boolean = true
  ): BacktestReport {
    let balance = startingBalance;
    let peakEquity = startingBalance;
    let maxDrawdownUsd = 0;

    const trades: TradeMetrics[] = [];
    const pipSize = candles[0]?.instrument?.includes('JPY') || candles[0]?.instrument?.includes('XAU') ? 0.01 : 0.0001;
    const halfSpread = (this.costModel.spreadPips / 2) * pipSize;
    const entrySlip = this.costModel.entrySlippagePips * pipSize;
    const stopSlip = this.costModel.stopSlippagePips * pipSize;

    let activePosition: {
      id: string;
      action: 'BUY' | 'SELL';
      entryPrice: number;
      entryIndex: number;
      entryTime: string;
      units: number;
      stopLossPrice: number;
      takeProfitPrice: number;
      stopLossPips: number;
      takeProfitPips: number;
      regime: MarketRegimeType;
    } | null = null;

    let totalCostUsd = 0;

    for (let i = 30; i < candles.length; i++) {
      const currentCandle = candles[i];
      const prevCandles = candles.slice(0, i);
      const instrument = currentCandle.instrument || 'EUR/USD';

      // 1. Evaluate Intrabar Exit for Active Position
      if (activePosition) {
        let closed = false;
        let exitPrice = 0;
        let exitReason = '';
        let exitPips = 0;

        const isBuy = activePosition.action === 'BUY';
        const intrabarHigh = currentCandle.high - halfSpread;
        const intrabarLow = currentCandle.low + halfSpread;

        if (isBuy) {
          if (currentCandle.low <= activePosition.stopLossPrice) {
            closed = true;
            exitPrice = Math.min(activePosition.stopLossPrice - stopSlip, currentCandle.low);
            exitReason = 'STOP_LOSS';
          } else if (currentCandle.high >= activePosition.takeProfitPrice) {
            closed = true;
            exitPrice = activePosition.takeProfitPrice;
            exitReason = 'TAKE_PROFIT';
          }
        } else {
          if (currentCandle.high >= activePosition.stopLossPrice) {
            closed = true;
            exitPrice = Math.max(activePosition.stopLossPrice + stopSlip, currentCandle.high);
            exitReason = 'STOP_LOSS';
          } else if (currentCandle.low <= activePosition.takeProfitPrice) {
            closed = true;
            exitPrice = activePosition.takeProfitPrice;
            exitReason = 'TAKE_PROFIT';
          }
        }

        if (closed) {
          const rawPriceDiff = isBuy ? exitPrice - activePosition.entryPrice : activePosition.entryPrice - exitPrice;
          exitPips = rawPriceDiff / pipSize;
          
          // Position sizing PnL (assuming standard 100,000 units per lot, 1% equity risk)
          const rawPnL = (rawPriceDiff * activePosition.units);
          
          // Cost deductions: Commission ($7/lot)
          const lots = activePosition.units / 100000;
          const commissionCost = lots * this.costModel.commissionPerLotUsd;
          const netPnL = rawPnL - commissionCost;

          totalCostUsd += commissionCost + (this.costModel.spreadPips + this.costModel.entrySlippagePips) * lots * 10;

          balance += netPnL;
          if (balance > peakEquity) peakEquity = balance;
          const currentDd = peakEquity - balance;
          if (currentDd > maxDrawdownUsd) maxDrawdownUsd = currentDd;

          trades.push({
            id: activePosition.id,
            strategy: strategy.name,
            instrument,
            action: activePosition.action,
            entryTime: activePosition.entryTime,
            exitTime: currentCandle.time,
            entryPrice: activePosition.entryPrice,
            exitPrice,
            units: activePosition.units,
            pnlUsd: netPnL,
            pnlPips: exitPips,
            holdingBars: i - activePosition.entryIndex,
            exitReason,
            regimeAtEntry: activePosition.regime,
          });

          activePosition = null;
        }
      }

      // 2. Evaluate Strategy Signal for Entry (Only if no active position)
      if (!activePosition) {
        const regimeAnalysis = RegimeRouter.evaluateRegime(prevCandles, instrument);
        const currentRegime = regimeAnalysis.regime;

        // Market Regime Filter
        if (useRegimeFilter) {
          const allowed = RegimeRouter.isStrategyAllowedForRegime(strategy.name, currentRegime);
          if (!allowed) continue;

          // Scalper 1m specific regime rule: strictly block scalping in HIGH_VOLATILITY or strong TRENDING regimes where spread expands
          if (strategy.name === 'scalping_1m' && (currentRegime === 'HIGH_VOLATILITY' || regimeAnalysis.adx > 35)) {
            continue;
          }
        }

        const context: MarketContext = {
          historicalCandles: prevCandles,
          macroCandles: prevCandles.filter((_, idx) => idx % 24 === 0),
          currentQuote: {
            instrument,
            bid: currentCandle.close - halfSpread,
            ask: currentCandle.close + halfSpread,
            time: new Date().toISOString(),
          },
          activePosition: null,
          accountEquity: balance,
          openPositionsCount: 0,
          currentRegime,
        };

        const signal = strategy.onCandle(currentCandle, context);

        if (signal && (signal.action === 'BUY' || signal.action === 'SELL')) {
          const isBuy = signal.action === 'BUY';
          const fillPrice = isBuy
            ? currentCandle.close + halfSpread + entrySlip
            : currentCandle.close - halfSpread - entrySlip;

          const slPips = signal.stopLossPips || 20;
          const tpPips = signal.takeProfitPips || 40;

          const slDistancePrice = slPips * pipSize;
          const tpDistancePrice = tpPips * pipSize;

          const stopLossPrice = isBuy ? fillPrice - slDistancePrice : fillPrice + slDistancePrice;
          const takeProfitPrice = isBuy ? fillPrice + tpDistancePrice : fillPrice - tpDistancePrice;

          // Standard 1% fixed-fractional risk sizing
          const riskAmountUsd = balance * 0.01;
          const riskPerUnit = slDistancePrice;
          const units = Math.max(1000, Math.min(100000, Math.round(riskAmountUsd / riskPerUnit)));

          activePosition = {
            id: `wf_${i}`,
            action: signal.action,
            entryPrice: fillPrice,
            entryIndex: i,
            entryTime: currentCandle.time,
            units,
            stopLossPrice,
            takeProfitPrice,
            stopLossPips: slPips,
            takeProfitPips: tpPips,
            regime: currentRegime,
          };
        }
      }
    }

    return this.compileReport(strategy.name, trades, startingBalance, maxDrawdownUsd, totalCostUsd);
  }

  /**
   * Executes Walk-Forward Validation (Split: 60% Train / In-Sample, 40% Test / Out-of-Sample).
   */
  public runWalkForwardValidation(
    strategy: Strategy,
    candles: Candle[],
    trainRatio: number = 0.60
  ): WalkForwardResult {
    const splitIndex = Math.floor(candles.length * trainRatio);
    const inSampleCandles = candles.slice(0, splitIndex);
    const outOfSampleCandles = candles.slice(splitIndex);

    const inSampleReport = this.runBacktestPass(strategy, inSampleCandles, 10000, true);
    const outOfSampleReport = this.runBacktestPass(strategy, outOfSampleCandles, 10000, true);

    const stabilityIndex = inSampleReport.expectancyUsdPerTrade !== 0
      ? outOfSampleReport.expectancyUsdPerTrade / inSampleReport.expectancyUsdPerTrade
      : 0;

    return {
      strategyName: strategy.name,
      inSampleReport,
      outOfSampleReport,
      stabilityIndex: Math.round(stabilityIndex * 100) / 100,
    };
  }

  private compileReport(
    strategyName: string,
    trades: TradeMetrics[],
    startingBalance: number,
    maxDrawdownUsd: number,
    totalCostUsd: number
  ): BacktestReport {
    const totalTrades = trades.length;
    if (totalTrades === 0) {
      return {
        strategyName,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRatePct: 0,
        totalProfitUsd: 0,
        totalLossUsd: 0,
        profitFactor: 0,
        expectancyUsdPerTrade: 0,
        expectancyPipsPerTrade: 0,
        maxDrawdownPct: 0,
        sharpeRatio: 0,
        avgHoldingTimeMinutes: 0,
        costImpactUsd: 0,
      };
    }

    const winningTrades = trades.filter((t) => t.pnlUsd > 0);
    const losingTrades = trades.filter((t) => t.pnlUsd <= 0);

    const totalProfitUsd = winningTrades.reduce((sum, t) => sum + t.pnlUsd, 0);
    const totalLossUsd = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnlUsd, 0));

    const winRatePct = (winningTrades.length / totalTrades) * 100;
    const profitFactor = totalLossUsd > 0 ? totalProfitUsd / totalLossUsd : totalProfitUsd > 0 ? 99.0 : 0;

    const totalNetPnL = totalProfitUsd - totalLossUsd;
    const expectancyUsdPerTrade = totalNetPnL / totalTrades;
    const totalPips = trades.reduce((sum, t) => sum + t.pnlPips, 0);
    const expectancyPipsPerTrade = totalPips / totalTrades;

    const maxDrawdownPct = (maxDrawdownUsd / startingBalance) * 100;

    // Calculate Sharpe Ratio (daily/per-trade return std dev)
    const returns = trades.map((t) => t.pnlUsd / startingBalance);
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0;

    const avgHoldingBars = trades.reduce((sum, t) => sum + t.holdingBars, 0) / totalTrades;
    const avgHoldingTimeMinutes = avgHoldingBars * 60; // Assuming hourly/1-min candle scale

    return {
      strategyName,
      totalTrades,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRatePct: Math.round(winRatePct * 10) / 10,
      totalProfitUsd: Math.round(totalProfitUsd * 100) / 100,
      totalLossUsd: Math.round(totalLossUsd * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      expectancyUsdPerTrade: Math.round(expectancyUsdPerTrade * 100) / 100,
      expectancyPipsPerTrade: Math.round(expectancyPipsPerTrade * 10) / 10,
      maxDrawdownPct: Math.round(maxDrawdownPct * 10) / 10,
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      avgHoldingTimeMinutes: Math.round(avgHoldingTimeMinutes),
      costImpactUsd: Math.round(totalCostUsd * 100) / 100,
    };
  }
}
