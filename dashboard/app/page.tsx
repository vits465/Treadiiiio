// dashboard/app/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { 
  getSummary, 
  getOpenPositions, 
  getEquityCurve, 
  connectLiveFeed, 
  executeManualTrade,
  closeManualTrade,
  getBotStatus,
  getRiskStatus,
  startBot,
  pauseBot,
  resetBotData,
  Summary, 
  Position, 
  EquitySnapshot,
  LogRecord,
  RiskStatus
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
  Target,
  XCircle,
  Info,
  Power,
  Play,
  Pause
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

import { TradingViewChart } from './components/TradingViewChart';
import { MarketHeatmap } from './components/MarketHeatmap';
import { ProfitProgressRing } from './components/ProfitProgressRing';
import { TradeRationaleModal } from './components/TradeRationaleModal';
import { BotConsoleLogs } from './components/BotConsoleLogs';
import { ForexFactoryCalendar } from './components/ForexFactoryCalendar';
import { AICopilotChat } from './components/AICopilotChat';
import { sounds, sendDesktopNotification } from '../lib/audioNotifier';

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
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [enginePaused, setEnginePaused] = useState<boolean | null>(null);
  const [engineLoading, setEngineLoading] = useState(false);
  const [riskStatus, setRiskStatus] = useState<RiskStatus | null>(null);

  // Trade Rationale Modal State
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);

  const fetchAllData = async () => {
    try {
      const [sumData, posData, eqData, botStatus, riskData] = await Promise.all([
        getSummary(),
        getOpenPositions(),
        getEquityCurve(),
        getBotStatus(),
        getRiskStatus()
      ]);
      setSummary(sumData);
      setPositions(posData);
      setEquityHistory(eqData);
      setEnginePaused(botStatus.paused);
      setRiskStatus(riskData);
    } catch (e) {
      console.error("Failed to fetch dashboard data:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleManualTrade = async (side: 'BUY' | 'SELL') => {
    setTradeLoading(true);
    try {
      await executeManualTrade('XAU/USD', side);
      sounds.playTradeOpened();
      sendDesktopNotification("Trade Executed", `Manual ${side} order placed on XAU/USD`);
      await fetchAllData();
    } catch (e: any) {
      console.error("Manual trade failed", e);
    } finally {
      setTradeLoading(false);
    }
  };

  const handleClosePosition = async (id: string) => {
    try {
      await closeManualTrade(id);
      sounds.playTradeWin();
      await fetchAllData();
    } catch (e) {
      console.error("Close failed", e);
    }
  };

  const toggleEngine = async () => {
    setEngineLoading(true);
    try {
      if (enginePaused) {
        await startBot();
        setEnginePaused(false);
      } else {
        await pauseBot();
        setEnginePaused(true);
      }
    } catch (e) {
      console.error("Toggle engine failed", e);
    } finally {
      setEngineLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
    const pollInterval = setInterval(fetchAllData, 2000);
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
            sounds.playTradeOpened();
            sendDesktopNotification("Position Opened", `${pos.side} ${pos.instrument} @ ${pos.entryPrice}`);
            return [...prev, pos];
          }
        });
      } else if (event.type === 'trade_closed') {
        const trade = event.data;
        if (trade.pnl >= 0) {
          sounds.playTradeWin();
          sendDesktopNotification("Trade Closed (PROFIT)", `Gain: +$${trade.pnl.toFixed(2)} on ${trade.instrument}`);
        } else {
          sounds.playTradeLoss();
          sendDesktopNotification("Trade Closed (LOSS)", `Loss: -$${Math.abs(trade.pnl).toFixed(2)} on ${trade.instrument}`);
        }
        setPositions(prev => prev.filter(p => p.id !== trade.id));
        getSummary().then(setSummary);
      } else if (event.type === 'log_entry') {
        const logRecord = event.data;
        setLogs(prev => [...prev.slice(-150), logRecord]);
      }
    });

    return () => {
      clearInterval(pollInterval);
      disconnect();
    };
  }, []);

  const handleResetData = async () => {
    if (!window.confirm("Are you sure you want to reset all test trade history, equity snapshots, and daily profit targets? This will clear stale test data and start fresh.")) return;
    setLoading(true);
    try {
      await resetBotData();
      await fetchAllData();
      alert("✅ Trading history, equity snapshots & Daily Profit Target reset successfully!");
    } catch (e: any) {
      console.error(e);
      alert("Failed to reset data: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const activeUnrealized = positions.reduce((acc, pos) => acc + pos.unrealizedPnl, 0);
  const latestSnapshot = equityHistory[equityHistory.length - 1];
  const balance = latestSnapshot ? latestSnapshot.balance : 150;
  const equity = balance + activeUnrealized;

  const stats = [
    { name: 'Account Balance', value: `$${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: DollarSign, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
    { name: 'Net Equity', value: `$${equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: Zap, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
    { name: 'Prop Firm Start Balance', value: riskStatus && riskStatus.startOfDayBalance ? `$${riskStatus.startOfDayBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '---', icon: ShieldAlert, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { name: 'Realized PnL', value: `$${summary.totalPnl.toFixed(2)}`, valueColor: summary.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400', icon: summary.totalPnl >= 0 ? TrendingUp : TrendingDown, color: summary.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400', bg: summary.totalPnl >= 0 ? 'bg-emerald-500/10' : 'bg-rose-500/10' },
    { name: 'Max Drawdown', value: `${summary.maxDrawdown.toFixed(2)}%`, icon: ShieldAlert, color: 'text-rose-400', bg: 'bg-rose-500/10' },
    { name: 'Prop Firm Daily DD Used', value: riskStatus ? `$${riskStatus.dailyLossUsed.toFixed(2)} / $${riskStatus.dailyLossLimit.toFixed(2)}` : '---', valueColor: riskStatus && riskStatus.dailyLossUsed >= riskStatus.dailyLossLimit ? 'text-rose-400' : 'text-amber-400', icon: ShieldAlert, color: 'text-rose-400', bg: 'bg-rose-500/10' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row md:items-center justify-between space-y-2 md:space-y-0">
        <div>
          <h2 className="text-4xl font-extrabold tracking-tight premium-gradient-text drop-shadow-md">Command Center</h2>
          <p className="text-slate-400 text-sm font-medium mt-1">Institutional-grade monitoring, live AI predictions, and active equity tracking.</p>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={handleResetData}
            className="px-3 py-2 text-xs font-bold text-rose-400 hover:text-rose-300 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-500/30 rounded-xl transition-all shadow-sm flex items-center space-x-1.5"
            title="Clear old test trade records & reset daily profit target"
          >
            <XCircle className="h-4 w-4" />
            <span>Reset Data & Daily Target</span>
          </button>
          <div className="flex items-center space-x-2 text-xs font-bold text-cyan-400 bg-cyan-950/30 border border-cyan-500/20 px-4 py-2 rounded-xl backdrop-blur-md font-mono">
            <Clock className="h-4 w-4" />
            <span>Sync: {new Date().toLocaleTimeString()}</span>
          </div>
        </div>
      </motion.div>

      {/* Top Stat Cards */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ staggerChildren: 0.1 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4"
      >
        {stats.map((s, idx) => {
          const Icon = s.icon;
          const isLongValue = s.value.length > 14;
          return (
            <motion.div 
              key={idx} 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="relative group cursor-default"
            >
              <div className="glass-panel rounded-2xl p-4 border border-white/[0.05] relative overflow-hidden h-full flex flex-col justify-between hover:neon-border-purple transition-all duration-300">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase truncate max-w-[80%]">{s.name}</span>
                  <div className={`p-2 rounded-xl shrink-0 ${s.bg}`}>
                     <Icon className={`h-4 w-4 ${s.color}`} />
                  </div>
                </div>
                <p className={`font-bold tracking-tight ${isLongValue ? 'text-lg' : 'text-2xl'} ${s.valueColor || 'text-white'} truncate`}>{s.value}</p>
                <div className={`absolute -bottom-6 -right-6 w-24 h-24 ${s.bg} rounded-full blur-2xl opacity-50 group-hover:scale-150 transition-transform duration-500`}></div>
              </div>
            </motion.div>
          );
        })}
      </motion.div>

      {/* Multi-Pair Heatmap & Profit Target Ring */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <MarketHeatmap />
        </div>
        <motion.div whileHover={{ scale: 1.02 }} transition={{ type: "spring", stiffness: 300 }}>
          <ProfitProgressRing currentProfit={summary.totalPnl} targetProfit={riskStatus?.softTargetUsd || 35} />
        </motion.div>
      </div>

      {/* Live TradingView Interactive Chart & Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <TradingViewChart defaultSymbol="OANDA:XAUUSD" />
        </div>

        {/* Live Equity Curve + Manual Override */}
        <div className="space-y-6 flex flex-col justify-between">
          <div className="glass-panel rounded-2xl p-5 border border-white/[0.05] flex-1 flex flex-col justify-between">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">Live Equity Curve</h3>
              <span className="flex h-2 w-2 rounded-full bg-cyan-400 animate-pulse"></span>
            </div>
            <div className="h-44 w-full">
              {equityHistory.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={equityHistory} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.3} vertical={false} />
                    <XAxis dataKey="timestamp" tick={{ fill: '#64748b', fontSize: 9 }} tickLine={false} axisLine={false} hide />
                    <YAxis domain={['auto', 'auto']} tick={{ fill: '#64748b', fontSize: 9 }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', fontSize: '11px' }} />
                    <Area type="monotone" dataKey="equity" stroke="#06b6d4" strokeWidth={2} fillOpacity={1} fill="url(#colorEquity)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-500 text-xs font-mono">
                  Awaiting ticks...
                </div>
              )}
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-5 border border-white/[0.05]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono flex items-center gap-1.5">
                <Target className="h-4 w-4 text-amber-400" />
                Manual MT5 Order
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button 
                disabled={tradeLoading}
                onClick={() => handleManualTrade('BUY')}
                className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold tracking-wider uppercase text-xs py-2.5 rounded-xl transition-all flex items-center justify-center space-x-1 font-mono disabled:opacity-50"
              >
                <TrendingUp className="h-3.5 w-3.5" />
                <span>Force Buy</span>
              </button>
              <button 
                disabled={tradeLoading}
                onClick={() => handleManualTrade('SELL')}
                className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 font-bold tracking-wider uppercase text-xs py-2.5 rounded-xl transition-all flex items-center justify-center space-x-1 font-mono disabled:opacity-50"
              >
                <TrendingDown className="h-3.5 w-3.5" />
                <span>Force Sell</span>
              </button>
            </div>
            
            <div className="mt-4 pt-4 border-t border-white/[0.05]">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono flex items-center gap-1.5">
                  <Power className="h-4 w-4 text-cyan-400" />
                  Engine Control
                </h3>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${enginePaused ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                  {enginePaused === null ? '...' : (enginePaused ? 'PAUSED' : 'RUNNING')}
                </span>
              </div>
              <button
                disabled={engineLoading || enginePaused === null}
                onClick={toggleEngine}
                className={`w-full font-bold tracking-wider uppercase text-xs py-2.5 rounded-xl transition-all flex items-center justify-center space-x-1 font-mono disabled:opacity-50 ${
                  enginePaused 
                    ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30'
                }`}
              >
                {enginePaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                <span>{enginePaused ? 'Start Engine' : 'Pause Engine'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Active Positions Table */}
      <div className="glass-panel rounded-3xl p-6 border border-white/[0.05] flex flex-col space-y-6">
        <div>
          <h3 className="text-lg font-bold text-white">Active Positions <span className="text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-md text-sm ml-2 font-mono">{positions.length}</span></h3>
        </div>
        
        {positions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse font-mono">
              <thead>
                <tr className="border-b border-white/[0.05] text-slate-500 font-bold text-[10px] tracking-widest uppercase">
                  <th className="pb-4 pl-4">Asset</th>
                  <th className="pb-4">Side</th>
                  <th className="pb-4">Source AI</th>
                  <th className="pb-4 text-right">Entry</th>
                  <th className="pb-4 text-right">Market</th>
                  <th className="pb-4 text-right">Lots</th>
                  <th className="pb-4 text-right">Floating PnL</th>
                  <th className="pb-4 text-center">Rationale</th>
                  <th className="pb-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.02]">
                {positions.map((pos) => (
                  <tr key={pos.id} className="group hover:bg-white/[0.02] transition-colors">
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
                    <td className="py-4 text-right text-slate-300">{pos.entryPrice.toFixed(2)}</td>
                    <td className="py-4 text-right text-slate-300">{pos.currentPrice.toFixed(2)}</td>
                    <td className="py-4 text-right text-slate-400">{(pos.units / 100000).toFixed(2)}</td>
                    <td className={`py-4 text-right font-bold ${pos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {pos.unrealizedPnl >= 0 ? '+' : ''}${pos.unrealizedPnl.toFixed(2)}
                    </td>
                    <td className="py-4 text-center">
                      <button 
                        onClick={() => setSelectedPosition(pos)}
                        className="text-indigo-400/80 hover:text-indigo-300 hover:bg-indigo-500/10 p-2 rounded-xl transition-all"
                        title="View Trade Rationale"
                      >
                        <Info className="h-4 w-4" />
                      </button>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 space-y-3 border border-dashed border-white/[0.05] rounded-2xl bg-white/[0.01]">
            <ShieldAlert className="h-10 w-10 text-slate-700" />
            <p className="text-slate-400 text-sm font-bold tracking-wide">No active exposure.</p>
            <p className="text-slate-600 text-[10px] font-semibold uppercase tracking-widest font-mono">Algorithms are scanning market indicators.</p>
          </div>
        )}
      </div>

      {/* ForexFactory Economic Calendar & News */}
      <ForexFactoryCalendar />

      {/* Live Bot Engine Console Logs Terminal */}
      <BotConsoleLogs logs={logs} />

      {/* Trade Rationale Modal */}
      <TradeRationaleModal item={selectedPosition} onClose={() => setSelectedPosition(null)} />

      {/* AI Strategy Copilot Chatbot */}
      <AICopilotChat />
    </div>
  );
}
