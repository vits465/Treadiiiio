'use client';

import React, { useState } from 'react';
import { Play, RotateCcw, Activity, ShieldAlert, DollarSign } from 'lucide-react';
import { motion } from 'framer-motion';

export default function BacktestPage() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<any>(null);

  const runBacktest = async () => {
    setRunning(true);
    setResults(null);
    try {
      // We trigger the backtest script in the backend
      // Since it's a CLI script in the codebase, we'll simulate an API response for the UI demonstration
      await new Promise(r => setTimeout(r, 2000));
      
      setResults({
        totalTrades: 124,
        winRate: 58.2,
        totalPnL: 845.50,
        maxDrawdown: 4.2,
        sharpeRatio: 1.45,
      });
    } catch (e) {
      console.error(e);
    } finally {
      setRunning(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between space-y-2 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Backtesting Engine</h2>
          <p className="text-slate-500 text-sm font-medium">Test strategies against historical MT5 data.</p>
        </div>
      </div>

      <div className="glass-panel p-6 rounded-2xl border border-[#1e293b]">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400">Strategy</label>
            <select className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-white outline-none focus:border-cyan-500 transition-colors">
              <option>MA Crossover (3, 8)</option>
              <option>RSI Mean Reversion</option>
              <option>Bollinger Bands</option>
              <option>ML Ensemble</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400">Instrument</label>
            <select className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-white outline-none focus:border-cyan-500 transition-colors">
              <option>EUR/USD</option>
              <option>GBP/USD</option>
              <option>USD/JPY</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400">Timeframe</label>
            <select className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-white outline-none focus:border-cyan-500 transition-colors">
              <option>1 Hour</option>
              <option>15 Minutes</option>
              <option>Daily</option>
            </select>
          </div>
          <div className="flex items-end">
            <button 
              onClick={runBacktest}
              disabled={running}
              className="w-full bg-cyan-500 hover:bg-cyan-400 text-[#060911] font-bold py-2 px-4 rounded-lg flex items-center justify-center space-x-2 transition-all disabled:opacity-50"
            >
              {running ? <RotateCcw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              <span>{running ? 'Running...' : 'Start Backtest'}</span>
            </button>
          </div>
        </div>
      </div>

      {results && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="grid grid-cols-1 md:grid-cols-4 gap-4"
        >
          <div className="glass-panel p-5 rounded-xl border border-cyan-500/20 bg-cyan-500/5">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total PnL</span>
              <DollarSign className="h-4 w-4 text-emerald-400" />
            </div>
            <p className="text-2xl font-bold text-emerald-400">+${results.totalPnL}</p>
          </div>
          <div className="glass-panel p-5 rounded-xl border border-[#1e293b]">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Win Rate</span>
              <Activity className="h-4 w-4 text-cyan-400" />
            </div>
            <p className="text-2xl font-bold text-white">{results.winRate}%</p>
          </div>
          <div className="glass-panel p-5 rounded-xl border border-[#1e293b]">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Trades</span>
              <RotateCcw className="h-4 w-4 text-purple-400" />
            </div>
            <p className="text-2xl font-bold text-white">{results.totalTrades}</p>
          </div>
          <div className="glass-panel p-5 rounded-xl border border-[#1e293b]">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Max Drawdown</span>
              <ShieldAlert className="h-4 w-4 text-rose-400" />
            </div>
            <p className="text-2xl font-bold text-rose-400">{results.maxDrawdown}%</p>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
