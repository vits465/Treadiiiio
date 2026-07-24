import { runMonteCarlo } from './src/analytics/backtestEngine';

async function main() {
  console.log('Running Monte Carlo Backtest (100 simulations)...');
  console.log('Target: $150 balance, Aggressive Config');
  
  const result = await runMonteCarlo({
    strategyName: 'ml_signal',
    instrument: 'EUR/USD',
    granularity: '5m',
    candleCount: 500,
    slippagePips: 1.5,
    commissionUsdPerLot: 3.0
  }, 10);

  console.log('\n--- BACKTEST RESULTS ---');
  console.log(`Median Return: ${result.medianReturnPct.toFixed(2)}%`);
  console.log(`Worst Case Return: ${result.worstCaseReturnPct.toFixed(2)}%`);
  console.log(`Best Case Return: ${result.bestCaseReturnPct.toFixed(2)}%`);
  console.log(`Probability of Profit: ${result.probabilityOfProfit.toFixed(2)}%`);
  console.log(`Median Max Drawdown: ${result.medianMaxDrawdown.toFixed(2)}%`);
  console.log('------------------------\n');
}

main().catch(console.error);
