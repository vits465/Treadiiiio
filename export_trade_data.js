const fs = require('fs');
const Database = require('better-sqlite3');
const db = new Database('./forex_bot.db');

// Helper to escape CSV values
function toCsvRow(arr) {
  return arr.map(v => {
    if (v === null || v === undefined) return '""';
    const str = String(v).replace(/"/g, '""');
    return `"${str}"`;
  }).join(',');
}

// 1. Export Live Closed Trades from SQLite
const liveTrades = db.prepare('SELECT * FROM trades ORDER BY exit_time DESC').all();
let liveCsv = 'id,instrument,action,entry_time,exit_time,entry_price,exit_price,units,pnl_usd,strategy,status,broker_order_id,risk_pct,slippage_pips,latency_ms,exit_reason\n';
for (const t of liveTrades) {
  liveCsv += toCsvRow([
    t.id, t.instrument, t.action, t.entry_time, t.exit_time,
    t.entry_price, t.exit_price, t.units, t.pnl, t.strategy,
    t.status, t.broker_order_id, t.risk_pct, t.slippage_pips,
    t.latency_ms, t.exit_reason || ''
  ]) + '\n';
}
fs.writeFileSync('./trades_live_log.csv', liveCsv);
console.log('✓ Exported trades_live_log.csv (' + liveTrades.length + ' rows)');

// 2. Export Filter Rejections
const rejections = db.prepare('SELECT * FROM filter_rejections ORDER BY timestamp DESC').all();
let rejCsv = 'id,timestamp,filter_name,reason_code,instrument,action,strategy,confidence,details\n';
for (const r of rejections) {
  rejCsv += toCsvRow([
    r.id, r.timestamp, r.filter_name, r.reason_code,
    r.instrument, r.action, r.strategy, r.confidence, r.details
  ]) + '\n';
}
fs.writeFileSync('./filter_rejections_log.csv', rejCsv);
console.log('✓ Exported filter_rejections_log.csv (' + rejections.length + ' rows)');

// 3. Run and Export Comprehensive Backtest Trades for Gold
async function generateBacktestCsv() {
  const { runBacktestEngine } = require('./dist/analytics/backtestEngine');
  
  // Test Gold Alpha with 1000 candles
  const goldAlphaResult = await runBacktestEngine({
    strategyName: 'gold_alpha',
    instrument: 'XAU/USD',
    granularity: '5m',
    candleCount: 1000,
    initialCapital: 50.0,
    lotSize: 0.01,
    slippagePips: 0.5,
  });

  // Test Asian Kill Zone with 1000 candles
  const asianResult = await runBacktestEngine({
    strategyName: 'asian_killzone',
    instrument: 'XAU/USD',
    granularity: '5m',
    candleCount: 1000,
    initialCapital: 50.0,
    lotSize: 0.01,
    slippagePips: 0.5,
  });

  // Test 1m Scalper
  const scalperResult = await runBacktestEngine({
    strategyName: 'scalping_1m',
    instrument: 'XAU/USD',
    granularity: '1m',
    candleCount: 1000,
    initialCapital: 50.0,
    lotSize: 0.01,
    slippagePips: 0.5,
  });

  let btCsv = 'trade_id,strategy,instrument,action,entry_time,exit_time,entry_price,exit_price,lots,pips_captured,pnl_usd,holding_minutes,exit_reason\n';
  
  const allBtTrades = [
    ...goldAlphaResult.tradeHistory.map(t => ({ ...t, strategy: 'gold_alpha', instrument: 'XAU/USD' })),
    ...asianResult.tradeHistory.map(t => ({ ...t, strategy: 'asian_killzone', instrument: 'XAU/USD' })),
    ...scalperResult.tradeHistory.map(t => ({ ...t, strategy: 'scalping_1m', instrument: 'XAU/USD' })),
  ];

  for (const t of allBtTrades) {
    btCsv += toCsvRow([
      t.id, t.strategy, t.instrument, t.action,
      t.entryTime, t.exitTime, t.entryPrice, t.exitPrice,
      t.lots, t.pips, t.pnl, t.holdingMinutes, t.reason
    ]) + '\n';
  }
  fs.writeFileSync('./backtest_gold_trades.csv', btCsv);
  console.log('✓ Exported backtest_gold_trades.csv (' + allBtTrades.length + ' simulated trades)');

  // 4. Create Master Consolidated CSV for Claude
  let masterCsv = 'record_type,id_or_ticket,strategy,instrument,side,entry_timestamp,exit_timestamp,entry_price,exit_price,volume_lots,pips_result,pnl_usd,holding_mins,outcome,filter_reason\n';

  // Add Live Trades
  for (const t of liveTrades) {
    masterCsv += toCsvRow([
      'LIVE_EXECUTION', t.id, t.strategy, t.instrument, t.action,
      t.entry_time, t.exit_time, t.entry_price, t.exit_price,
      (t.units ? (t.units / 100).toFixed(2) : '0.01'),
      '', t.pnl, '', (t.pnl >= 0 ? 'WIN' : 'LOSS'), t.exit_reason || ''
    ]) + '\n';
  }

  // Add Backtest Trades
  for (const t of allBtTrades) {
    masterCsv += toCsvRow([
      'BACKTEST_SIM', t.id, t.strategy, t.instrument, t.action,
      t.entryTime, t.exitTime, t.entryPrice, t.exitPrice,
      t.lots, t.pips, t.pnl, t.holdingMinutes,
      (t.pnl > 0 ? 'WIN' : t.pnl < 0 ? 'LOSS' : 'BREAKEVEN'), t.reason
    ]) + '\n';
  }

  // Add Filter Rejections
  for (const r of rejections) {
    masterCsv += toCsvRow([
      'SIGNAL_REJECTION', r.id, r.strategy, r.instrument, r.action,
      r.timestamp, '', '', '', '', '', '', '',
      'REJECTED', `[${r.filter_name}] ${r.reason_code}: ${r.details || ''}`
    ]) + '\n';
  }

  fs.writeFileSync('./trade_logs_for_claude.csv', masterCsv);
  console.log('✓ Exported master trade_logs_for_claude.csv (Ready for Claude analysis)');
}

generateBacktestCsv().catch(err => {
  console.error('Error generating backtest CSV:', err);
});
