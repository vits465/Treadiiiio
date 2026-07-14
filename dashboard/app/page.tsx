'use client';

import React, { useState, useEffect } from 'react';
import { 
  getSummary, 
  getOpenPositions, 
  getEquityCurve, 
  connectLiveFeed, 
  executeManualTrade,
  closeManualTrade,
  Summary, 
  Position, 
  EquitySnapshot 
} from '../lib/api-client';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  ShieldAlert, 
  Percent, 
  Clock, 
  Award,
  Zap,
  Activity,
  Target,
  XCircle
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid 
} from 'recharts';
import { motion } from 'framer-motion';

export default function OverviewPage() {
  const [summary, setSummary] = useState<Summary>({
    totalPnl: 0,
    winRate: 0,
    maxDrawdown: 0,
    sharpeApprox: 0,
    bySource: {}
  });
  const [positions, setPositions] = useState<Position[]>([]);
  const [equityHistory, setEquityHistory] = useState<EquitySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [tradeLoading, setTradeLoading] = useState(false);

  const fetchAllData = async () => {
    try {
      const [sumData, posData, eqData] = await Promise.all([
        getSummary(),
        getOpenPositions(),
        getEquityCurve()
      ]);
      setSummary(sumData);
      setPositions(posData);
      setEquityHistory(eqData);
    } catch (e) {
      console.error("Failed to fetch dashboard data:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleManualTrade = async (side: 'BUY' | 'SELL') => {
    setTradeLoading(true);
    try {
      await executeManualTrade('EUR_USD', side, 10000);
      await fetchAllData();
    } catch (e) {
      console.error("Manual trade failed", e);
    } finally {
      setTradeLoading(false);
    }
  };

  const handleClosePosition = async (id: string) => {
    try {
      await closeManualTrade(id);
      await fetchAllData();
    } catch (e) {
      console.error("Close failed", e);
    }
  };

  useEffect(() => {
    fetchAllData();
    const disconnect = connectLiveFeed((event) => {
      if (event.type === 'equity_tick') {
        const tick = event.data;
        setEquityHistory(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.timestamp === tick.timestamp) {
            updated[updated.length - 1] = tick;
          } else {
            updated.push(tick);
          }
          return updated.slice(-100);
        });
      } else if (event.type === 'position_update') {
        const pos = event.data;
        setPositions(prev => {
          const idx = prev.findIndex(p => p.id === pos.id);
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = pos;
            return updated;
          } else {
            return [...prev, pos];
          }
        });
      } else if (event.type === 'trade_closed') {
        const trade = event.data;
        setPositions(prev => prev.filter(p => p.id !== trade.id));
        getSummary().then(setSummary);
      }
    });

    return () => {
      disconnect();
    };
  }, []);

  if (false) {
    return null;
  }

  const activeUnrealized = positions.reduce((acc, pos) => acc + pos.unrealizedPnl, 0);
  const latestSnapshot = equityHistory[equityHistory.length - 1];
  const balance = latestSnapshot ? latestSnapshot.balance : 5000;
  const equity = balance + activeUnrealized;

  const stats = [
    { name: 'Account Balance', value: `$${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: DollarSign, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
    { name: 'Net Equity', value: `$${equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: Zap, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
    { name: 'Realized PnL', value: `$${summary.totalPnl.toFixed(2)}`, valueColor: summary.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400', icon: summary.totalPnl >= 0 ? TrendingUp : TrendingDown, color: summary.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400', bg: summary.totalPnl >= 0 ? 'bg-emerald-500/10' : 'bg-rose-500/10' },
    { name: 'Win Rate', value: `${(summary.winRate * 100).toFixed(1)}%`, icon: Percent, color: 'text-amber-400', bg: 'bg-amber-500/10' },
    { name: 'Max Drawdown', value: `${summary.maxDrawdown.toFixed(2)}%`, icon: ShieldAlert, color: 'text-rose-400', bg: 'bg-rose-500/10' },
    { name: 'Sharpe Ratio', value: summary.sharpeApprox.toFixed(2), icon: Award, color: 'text-purple-400', bg: 'bg-purple-500/10' },
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { duration: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0, transition: { duration: 0.15 } }
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row md:items-center justify-between space-y-2 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Command Center</h2>
          <p className="text-slate-400 text-sm font-medium mt-1">Real-time metrics, live positions, and dynamic equity tracing.</p>
        </div>
        <div className="flex items-center space-x-2 text-xs font-bold text-cyan-400 bg-cyan-950/30 border border-cyan-500/20 px-4 py-2 rounded-xl backdrop-blur-md">
          <Clock className="h-4 w-4" />
          <span>Sync: {new Date().toLocaleTimeString()}</span>
        </div>
      </motion.div>

      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4"
      >
        {stats.map((s, idx) => {
          const Icon = s.icon;
          return (
            <motion.div key={idx} variants={itemVariants} className="relative group cursor-default">
              <div className="absolute inset-0 bg-gradient-to-br from-white/[0.05] to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              <div className="glass-panel rounded-2xl p-5 border border-white/[0.05] relative overflow-hidden h-full">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[10px] font-bold text-slate-400 tracking-widest uppercase">{s.name}</span>
                  <div className={`p-2 rounded-xl ${s.bg}`}>
                     <Icon className={`h-4 w-4 ${s.color}`} />
                  </div>
                </div>
                <p className={`text-2xl font-bold tracking-tight ${s.valueColor || 'text-white'}`}>{s.value}</p>
                <div className={`absolute -bottom-6 -right-6 w-24 h-24 ${s.bg} rounded-full blur-2xl opacity-50`}></div>
              </div>
            </motion.div>
          );
        })}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 }}
          className="lg:col-span-2 glass-panel rounded-3xl p-6 border border-white/[0.05] flex flex-col space-y-6"
        >
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-bold text-white">Live Equity Curve</h3>
              <p className="text-xs text-slate-500 font-medium">Tracking balance and floating PnL dynamically.</p>
            </div>
            <div className="flex items-center space-x-2">
              <span className="flex h-2 w-2 rounded-full bg-cyan-400"></span>
              <span className="text-xs text-slate-400 font-medium">Net Equity</span>
            </div>
          </div>
          <div className="h-80 w-full">
            {equityHistory.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityHistory} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.3} vertical={false} />
                  <XAxis 
                    dataKey="timestamp" 
                    tick={{ fill: '#64748b', fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => {
                      try {
                        return new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      } catch {
                        return val;
                      }
                    }}
                    dy={10}
                  />
                  <YAxis 
                    domain={['auto', 'auto']}
                    tick={{ fill: '#64748b', fontSize: 10, fontWeight: 600 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => `$${Math.round(val)}`}
                    dx={-10}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px', color: '#f8fafc', fontSize: '12px', backdropFilter: 'blur(8px)', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)' }}
                    formatter={(val: any) => [`$${parseFloat(val).toFixed(2)}`, 'Equity']}
                    labelFormatter={(lbl) => `Time: ${new Date(lbl).toLocaleString()}`}
                  />
                  <Area type="monotone" dataKey="equity" stroke="#06b6d4" strokeWidth={3} fillOpacity={1} fill="url(#colorEquity)" animationDuration={1000} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-slate-500 text-sm font-semibold animate-pulse">Awaiting market ticks...</p>
              </div>
            )}
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5 }}
          className="space-y-6"
        >
          <div className="glass-panel rounded-3xl p-6 border border-white/[0.05] relative overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Target className="h-5 w-5 text-amber-400" />
                Manual Override
              </h3>
            </div>
            <p className="text-xs text-slate-400 mb-4 font-medium">Bypass the algorithm and force a market order instantly.</p>
            
            <div className="grid grid-cols-2 gap-3">
              <button 
                disabled={tradeLoading}
                onClick={() => handleManualTrade('BUY')}
                className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 font-bold tracking-wider uppercase text-xs py-3 rounded-xl transition-colors flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                <TrendingUp className="h-4 w-4" />
                <span>Force Buy</span>
              </button>
              <button 
                disabled={tradeLoading}
                onClick={() => handleManualTrade('SELL')}
                className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 font-bold tracking-wider uppercase text-xs py-3 rounded-xl transition-colors flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                <TrendingDown className="h-4 w-4" />
                <span>Force Sell</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="glass-panel rounded-3xl p-6 border border-white/[0.05] flex flex-col space-y-6"
      >
        <div>
          <h3 className="text-lg font-bold text-white">Active Positions <span className="text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-md text-sm ml-2">{positions.length}</span></h3>
        </div>
        
        {positions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-white/[0.05] text-slate-500 font-bold text-[10px] tracking-widest uppercase">
                  <th className="pb-4 pl-4">Asset</th>
                  <th className="pb-4">Side</th>
                  <th className="pb-4">Source AI</th>
                  <th className="pb-4 text-right">Entry</th>
                  <th className="pb-4 text-right">Market</th>
                  <th className="pb-4 text-right">Lots</th>
                  <th className="pb-4 text-right">Floating PnL</th>
                  <th className="pb-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.02]">
                {positions.map((pos) => (
                  <motion.tr 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    key={pos.id} 
                    className="group hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-4 pl-4 font-bold text-white">{pos.instrument.replace('_', '/')}</td>
                    <td className="py-4">
                      <span className={`px-3 py-1 rounded-lg text-[10px] font-bold tracking-wider ${
                        pos.side === 'LONG' 
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}>
                        {pos.side}
                      </span>
                    </td>
                    <td className="py-4 text-slate-400 font-medium text-xs">{pos.source.toUpperCase()}</td>
                    <td className="py-4 text-right font-mono text-slate-300">{pos.entryPrice.toFixed(pos.instrument.includes('JPY') ? 3 : 5)}</td>
                    <td className="py-4 text-right font-mono text-slate-300">{pos.currentPrice.toFixed(pos.instrument.includes('JPY') ? 3 : 5)}</td>
                    <td className="py-4 text-right font-mono text-slate-400">{(pos.units / 100000).toFixed(2)}</td>
                    <td className={`py-4 text-right font-mono font-bold ${pos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {pos.unrealizedPnl >= 0 ? '+' : ''}${pos.unrealizedPnl.toFixed(2)}
                    </td>
                    <td className="py-4 text-center">
                      <button 
                        onClick={() => handleClosePosition(pos.id)}
                        className="text-rose-400/50 hover:text-rose-400 hover:bg-rose-500/10 p-2 rounded-xl transition-all"
                        title="Close Position"
                      >
                        <XCircle className="h-5 w-5" />
                      </button>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 space-y-3 border border-dashed border-white/[0.05] rounded-2xl bg-white/[0.01]">
            <ShieldAlert className="h-10 w-10 text-slate-700" />
            <p className="text-slate-400 text-sm font-bold tracking-wide">No active exposure.</p>
            <p className="text-slate-600 text-[10px] font-semibold uppercase tracking-widest">Algorithms are seeking entry signals.</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
