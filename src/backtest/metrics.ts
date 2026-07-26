export interface BacktestTrade {
  id: string;
  instrument: string;
  action: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  entryTime: string;
  exitTime: string;
  units: number;
  pnl: number;
  strategy: string;
}

export interface BacktestMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  netProfit: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  expectancyUsd: number;
  recoveryFactor: number;
  maxConsecutiveLosses: number;
}

export class BacktestMetricsCalculator {
  public static calculate(trades: BacktestTrade[], startingBalance: number = 10000): BacktestMetrics {
    if (trades.length === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        netProfit: 0,
        grossProfit: 0,
        grossLoss: 0,
        profitFactor: 0,
        maxDrawdownUsd: 0,
        maxDrawdownPct: 0,
        sharpeRatio: 0,
        sortinoRatio: 0,
        expectancyUsd: 0,
        recoveryFactor: 0,
        maxConsecutiveLosses: 0,
      };
    }

    let grossProfit = 0;
    let grossLoss = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let currentStreak = 0;
    let maxConsecutiveLosses = 0;

    let balance = startingBalance;
    let peakBalance = startingBalance;
    let maxDrawdownUsd = 0;
    let maxDrawdownPct = 0;

    const returns: number[] = [];
    const downsideReturns: number[] = [];

    for (const t of trades) {
      if (t.pnl > 0) {
        grossProfit += t.pnl;
        winningTrades++;
        currentStreak = 0;
      } else if (t.pnl < 0) {
        grossLoss += Math.abs(t.pnl);
        losingTrades++;
        currentStreak++;
        if (currentStreak > maxConsecutiveLosses) {
          maxConsecutiveLosses = currentStreak;
        }
      }

      const retPct = t.pnl / balance;
      returns.push(retPct);
      if (retPct < 0) downsideReturns.push(retPct);

      balance += t.pnl;
      if (balance > peakBalance) {
        peakBalance = balance;
      }

      const ddUsd = peakBalance - balance;
      const ddPct = (ddUsd / peakBalance) * 100;
      if (ddUsd > maxDrawdownUsd) maxDrawdownUsd = ddUsd;
      if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
    }

    const totalTrades = trades.length;
    const netProfit = grossProfit - grossLoss;
    const winRate = (winningTrades / totalTrades) * 100;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999.0 : 0.0;
    const expectancyUsd = netProfit / totalTrades;
    const recoveryFactor = maxDrawdownUsd > 0 ? netProfit / maxDrawdownUsd : netProfit > 0 ? 999.0 : 0.0;

    // Sharpe & Sortino calculation
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    const downsideVariance = downsideReturns.length > 0
      ? downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downsideReturns.length
      : 0.0001;
    const downsideStdDev = Math.sqrt(downsideVariance);

    const annualFactor = Math.sqrt(252);
    const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * annualFactor : 0.0;
    const sortinoRatio = downsideStdDev > 0 ? (meanReturn / downsideStdDev) * annualFactor : 0.0;

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      winRate: Math.round(winRate * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      grossProfit: Math.round(grossProfit * 100) / 100,
      grossLoss: Math.round(grossLoss * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      maxDrawdownUsd: Math.round(maxDrawdownUsd * 100) / 100,
      maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100,
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      sortinoRatio: Math.round(sortinoRatio * 100) / 100,
      expectancyUsd: Math.round(expectancyUsd * 100) / 100,
      recoveryFactor: Math.round(recoveryFactor * 100) / 100,
      maxConsecutiveLosses,
    };
  }
}
