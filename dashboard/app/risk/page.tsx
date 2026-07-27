'use client';

import React, { useState, useEffect } from 'react';
import { getRiskStatus, RiskStatus, getSummary, Summary, connectLiveFeed } from '../../lib/api-client';
import { 
  ShieldAlert, 
  Percent, 
  Layers, 
  TrendingDown, 
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { motion } from 'framer-motion';

const MotionDiv = motion.div as any;

export default function RiskPage() {
  const [riskStatus, setRiskStatus] = useState<RiskStatus | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchRiskMetrics = async () => {
    try {
      const [data, sumData] = await Promise.all([getRiskStatus(), getSummary()]);
      setRiskStatus(data);
      setSummary(sumData);
    } catch (e) {
      console.error("Failed to load risk status:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRiskMetrics();
    const interval = setInterval(fetchRiskMetrics, 2000);
    const disconnect = connectLiveFeed((event) => {
      if (event.type === 'position_update' || event.type === 'trade_closed' || event.type === 'equity_tick') {
        fetchRiskMetrics();
      }
    });
    return () => {
      clearInterval(interval);
      disconnect();
    };
  }, []);

  if (false) {
    return null;
  }

  if (!riskStatus) {
    return (
      <div className="text-center py-20 text-slate-500 font-bold uppercase tracking-widest text-xs">
        Failed to load risk parameters. Check backend connectivity.
      </div>
    );
  }

  const dailyLossUsed = riskStatus?.dailyLossUsed ?? 0;
  const dailyLossLimit = riskStatus?.dailyLossLimit ?? 100;
  const weeklyLossUsed = riskStatus?.weeklyLossUsed ?? 0;
  const weeklyLossLimit = riskStatus?.weeklyLossLimit ?? 250;
  const currentOpenPositions = riskStatus?.currentOpenPositions ?? 0;
  const maxConcurrentPositions = riskStatus?.maxConcurrentPositions ?? 3;

  const dailyLossPct = Math.min(100, Math.max(0, (dailyLossUsed / (dailyLossLimit || 1)) * 100));
  const isDailyLimitHit = dailyLossUsed >= dailyLossLimit;

  const weeklyLossPct = Math.min(100, Math.max(0, (weeklyLossUsed / (weeklyLossLimit || 1)) * 100));
  const isWeeklyLimitHit = weeklyLossUsed >= weeklyLossLimit;

  const positionsPct = Math.min(100, Math.max(0, (currentOpenPositions / (maxConcurrentPositions || 1)) * 100));
  const isPosLimitHit = currentOpenPositions >= maxConcurrentPositions;

  const bySource = summary && summary.bySource ? summary.bySource : {};
  const mlSignal = bySource.ml_signal;
  const maCrossover = bySource.ma_crossover;
  const lossRecovery = bySource.loss_recovery;

  const primaryWinRate = (mlSignal && mlSignal.winRate) || (maCrossover && maCrossover.winRate) || 0;
  const recoveryWinRate = (lossRecovery && lossRecovery.winRate) || 0;

  return (
    <MotionDiv 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-white">Risk Control Center</h2>
        <p className="text-slate-400 text-sm font-medium mt-1">Monitor exposure budgets, view daily drawdown limits, and manage position limits.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Exposure Status Widgets */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Daily Drawdown Meter */}
          <MotionDiv 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-panel rounded-3xl p-8 border border-white/[0.05] space-y-6 relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/5 rounded-full blur-[80px] -mr-20 -mt-20"></div>
            
            <div className="flex items-center justify-between relative z-10">
              <div className="flex items-center space-x-4">
                <div className={`p-3 rounded-2xl border ${
                  isDailyLimitHit 
                    ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' 
                    : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400'
                }`}>
                  <TrendingDown className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white uppercase tracking-wider">Daily Loss Budget</h3>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">Realized losses closed today + active unrealized losses.</p>
                </div>
              </div>
              <span className={`text-xs font-black tracking-widest px-3 py-1 rounded-full ${isDailyLimitHit ? 'bg-rose-500/10 text-rose-400 animate-pulse border border-rose-500/20' : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'}`}>
                {isDailyLimitHit ? 'TRADING HALTED' : 'HEALTHY'}
              </span>
            </div>

            <div className="space-y-3 relative z-10">
              <div className="flex justify-between text-sm font-bold text-slate-300 font-mono">
                <span>Used: <span className="text-white">${dailyLossUsed.toFixed(2)}</span></span>
                <span>Limit: <span className="text-white">${dailyLossLimit.toFixed(2)}</span></span>
              </div>
              <div className="w-full bg-white/[0.02] h-4 rounded-full overflow-hidden border border-white/[0.05] p-0.5">
                <MotionDiv 
                  initial={{ width: 0 }}
                  animate={{ width: `${dailyLossPct}%` }}
                  transition={{ duration: 1, ease: "easeOut" }}
                  className={`h-full rounded-full ${
                    dailyLossPct > 80 
                      ? 'bg-gradient-to-r from-rose-500 to-red-600 shadow-[0_0_15px_rgba(244,63,94,0.5)]' 
                      : dailyLossPct > 50 
                        ? 'bg-gradient-to-r from-amber-400 to-orange-500 shadow-[0_0_15px_rgba(251,191,36,0.5)]' 
                        : 'bg-gradient-to-r from-cyan-400 to-blue-500 shadow-[0_0_15px_rgba(34,211,238,0.5)]'
                  }`}
                ></MotionDiv>
              </div>
              <p className="text-xs text-slate-500 text-right font-semibold">
                Remaining Drawdown Budget: <span className="text-emerald-400">${(dailyLossLimit - dailyLossUsed).toFixed(2)}</span>
              </p>
            </div>
          </MotionDiv>

          {/* Concurrent Positions Meter */}
          <MotionDiv 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="glass-panel rounded-3xl p-8 border border-white/[0.05] space-y-6 relative overflow-hidden"
          >
            <div className="absolute bottom-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-[80px] -mr-20 -mb-20"></div>

            <div className="flex items-center justify-between relative z-10">
              <div className="flex items-center space-x-4">
                <div className={`p-3 rounded-2xl border ${
                  isPosLimitHit 
                    ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' 
                    : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                }`}>
                  <Layers className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white uppercase tracking-wider">Concurrent Positions</h3>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">Max open positions allowed in portfolio at once.</p>
                </div>
              </div>
              <span className={`text-xl font-black ${isPosLimitHit ? 'text-rose-400' : 'text-white'}`}>
                {riskStatus.currentOpenPositions} <span className="text-slate-500 text-sm">/ {riskStatus.maxConcurrentPositions}</span>
              </span>
            </div>

            <div className="space-y-3 relative z-10">
              <div className="w-full bg-white/[0.02] h-4 rounded-full overflow-hidden border border-white/[0.05] p-0.5">
                <MotionDiv 
                  initial={{ width: 0 }}
                  animate={{ width: `${positionsPct}%` }}
                  transition={{ duration: 1, ease: "easeOut" }}
                  className={`h-full rounded-full ${
                    isPosLimitHit 
                      ? 'bg-gradient-to-r from-rose-500 to-red-600 shadow-[0_0_15px_rgba(244,63,94,0.5)]' 
                      : 'bg-gradient-to-r from-indigo-400 to-cyan-400 shadow-[0_0_15px_rgba(129,140,248,0.5)]'
                  }`}
                ></MotionDiv>
              </div>
              <p className="text-xs text-slate-500 text-right font-semibold">
                Available slots: <span className="text-cyan-400">{riskStatus.maxConcurrentPositions - riskStatus.currentOpenPositions}</span> positions
              </p>
            </div>
          </MotionDiv>

        </div>

        {/* Global Limits Panel */}
        <MotionDiv 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          className="space-y-6"
        >
          <div className="glass-panel rounded-3xl p-8 border border-white/[0.05] flex flex-col space-y-6 h-full">
            <div>
              <h3 className="text-lg font-bold text-white uppercase tracking-wide">Risk Parameters</h3>
              <p className="text-xs text-slate-400 font-semibold mt-1">Configured constraints in `.env` settings.</p>
            </div>

              <div className="flex justify-between py-3 font-medium">
                <span className="text-slate-400">Total Open Risk</span>
                <span className={`text-white font-bold px-2 py-0.5 rounded-md border ${(riskStatus?.currentTotalOpenRiskPct ?? 0) >= 3.0 ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'}`}>
                  {(riskStatus?.currentTotalOpenRiskPct ?? 0).toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between py-3 font-medium">
                <span className="text-slate-400">Effective Risk/Trade</span>
                <span className="text-white flex items-center space-x-1.5 bg-cyan-500/10 px-2 py-0.5 rounded-md border border-cyan-500/20">
                  <Percent className="h-3.5 w-3.5 text-cyan-400" />
                  <span className="text-cyan-400 font-bold">{riskStatus?.effectiveRiskPct ?? 2.0}%</span>
                </span>
              </div>
              <div className="flex justify-between py-3 font-medium">
                <span className="text-slate-400">Distance to Circuit Breaker</span>
                <span className="text-white font-mono text-emerald-400">${(riskStatus?.distanceToCircuitBreaker ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-3 font-medium">
                <span className="text-slate-400">Recovery vs Primary WR</span>
                <span className="text-white font-mono">{(recoveryWinRate * 100).toFixed(1)}% / {(primaryWinRate * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between py-3 font-medium">
                <span className="text-slate-400">Weekly Drawdown Budget</span>
                <span className="text-white font-mono text-rose-400">${(weeklyLossLimit - weeklyLossUsed).toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-3 font-medium">
                <span className="text-slate-400">Leverage Cap</span>
                <span className="text-white font-mono">30:1</span>
              </div>
              <div className="flex justify-between py-3 font-medium">
                <span className="text-slate-400">Stop Loss Buffer</span>
                <span className="text-indigo-400 font-bold bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20">ATR Dynamic</span>
              </div>
              <div className="flex justify-between py-3 font-medium">
                <span className="text-slate-400">Execution Slippage</span>
                <span className="text-white font-mono">~0.5 pips</span>
              </div>

            <div className="mt-auto pt-6 border-t border-white/[0.05]">
              <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-2xl p-5 text-xs text-slate-300 font-medium leading-relaxed space-y-3 relative overflow-hidden">
                <div className="absolute -right-4 -top-4">
                  <ShieldAlert className="h-24 w-24 text-cyan-500/10" />
                </div>
                <h5 className="font-bold text-cyan-400 flex items-center space-x-2 relative z-10">
                  <ShieldAlert className="h-4 w-4" />
                  <span className="tracking-widest uppercase">Guardrails Active</span>
                </h5>
                <p className="relative z-10 text-slate-400">
                  If the daily loss threshold is breached, the risk manager will immediately decline all strategy entry signals for the remainder of the trading day. Any active positions will remain managed by their Trailing Stop / TP targets.
                </p>
              </div>
            </div>
          </div>
        </MotionDiv>

      </div>
    </MotionDiv>
  );
}
