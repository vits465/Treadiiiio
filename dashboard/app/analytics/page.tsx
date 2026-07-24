'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getDemoRealSim, getScalingRoadmap, getKellySizing, SimulationReport, RoadmapProjection, KellySizingInfo } from '../../lib/api-client';
import { BarChart, Activity, ShieldAlert, Target, DollarSign, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';

export default function AnalyticsPage() {
  const [simReport, setSimReport] = useState<SimulationReport | null>(null);
  const [roadmap, setRoadmap] = useState<RoadmapProjection | null>(null);
  const [kelly, setKelly] = useState<KellySizingInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [sim, rd, k] = await Promise.all([
          getDemoRealSim(),
          getScalingRoadmap(),
          getKellySizing()
        ]);
        setSimReport(sim);
        setRoadmap(rd);
        setKelly(k);
      } catch (e) {
        console.error("Failed to load analytics", e);
      } finally {
        setLoading(false);
      }
    }
    loadData();
    const interval = setInterval(loadData, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  if (loading || !simReport || !roadmap || !kelly) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-slate-500 font-mono tracking-widest uppercase">
        <Activity className="animate-spin mr-3 h-5 w-5" />
        Calculating Analytics Matrix...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
          <BarChart className="h-8 w-8 text-cyan-400" />
          Scaling & Analytics Engine
        </h2>
        <p className="text-slate-400 text-sm font-medium mt-1">100x Growth Roadmap, Kelly Position Sizing, and Live Transition Simulator.</p>
      </motion.div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        
        {/* Demo vs Real Simulator */}
        <div className="glass-panel rounded-3xl p-6 border border-white/[0.05] space-y-5 relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-indigo-400" />
              Demo to Live Simulator
            </h3>
          </div>
          <p className="text-sm text-slate-400">
            Simulates real-money conditions (slippage, requotes, spreads) against your demo trades.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Demo Baseline */}
            <div className="bg-[#0f172a]/60 border border-white/[0.05] rounded-xl p-4">
              <div className="text-[10px] font-bold tracking-widest uppercase text-slate-500 mb-1">Demo Baseline</div>
              <div className={`text-2xl font-bold ${simReport.demoResults.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                ${simReport.demoResults.totalPnl.toFixed(2)}
              </div>
              <div className="text-xs text-slate-400 mt-2">Win Rate: {simReport.demoResults.winPct}%</div>
              <div className="text-xs text-slate-400">Sharpe: {simReport.demoResults.sharpe}</div>
            </div>

            {/* Realistic Scenario */}
            <div className="bg-indigo-950/20 border border-indigo-500/20 rounded-xl p-4">
              <div className="text-[10px] font-bold tracking-widest uppercase text-indigo-400 mb-1">Realistic Friction (Live)</div>
              <div className={`text-2xl font-bold ${simReport.simulatedRealistic.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                ${simReport.simulatedRealistic.totalPnl.toFixed(2)}
              </div>
              <div className="text-xs text-slate-400 mt-2">Slippage Avg: {simReport.simulatedRealistic.avgSlippagePips} pips</div>
              <div className="text-xs text-slate-400">Max DD: {simReport.simulatedRealistic.maxDrawdownPct}%</div>
            </div>
          </div>

          <div className="mt-4 p-4 rounded-xl bg-slate-900 border border-slate-800">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Verdict & Recommendation</div>
            <p className="text-sm text-white font-medium">{simReport.recommendation}</p>
            <p className="text-xs text-indigo-300 mt-2">{simReport.simulatedRealistic.verdict}</p>
          </div>
        </div>

        {/* Kelly Criterion Calculator */}
        <div className="glass-panel rounded-3xl p-6 border border-white/[0.05] space-y-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Target className="h-5 w-5 text-emerald-400" />
              Fractional Kelly Sizing
            </h3>
          </div>
          <p className="text-sm text-slate-400">
            Optimal capital allocation based on recent edge (Win Rate: {(kelly.metrics.winRate * 100).toFixed(1)}%, PF: {kelly.metrics.profitFactor.toFixed(2)}).
          </p>

          <div className="space-y-3">
            {[ 
              { label: "High Confidence (0.85+)", data: kelly.tiers.high, color: "text-emerald-400", border: "border-emerald-500/30", bg: "bg-emerald-500/10" },
              { label: "Medium Confidence (0.75-0.85)", data: kelly.tiers.mid, color: "text-amber-400", border: "border-amber-500/30", bg: "bg-amber-500/10" },
              { label: "Low Confidence (0.60-0.75)", data: kelly.tiers.low, color: "text-rose-400", border: "border-rose-500/30", bg: "bg-rose-500/10" },
            ].map((tier, idx) => (
              <div key={idx} className={`flex items-center justify-between p-4 rounded-xl border ${tier.border} bg-[#0f172a]/40`}>
                <div>
                  <div className={`text-sm font-bold ${tier.color}`}>{tier.label}</div>
                  <div className="text-xs text-slate-400 mt-1">Tier: {tier.data.fractionUsed} Kelly</div>
                </div>
                <div className="text-right">
                  <div className={`text-lg font-bold ${tier.color}`}>{tier.data.fractionalKellyPct}% Risk</div>
                  <div className="text-xs font-mono text-slate-300 mt-1">~${tier.data.riskUsd}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 24-Month Roadmap */}
        <div className="glass-panel rounded-3xl p-6 border border-white/[0.05] space-y-5 xl:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-amber-400" />
              100x Scaling Roadmap (24 Months)
            </h3>
            <div className={`text-xs font-bold px-3 py-1 rounded-full border ${roadmap.isPaceGood ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/10 text-rose-400 border-rose-500/30'}`}>
              PACE: {roadmap.isPaceGood ? 'ON TRACK' : 'BEHIND SCHEDULE'}
            </div>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-2 mt-6">
            {roadmap.milestones.map((ms, idx) => (
              <div key={idx} className={`relative p-3 rounded-lg border flex flex-col items-center text-center group ${
                ms.status === 'COMPLETED' ? 'bg-emerald-950/30 border-emerald-500/20 opacity-80' :
                ms.status === 'IN_PROGRESS' ? 'bg-indigo-950/40 border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.2)]' :
                'bg-slate-900/50 border-white/[0.05] opacity-50 hover:opacity-80'
              }`}>
                <div className="text-[10px] text-slate-400 font-bold mb-1">M{ms.month}</div>
                <div className={`text-sm font-bold ${
                  ms.status === 'COMPLETED' ? 'text-emerald-400' :
                  ms.status === 'IN_PROGRESS' ? 'text-indigo-400' : 'text-slate-300'
                }`}>${ms.expectedCapital >= 1000 ? (ms.expectedCapital/1000).toFixed(1) + 'k' : ms.expectedCapital}</div>
                
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-48 p-3 bg-slate-800 text-left rounded-lg shadow-xl border border-slate-700 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                  <div className="text-xs font-bold text-white mb-1">Month {ms.month} Goal</div>
                  <div className="text-[10px] text-slate-300 mb-2">{ms.notes}</div>
                  <div className="text-[10px] text-cyan-400">Strats: {ms.strategies.join(', ')}</div>
                </div>
              </div>
            ))}
          </div>

        </div>

      </div>
    </div>
  );
}
