'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Eye,
  Search,
  Bell,
  ShieldCheck,
  Zap,
  LineChart,
  Brain,
  CheckCircle2,
  Lock,
  Clock,
  ArrowRight,
  TrendingUp,
  Sliders,
  DollarSign
} from 'lucide-react';

interface AIPipelineTrackerProps {
  currentPrice?: number;
  spreadPips?: number;
  activePositionsCount?: number;
  winRate?: number;
  dailyPnl?: number;
  balance?: number;
}

export default function AIPipelineTracker({
  currentPrice = 2654.50,
  spreadPips = 2.1,
  activePositionsCount = 0,
  winRate = 70.0,
  dailyPnl = 0.00,
  balance = 50.00,
}: AIPipelineTrackerProps) {
  const [activeStep, setActiveStep] = useState<number>(1);

  const steps = [
    {
      id: 1,
      num: '01',
      name: 'SCAN',
      title: 'Watches 24/7',
      desc: 'Real-time price action, tick volume, market structure & trend on XAU/USD.',
      icon: Eye,
      status: 'ACTIVE',
      color: 'amber',
      metric: 'XAU/USD Live',
      submetric: `${spreadPips.toFixed(1)} pip spread`,
      details: {
        action: 'Tracks real-time tick flow & M1/M5 volatility spikes',
        volume: 'Monitors institutional volume participation & volume delta',
        structure: 'Identifies swing highs/lows, session breaks & key liquidity',
        trend: 'MTF Daily 50/200 EMA + 1H momentum alignment'
      }
    },
    {
      id: 2,
      num: '02',
      name: 'RESEARCH',
      title: 'No Trade Starts with a Guess',
      desc: 'Deep multi-factor analysis: Macro, Technicals, News Sentiment & Regime.',
      icon: Search,
      status: 'VERIFIED',
      color: 'cyan',
      metric: '78% Avg Edge',
      submetric: 'High Conviction',
      details: {
        action: 'AI Research Engine analyzes correlation & volatility regimes',
        volume: 'Pattern recognition on 1M micro-pullbacks & VWAP deviations',
        structure: 'High-probability edge modeling with 0.72+ confidence bar',
        trend: 'News blackout guard active (FOMC/CPI zero-trade window)'
      }
    },
    {
      id: 3,
      num: '03',
      name: 'SIGNAL',
      title: 'Your Rules, Not Emotions',
      desc: '4-Point Confirmation: Trend ✓, Volume ✓, Structure ✓, Momentum ✓.',
      icon: Bell,
      status: 'READY',
      color: 'indigo',
      metric: '1M Scalp Setup',
      submetric: 'Valid for 3m',
      details: {
        action: 'Trend: Aligned with Daily macro direction (No fading)',
        volume: 'Volume: Participation surge > 1.4x rolling 20-bar avg',
        structure: 'Structure: Clean breakout or Fair Value Gap discount retest',
        trend: 'Momentum: EMA 9/21/50 ribbon expansion + RSI(7) curl'
      }
    },
    {
      id: 4,
      num: '04',
      name: 'RISK',
      title: 'Protect Capital First',
      desc: '$50 Budget Guard: 0.01 micro-lot, strict 1:2.0 RRR, 1 trade max.',
      icon: ShieldCheck,
      status: 'SAFE',
      color: 'emerald',
      metric: 'Risk: $2.00 / 4%',
      submetric: 'Reward: $4.00 (1:2)',
      details: {
        action: 'Position Sizing: Strictly bounded to 0.01 micro-lot ($1/point)',
        volume: 'Stop Loss: Tight 20-pip structural SL ($2.00 max risk)',
        structure: 'Take Profit: Institutional 1:2.0 RRR ($4.00 target on 0.01 lot)',
        trend: 'Circuit Breaker: Daily max loss capped at $3.00 (6% of $50)'
      }
    },
    {
      id: 5,
      num: '05',
      name: 'EXECUTE',
      title: 'Fast, Emotionless',
      desc: 'Instant MT5 IPC order dispatch with zero hesitation (< 120ms).',
      icon: Zap,
      status: activePositionsCount > 0 ? 'ACTIVE' : 'IDLE',
      color: 'amber',
      metric: '< 110ms Speed',
      submetric: 'Direct MT5 Pipe',
      details: {
        action: 'Direct Named Pipe / IPC bridge to MetaTrader 5 terminal',
        volume: 'Immediate hard SL & TP attached on order creation',
        structure: 'Zero manual hesitation, zero revenge trading, zero FOMO',
        trend: 'Slippage sanity filter rejects fills beyond 1.5 pips'
      }
    },
    {
      id: 6,
      num: '06',
      name: 'TRACK',
      title: 'Dynamic Management',
      desc: 'Real-time PnL, auto Break-Even ratchet at +1.0R, trailing stop.',
      icon: LineChart,
      status: activePositionsCount > 0 ? 'TRACKING' : 'READY',
      color: 'cyan',
      metric: `${activePositionsCount} Open Trade`,
      submetric: 'BE Ratchet Armed',
      details: {
        action: 'Live tick-by-tick unrealized profit/loss calculation',
        volume: 'Break-Even Lock: Moves Stop Loss to Entry once +1.0R is gained',
        structure: 'Hedging Guard: Blocks conflicting opposite trades on XAU/USD',
        trend: 'Dashboard 1-Click Panic Close & Lock BE manual controls'
      }
    },
    {
      id: 7,
      num: '07',
      name: 'IMPROVE',
      title: 'Every Trade Smarter',
      desc: 'Autonomous feedback loop: Records trade outcomes & refines parameters.',
      icon: Brain,
      status: 'LEARNING',
      color: 'emerald',
      metric: `${winRate.toFixed(1)}% Win Rate`,
      submetric: 'Continuous Edge',
      details: {
        action: 'SQLite trade log persists all entries, exits, R-multiples & slippage',
        volume: 'Dynamic Kelly Criterion updates based on rolling 50-trade win rate',
        structure: 'Strategy Allocator redistributes capital to top-performing scalpers',
        trend: 'Lessons Learned: Trend + Structure + Tight Risk = Maximum Profit'
      }
    },
  ];

  const currentActive = steps.find((s) => s.id === activeStep) || steps[0];

  return (
    <div className="bg-slate-950/80 border border-slate-800/90 rounded-2xl p-5 shadow-2xl backdrop-blur-xl relative overflow-hidden">
      {/* Background Glow */}
      <div className="absolute -top-24 -right-24 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header Info */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-800/70">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/30">
              AI AUTONOMOUS ENGINE
            </span>
            <span className="text-xs font-mono text-slate-400">
              7-STAGE QUANTITATIVE PIPELINE
            </span>
          </div>
          <h3 className="text-lg font-extrabold text-white tracking-tight flex items-center gap-2">
            <span>Trading System Workflow:</span>
            <span className="text-amber-400 font-mono">XAU/USD Gold Focus</span>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              $50 Budget Tuned
            </span>
          </h3>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs">
            <DollarSign className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-400 font-medium">Budget:</span>
            <span className="font-mono-num font-bold text-white">${balance.toFixed(2)}</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-400 font-medium">Auto-Scalper:</span>
            <span className="font-mono-num font-bold text-emerald-400">100% Armed</span>
          </div>
        </div>
      </div>

      {/* 7-Step Interactive Pipeline Progress Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7 gap-2 sm:gap-2.5 mb-5">
        {steps.map((step) => {
          const Icon = step.icon;
          const isSelected = activeStep === step.id;

          return (
            <button
              key={step.id}
              onClick={() => setActiveStep(step.id)}
              className={`p-2.5 sm:p-3 rounded-xl border text-left transition-all relative overflow-hidden group ${
                isSelected
                  ? 'bg-amber-500/15 border-amber-500/60 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500/40'
                  : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900'
              }`}
            >
              <div className="flex items-center justify-between gap-1 mb-1.5">
                <span className={`text-[10px] font-mono font-black ${isSelected ? 'text-amber-400' : 'text-slate-500'}`}>
                  {step.num}
                </span>

                <span className={`text-[8px] sm:text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase ${
                  step.status === 'ACTIVE' ? 'bg-amber-500/20 text-amber-300' :
                  step.status === 'SAFE' ? 'bg-emerald-500/20 text-emerald-300' :
                  step.status === 'READY' ? 'bg-cyan-500/20 text-cyan-300' :
                  'bg-slate-800 text-slate-400'
                }`}>
                  {step.status}
                </span>
              </div>

              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-amber-400' : 'text-slate-400 group-hover:text-slate-200'}`} />
                <span className={`text-xs font-black tracking-tight truncate ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                  {step.name}
                </span>
              </div>

              <div className="text-[10px] sm:text-[11px] font-mono-num font-bold text-slate-200 truncate">
                {step.metric}
              </div>
              <div className="text-[9px] sm:text-[10px] text-slate-400 truncate">
                {step.submetric}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Stage Detail Panel (Interactive Drill-down from Screenshot) */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentActive.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
          className="bg-slate-900/90 border border-slate-800 rounded-xl p-4.5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3.5 pb-3 border-b border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
                <currentActive.icon className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-amber-400">STAGE {currentActive.num}</span>
                  <span className="text-sm font-extrabold text-white tracking-wide">{currentActive.name}: {currentActive.title}</span>
                </div>
                <p className="text-xs text-slate-400">{currentActive.desc}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-slate-400">Risk Check:</span>
              <span className="px-2.5 py-1 rounded-lg text-xs font-black bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                PASSED
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400 mb-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Price & Volatility</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">{currentActive.details.action}</p>
            </div>

            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-400 mb-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Volume & Flow</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">{currentActive.details.volume}</p>
            </div>

            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-400 mb-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Market Structure</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">{currentActive.details.structure}</p>
            </div>

            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 mb-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Macro & Rules</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">{currentActive.details.trend}</p>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
