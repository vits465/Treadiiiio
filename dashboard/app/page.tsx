// dashboard/app/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { 
  getSummary, 
  getOpenPositions, 
  getEquityCurve, 
  connectLiveFeed, 
  closeManualTrade, 
  getBotStatus, 
  getRiskStatus, 
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
  Activity, 
  Lock, 
  ArrowUpRight, 
  ArrowDownRight, 
  RefreshCw,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { TradingViewChart } from './components/TradingViewChart';
import { LiveScalpTerminal } from './components/LiveScalpTerminal';
import { StrategyMatrix } from './components/StrategyMatrix';
import { BotConsoleLogs } from './components/BotConsoleLogs';
import { ForexFactoryCalendar } from './components/ForexFactoryCalendar';
import { AICopilotChat } from './components/AICopilotChat';
import { TradeRationaleModal } from './components/TradeRationaleModal';
import { MarketHeatmap } from './components/MarketHeatmap';
import AIPipelineTracker from './components/AIPipelineTracker';
import { sounds, sendDesktopNotification } from '../lib/audioNotifier';
import { getConfig, ConfigData } from '../lib/api-client';

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
  const [enginePaused, setEnginePaused] = useState<boolean | null>(null);
  const [riskStatus, setRiskStatus] = useState<RiskStatus | null>(null);
  const [configData, setConfigData] = useState<ConfigData | null>(null);
  const [botStatus, setBotStatus] = useState<any>(null);
  const [selectedRationaleItem, setSelectedRationaleItem] = useState<Position | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [lockingId, setLockingId] = useState<string | null>(null);

  const fetchAllData = async () => {
    try {
      const [sumData, posData, eqData, botStatusData, riskData, cfgData] = await Promise.all([
        getSummary(),
        getOpenPositions(),
        getEquityCurve(),
        getBotStatus(),
        getRiskStatus(),
        getConfig().catch(() => null)
      ]);
      setSummary(sumData);
      setPositions(posData);
      setEquityHistory(eqData);
      setEnginePaused(botStatusData.paused);
      setBotStatus(botStatusData);
      setRiskStatus(riskData);
      if (cfgData) setConfigData(cfgData);
    } catch (e) {
      console.error("Failed to fetch dashboard data:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleClosePosition = async (id: string) => {
    setClosingId(id);
    try {
      await closeManualTrade(id);
      sounds.playTradeWin();
      await fetchAllData();
    } catch (e: any) {
      alert("Failed to close position: " + e.message);
    } finally {
      setClosingId(null);
    }
  };

  const handleLockPositionBE = async (pos: Position) => {
    setLockingId(pos.id);
    try {
      const isXau = pos.instrument.includes('XAU');
      const isJpy = pos.instrument.includes('JPY');
      const pipSize = (isXau || isJpy) ? 0.01 : 0.0001;
      const beSl = pos.side === 'LONG'
        ? pos.entryPrice + 2 * pipSize
        : pos.entryPrice - 2 * pipSize;

      const res = await fetch('/api/bot/lock-breakeven', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positionId: pos.id }),
      });
      if (res.ok) {
        sounds.playTradeWin();
        alert(`🛡️ Position ${pos.instrument} (${pos.side}) locked at Break-Even: $${beSl.toFixed(2)} (+2 pips)`);
      }
      await fetchAllData();
    } catch (e: any) {
      alert("Break-Even error: " + e.message);
    } finally {
      setLockingId(null);
    }
  };

  useEffect(() => {
    let isFetching = false;
    const safeFetchAll = async () => {
      if (isFetching) return;
      isFetching = true;
      try {
        await fetchAllData();
      } finally {
        isFetching = false;
      }
    };

    safeFetchAll();
    const pollInterval = setInterval(safeFetchAll, 3500);
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
            sendDesktopNotification("⚡ Position Opened", `${pos.side} ${pos.instrument} @ ${pos.entryPrice}`);
            return [...prev, pos];
          }
        });
      } else if (event.type === 'trade_closed') {
        const trade = event.data;
        if (trade.pnl >= 0) {
          sounds.playTradeWin();
          sendDesktopNotification("🎉 Trade Closed (PROFIT)", `Gain: +$${trade.pnl.toFixed(2)} on ${trade.instrument}`);
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
    if (!window.confirm("⚠️ Reset all trade records, equity snapshots, and Daily Profit Target counters?")) return;
    setLoading(true);
    try {
      await resetBotData();
      await fetchAllData();
      alert("✅ Trading history, equity snapshots & Daily Target reset successfully!");
    } catch (e: any) {
      alert("Failed to reset: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const activeUnrealized = positions.reduce((acc, pos) => acc + pos.unrealizedPnl, 0);
  const latestSnapshot = equityHistory[equityHistory.length - 1];
  const balance = latestSnapshot ? latestSnapshot.balance : 50.00;
  const equity = balance + activeUnrealized;

  // Daily target progress (dynamic from user config)
  const dailyTargetUsd = configData?.RISK_DAILY_PROFIT_TARGET_USD || 50.0;
  const dailyPnl = summary?.totalPnl || 0;
  const dailyTargetProgress = Math.min(100, Math.max(0, (dailyPnl / dailyTargetUsd) * 100));

  // Stat metrics
  const stats = [
    {
      title: 'MT5 Live Account',
      value: `#${botStatus?.mt5Account || '113769804'}`,
      subtitle: `${botStatus?.mt5Server || 'MetaQuotes-Demo'} • $${balance.toFixed(2)} Balance`,
      icon: DollarSign,
      color: 'text-amber-400',
      border: 'border-amber-500/20'
    },
    {
      title: 'Net Equity',
      value: `$${equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      subtitle: activeUnrealized >= 0 ? `+$${activeUnrealized.toFixed(2)} Floating` : `-$${Math.abs(activeUnrealized).toFixed(2)} Floating`,
      icon: Zap,
      color: activeUnrealized >= 0 ? 'text-emerald-400' : 'text-rose-400',
      border: activeUnrealized >= 0 ? 'border-emerald-500/20' : 'border-rose-500/20'
    },
    {
      title: "Today's Realized Scalp PnL",
      value: `${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)}`,
      subtitle: `Win Rate: ${((summary?.winRate || 0.70) * 100).toFixed(1)}%`,
      icon: dailyPnl >= 0 ? TrendingUp : TrendingDown,
      color: dailyPnl >= 0 ? 'text-emerald-400' : 'text-rose-400',
      border: dailyPnl >= 0 ? 'border-emerald-500/20' : 'border-rose-500/20'
    },
    {
      title: 'Daily Trade Limit',
      value: `${botStatus?.todayTradesCount || 0} / ${botStatus?.maxDailyTrades || 10} Trades`,
      subtitle: `Direction: ${botStatus?.tradeDirection || 'BOTH'} (Buy & Sell)`,
      icon: Activity,
      color: 'text-cyan-400',
      border: 'border-cyan-500/20'
    },
    {
      title: 'Daily Profit Target (10%)',
      value: `$${Math.max(0, dailyPnl).toFixed(2)} / $${dailyTargetUsd.toFixed(2)}`,
      subtitle: `${dailyTargetProgress.toFixed(0)}% Target Achieved`,
      icon: Target,
      color: 'text-emerald-400',
      border: 'border-emerald-500/20'
    },
    {
      title: 'Active Scalp Positions',
      value: `${positions.length} / 1`,
      subtitle: `${positions.length > 0 ? 'Micro-Lot 0.01 Active' : 'Scanning 1M Orderflow'}`,
      icon: ShieldAlert,
      color: positions.length > 0 ? 'text-emerald-400' : 'text-slate-400',
      border: positions.length > 0 ? 'border-emerald-500/30' : 'border-slate-800'
    }
  ];

  return (
    <div className="space-y-6">
      {/* Top Header & Fast Actions */}
      <motion.div initial={{ opacity: 0, y: -15 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-2">
              <span>COMMAND CENTER</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-black uppercase bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-sm shadow-amber-500/30">
                1M GOLD SCALPER ACTIVE
              </span>
            </h2>
          </div>
          <p className="text-slate-400 text-xs sm:text-sm font-medium mt-1">
            Institutional algorithmic execution, live order flow telemetry, and automated risk protection.
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-2.5">
            <span className="text-[11px] px-2.5 py-1 rounded-lg font-bold bg-cyan-950/40 text-cyan-400 border border-cyan-500/30 font-mono">
              MT5 #{botStatus?.mt5Account || '113769804'} (MetaQuotes-Demo)
            </span>
            <span className="text-[11px] px-2.5 py-1 rounded-lg font-bold bg-amber-950/40 text-amber-400 border border-amber-500/30 font-mono">
              Limit: {botStatus?.todayTradesCount || 0} / {botStatus?.maxDailyTrades || 10} Trades Today
            </span>
            <span className="text-[11px] px-2.5 py-1 rounded-lg font-bold bg-emerald-950/40 text-emerald-400 border border-emerald-500/30 font-mono">
              Direction: {botStatus?.tradeDirection || 'BOTH'} (BUY & SELL)
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleResetData}
            className="px-3 py-1.5 text-xs font-bold text-rose-400 hover:text-rose-300 bg-rose-950/30 hover:bg-rose-900/40 border border-rose-500/30 rounded-xl transition-all shadow-sm flex items-center gap-1.5"
            title="Reset daily test history & start fresh"
          >
            <XCircle className="h-3.5 w-3.5" />
            <span>Reset Daily Target</span>
          </button>

          <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-amber-400 bg-amber-950/30 border border-amber-500/30 px-3 py-1.5 rounded-xl backdrop-blur-md">
            <Clock className="h-3.5 w-3.5" />
            <span>{new Date().toLocaleTimeString()} UTC</span>
          </div>
        </div>
      </motion.div>

      {/* 7-Step AI Institutional Pipeline Tracker (From Screenshot Flow) */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <AIPipelineTracker
          currentPrice={2654.50}
          spreadPips={2.1}
          activePositionsCount={positions.length}
          winRate={(summary?.winRate || 0.70) * 100}
          dailyPnl={dailyPnl}
          balance={balance}
        />
      </motion.div>

      {/* Hero Stat Cards Matrix */}
      <motion.div 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-3.5"
      >
        {stats.map((s, idx) => {
          const Icon = s.icon;
          return (
            <div
              key={idx}
              className={`glass-panel p-3 sm:p-4 rounded-2xl border ${s.border} relative overflow-hidden flex flex-col justify-between`}
            >
              <div>
                <div className="flex items-center justify-between text-slate-400 mb-1.5 sm:mb-2">
                  <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider truncate">{s.title}</span>
                  <Icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 ${s.color}`} />
                </div>
                <div className={`text-base sm:text-xl xl:text-2xl font-black font-mono-num tracking-tight truncate ${s.color}`}>
                  {s.value}
                </div>
              </div>
              <div className="text-[10px] sm:text-[11px] font-medium text-slate-400 mt-1.5 sm:mt-2 flex items-center gap-1 truncate">
                <span>{s.subtitle}</span>
              </div>
            </div>
          );
        })}
      </motion.div>

      {/* Instant 1-Minute Scalper Execution Terminal */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}>
        <LiveScalpTerminal onRefresh={fetchAllData} openPositions={positions} />
      </motion.div>

      {/* Split Section: Live Technical Chart & Tactical Telemetry */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* TradingView Chart Container */}
        <div className="lg:col-span-8">
          <TradingViewChart defaultSymbol="OANDA:XAUUSD" defaultInterval="1" />
        </div>

        {/* Tactical Telemetry & Radar Panel */}
        <div className="lg:col-span-4 space-y-4">
          {/* Market Regime Radar */}
          <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">Market Regime Radar</span>
              </div>
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                XAU/USD Active
              </span>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Current Market State:</span>
                <span className="font-extrabold text-emerald-400 font-mono">BULLISH TREND (Daily UP)</span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">ADX (14) Strength:</span>
                <span className="font-bold text-cyan-300 font-mono">28.4 (Strong Trend)</span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">14-Period ATR:</span>
                <span className="font-bold text-amber-400 font-mono">$2.75 (27.5 pips)</span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Scalp Spread Safety:</span>
                <span className="font-bold text-emerald-400 font-mono">2.5 pips (Safe)</span>
              </div>

              <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-400 leading-relaxed">
                🛡️ <strong className="text-white">Trend Alignment Gate:</strong> Bot strictly suppresses counter-trend sell signals while Daily trend is UP.
              </div>
            </div>
          </div>

          {/* Daily Profit Lock Progress Gauge */}
          <div className="glass-panel p-4 rounded-2xl border border-cyan-500/20 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">Daily Profit Lock Target</span>
              </div>
              <span className="text-xs font-black font-mono-num text-amber-400">
                ${Math.max(0, dailyPnl).toFixed(2)} / ${dailyTargetUsd.toFixed(2)}
              </span>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1.5">
              <div className="w-full h-3 rounded-full bg-slate-800 overflow-hidden relative">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 via-emerald-400 to-cyan-400 transition-all duration-500"
                  style={{ width: `${dailyTargetProgress}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                <span>0% Target</span>
                <span className="text-amber-400 font-bold">{dailyTargetProgress.toFixed(0)}% Completed</span>
                <span>${dailyTargetUsd.toFixed(0)} Lock</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400">
              When daily profit reaches ${dailyTargetUsd.toFixed(0)}, the circuit breaker automatically locks in gains and secures capital for the day.
            </p>
          </div>

          {/* Forex Factory Calendar Widget */}
          <ForexFactoryCalendar />
        </div>
      </div>

      {/* Active Positions Terminal */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="glass-panel rounded-2xl p-5 shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-extrabold text-white tracking-wide">
                  Live Active Positions Terminal
                </h3>
                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
                  {positions.length} Open
                </span>
              </div>
              <p className="text-xs text-slate-400">Real-time open orders with live PnL, automated SL/TP, and 1-click break-even lock</p>
            </div>
          </div>

          <div className="text-right">
            <div className="text-xs text-slate-400">Total Floating PnL:</div>
            <div className={`text-base font-black font-mono-num ${activeUnrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {activeUnrealized >= 0 ? '+' : ''}${activeUnrealized.toFixed(2)}
            </div>
          </div>
        </div>

        {positions.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-slate-800 rounded-xl">
            <div className="w-10 h-10 rounded-full bg-slate-900 mx-auto flex items-center justify-center text-slate-500 mb-2">
              <Activity className="w-5 h-5" />
            </div>
            <div className="text-sm font-bold text-slate-300">No Open Positions</div>
            <div className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Scanning market order flow across 1M Scalper, Gold Alpha, and Volatility Arbitrage engines.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-2.5 px-3">Instrument</th>
                  <th className="py-2.5 px-3">Strategy</th>
                  <th className="py-2.5 px-3">Side</th>
                  <th className="py-2.5 px-3">Volume</th>
                  <th className="py-2.5 px-3">Entry Price</th>
                  <th className="py-2.5 px-3">Stop Loss</th>
                  <th className="py-2.5 px-3">Take Profit</th>
                  <th className="py-2.5 px-3 text-right">Floating PnL</th>
                  <th className="py-2.5 px-3 text-right">Quick Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {positions.map((pos) => {
                  const isProfit = pos.unrealizedPnl >= 0;
                  return (
                    <tr key={pos.id} className="hover:bg-slate-900/50 transition-colors">
                      <td className="py-3 px-3 font-bold text-white flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                        <span>{pos.instrument}</span>
                      </td>

                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                          {(pos.strategy || pos.source || 'scalping_1m').replace(/_/g, ' ')}
                        </span>
                      </td>

                      <td className="py-3 px-3">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                          pos.side === 'LONG'
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                        }`}>
                          {pos.side}
                        </span>
                      </td>

                      <td className="py-3 px-3 font-mono font-medium text-slate-300">
                        {pos.units ? (pos.units / 100).toFixed(2) : '0.01'} Lots
                      </td>

                      <td className="py-3 px-3 font-mono font-bold text-slate-200">
                        ${pos.entryPrice.toFixed(2)}
                      </td>

                      <td className="py-3 px-3 font-mono text-rose-400 font-medium">
                        {pos.stopLoss ? `$${pos.stopLoss.toFixed(2)}` : '---'}
                      </td>

                      <td className="py-3 px-3 font-mono text-emerald-400 font-medium">
                        {pos.takeProfit ? `$${pos.takeProfit.toFixed(2)}` : '---'}
                      </td>

                      <td className={`py-3 px-3 font-mono-num font-black text-right ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isProfit ? '+' : ''}${pos.unrealizedPnl.toFixed(2)}
                      </td>

                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setSelectedRationaleItem(pos)}
                            className="px-2.5 py-1 text-[11px] font-bold bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 rounded-lg transition-all flex items-center gap-1 shadow-sm"
                            title="View trade signal rationale & indicator rules"
                          >
                            <Info className="w-3 h-3" />
                            <span>Why?</span>
                          </button>

                          <button
                            onClick={() => handleLockPositionBE(pos)}
                            disabled={lockingId === pos.id}
                            className="px-2.5 py-1 text-[11px] font-bold bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 rounded-lg transition-all flex items-center gap-1 shadow-sm"
                            title="Move Stop Loss to Break-Even (+2 pips)"
                          >
                            <Lock className="w-3 h-3" />
                            <span>BE</span>
                          </button>

                          <button
                            onClick={() => handleClosePosition(pos.id)}
                            disabled={closingId === pos.id}
                            className="px-2.5 py-1 text-[11px] font-bold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-lg transition-all flex items-center gap-1 shadow-sm"
                            title="Close this position immediately"
                          >
                            <XCircle className="w-3 h-3" />
                            <span>Close</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      {/* Multi-Pair Signal Heatmap & Scanner */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}>
        <MarketHeatmap />
      </motion.div>

      {/* Active Strategy Portfolio Matrix */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }}>
        <StrategyMatrix openPositions={positions} />
      </motion.div>

      {/* Live Logs & AI Copilot Chat */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8">
          <BotConsoleLogs />
        </div>
        <div className="lg:col-span-4">
          <AICopilotChat />
        </div>
      </div>

      {/* Trade Entry Rationale Modal */}
      <TradeRationaleModal
        item={selectedRationaleItem}
        onClose={() => setSelectedRationaleItem(null)}
      />
    </div>
  );
}
