'use client';

import React, { useState, useEffect } from 'react';
import { getTrades, Trade, connectLiveFeed } from '../../lib/api-client';
import { 
  TrendingUp, 
  TrendingDown, 
  Search, 
  Download, 
  Filter, 
  ArrowUpDown,
  Calendar
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function TradesPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filtering states
  const [strategyFilter, setStrategyFilter] = useState('');
  const [instrumentFilter, setInstrumentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState(''); // 'win' | 'loss' | ''
  const [sortField, setSortField] = useState<keyof Trade>('openedAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const fetchTradeHistory = async () => {
    try {
      const data = await getTrades();
      setTrades(data.trades);
    } catch (e) {
      console.error("Failed to load trades:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTradeHistory();

    const disconnect = connectLiveFeed((event) => {
      if (event.type === 'trade_closed') {
        fetchTradeHistory();
      }
    });

    return () => {
      disconnect();
    };
  }, []);

  const handleSort = (field: keyof Trade) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const filteredTrades = trades
    .filter(t => {
      const matchStrat = strategyFilter === '' || t.source === strategyFilter;
      const matchInst = instrumentFilter === '' || t.instrument === instrumentFilter;
      let matchStatus = true;
      if (statusFilter === 'win') matchStatus = t.pnl > 0;
      else if (statusFilter === 'loss') matchStatus = t.pnl < 0;
      return matchStrat && matchInst && matchStatus;
    })
    .sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];
      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortDirection === 'asc' 
          ? valA.localeCompare(valB) 
          : valB.localeCompare(valA);
      }
      valA = valA as number;
      valB = valB as number;
      return sortDirection === 'asc' ? valA - valB : valB - valA;
    });

  const exportToCSV = () => {
    if (filteredTrades.length === 0) return;
    const headers = ["ID", "Instrument", "Side", "Entry Price", "Exit Price", "PnL ($)", "Opened At", "Closed At", "Source Strategy"];
    const rows = filteredTrades.map(t => [
      t.id, t.instrument, t.side, t.entryPrice, t.exitPrice, t.pnl.toFixed(2), t.openedAt, t.closedAt, t.source
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `forex_bot_trades_${new Date().toISOString().substring(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const uniqueInstruments = Array.from(new Set(trades.map(t => t.instrument)));
  const uniqueStrategies = Array.from(new Set(trades.map(t => t.source)));

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Execution Logs</h2>
          <p className="text-slate-400 text-sm font-medium mt-1">Audit trail of completed orders, execution prices, and realized metrics.</p>
        </div>
        <button
          onClick={exportToCSV}
          disabled={filteredTrades.length === 0}
          className="flex items-center space-x-2 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-40 text-cyan-400 font-bold px-5 py-2.5 rounded-xl border border-cyan-500/20 transition-all text-sm"
        >
          <Download className="h-4 w-4" />
          <span>Export to CSV</span>
        </button>
      </div>

      {/* Filter Options */}
      <div className="glass-panel rounded-2xl p-6 border border-white/[0.05] grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Strategy Filter */}
        <div className="flex flex-col space-y-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Algorithm Core</label>
          <div className="relative group">
            <select
              value={strategyFilter}
              onChange={(e) => setStrategyFilter(e.target.value)}
              className="w-full bg-white/[0.02] hover:bg-white/[0.04] transition-colors border border-white/[0.05] rounded-xl px-4 py-2.5 text-sm font-medium text-white outline-none appearance-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
            >
              <option value="" className="bg-slate-900">All Algorithms</option>
              {uniqueStrategies.map(s => (
                <option key={s} value={s} className="bg-slate-900">{s.toUpperCase()}</option>
              ))}
            </select>
            <Filter className="absolute right-3 top-3 h-4 w-4 text-slate-500 group-hover:text-cyan-400 transition-colors pointer-events-none" />
          </div>
        </div>

        {/* Instrument Filter */}
        <div className="flex flex-col space-y-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Asset Pair</label>
          <div className="relative group">
            <select
              value={instrumentFilter}
              onChange={(e) => setInstrumentFilter(e.target.value)}
              className="w-full bg-white/[0.02] hover:bg-white/[0.04] transition-colors border border-white/[0.05] rounded-xl px-4 py-2.5 text-sm font-medium text-white outline-none appearance-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
            >
              <option value="" className="bg-slate-900">All Assets</option>
              {uniqueInstruments.map(inst => (
                <option key={inst} value={inst} className="bg-slate-900">{inst.replace('_', '/')}</option>
              ))}
            </select>
            <Search className="absolute right-3 top-3 h-4 w-4 text-slate-500 group-hover:text-cyan-400 transition-colors pointer-events-none" />
          </div>
        </div>

        {/* Outcome Filter */}
        <div className="flex flex-col space-y-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Profit State</label>
          <div className="relative group">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full bg-white/[0.02] hover:bg-white/[0.04] transition-colors border border-white/[0.05] rounded-xl px-4 py-2.5 text-sm font-medium text-white outline-none appearance-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
            >
              <option value="" className="bg-slate-900">All Trades</option>
              <option value="win" className="bg-slate-900">Profit Achieved</option>
              <option value="loss" className="bg-slate-900">Loss Realized</option>
            </select>
            <Filter className="absolute right-3 top-3 h-4 w-4 text-slate-500 group-hover:text-cyan-400 transition-colors pointer-events-none" />
          </div>
        </div>

        {/* Total Summary Stat */}
        <div className="flex flex-col justify-end items-end">
          <div className="text-right glass-panel px-4 py-2 rounded-xl border border-white/[0.05]">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Matches</span>
            <p className="text-xl font-black text-cyan-400">{filteredTrades.length} <span className="text-slate-500 text-sm">/ {trades.length}</span></p>
          </div>
        </div>
      </div>

      {/* Main Trade Logs Table */}
      <div className="glass-panel rounded-3xl p-6 border border-white/[0.05]">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-cyan-400"></div>
          </div>
        ) : filteredTrades.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-white/[0.05] text-slate-500 font-bold text-[10px] tracking-widest uppercase">
                  <th className="pb-4 pl-4 cursor-pointer hover:text-cyan-400 transition-colors" onClick={() => handleSort('instrument')}>
                    <span className="flex items-center space-x-1">
                      <span>Asset</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="pb-4 cursor-pointer hover:text-cyan-400 transition-colors" onClick={() => handleSort('side')}>
                    <span className="flex items-center space-x-1">
                      <span>Side</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="pb-4 cursor-pointer hover:text-cyan-400 transition-colors" onClick={() => handleSort('source')}>
                    <span className="flex items-center space-x-1">
                      <span>Algorithm</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="pb-4 text-right cursor-pointer hover:text-cyan-400 transition-colors" onClick={() => handleSort('entryPrice')}>
                    <span className="flex items-center justify-end space-x-1">
                      <span>Entry</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="pb-4 text-right cursor-pointer hover:text-cyan-400 transition-colors" onClick={() => handleSort('exitPrice')}>
                    <span className="flex items-center justify-end space-x-1">
                      <span>Exit</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="pb-4 text-right cursor-pointer hover:text-cyan-400 transition-colors" onClick={() => handleSort('pnl')}>
                    <span className="flex items-center justify-end space-x-1">
                      <span>Realized PnL</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                  <th className="pb-4 pr-4 text-right cursor-pointer hover:text-cyan-400 transition-colors" onClick={() => handleSort('openedAt')}>
                    <span className="flex items-center justify-end space-x-1">
                      <span>Trigger Time</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.02]">
                  {filteredTrades.map((t) => (
                    <tr 
                      key={t.id} 
                      className="hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="py-4 pl-4 font-bold text-white">{t.instrument.replace('_', '/')}</td>
                      <td className="py-4">
                        <span className={`px-3 py-1 rounded-lg text-[10px] font-bold tracking-wider ${
                          t.side === 'LONG' 
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}>
                          {t.side}
                        </span>
                      </td>
                      <td className="py-4 text-slate-400 font-medium text-xs">{t.source.toUpperCase()}</td>
                      <td className="py-4 text-right font-mono text-slate-300">{t.entryPrice.toFixed(t.instrument.includes('JPY') ? 3 : 5)}</td>
                      <td className="py-4 text-right font-mono text-slate-300">{t.exitPrice.toFixed(t.instrument.includes('JPY') ? 3 : 5)}</td>
                      <td className={`py-4 text-right font-mono font-bold ${t.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                      </td>
                      <td className="py-4 pr-4 text-right text-slate-500 text-xs font-medium">
                        <div className="flex items-center justify-end space-x-1.5">
                          <Calendar className="h-3 w-3" />
                          <span>{new Date(t.openedAt).toLocaleDateString()} {new Date(t.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <TrendingDown className="h-10 w-10 text-slate-700" />
            <p className="text-slate-400 text-sm font-bold tracking-wide">No trades found.</p>
            <p className="text-slate-600 text-[10px] font-semibold uppercase tracking-widest">Adjust your filters to see more results.</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
