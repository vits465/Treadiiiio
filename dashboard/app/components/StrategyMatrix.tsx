// dashboard/app/components/StrategyMatrix.tsx
"use client";

import React from "react";
import { Award, Zap, TrendingUp, CheckCircle, Shield, AlertCircle } from "lucide-react";
import { Position } from "../../lib/api-client";

interface StrategyMatrixProps {
  openPositions: Position[];
}

interface StrategyMeta {
  id: string;
  name: string;
  category: "Scalper" | "Momentum" | "Reversal" | "Arbitrage";
  targetRRR: string;
  allocation: string;
  description: string;
}

const STRATEGIES: StrategyMeta[] = [
  {
    id: "scalping_1m",
    name: "Precision 1M Scalper",
    category: "Scalper",
    targetRRR: "1:2.0",
    allocation: "35%",
    description: "EMA 9/21/50 ribbon pullbacks + 7-period RSI curl + VWAP confirmation."
  },
  {
    id: "gold_alpha",
    name: "Gold Alpha Institutional",
    category: "Scalper",
    targetRRR: "1:2.08",
    allocation: "35%",
    description: "200 EMA macro trend filter + typical VWAP bounce + ADX expansion."
  },
  {
    id: "volatility_arbitrage",
    name: "Volatility Expansion Arb",
    category: "Arbitrage",
    targetRRR: "1:2.0",
    allocation: "25%",
    description: "Rolling 20-period ATR spike breakout in direction of Daily trend."
  },
  {
    id: "power_breakout",
    name: "Donchian Power Breakout",
    category: "Momentum",
    targetRRR: "1:2.5",
    allocation: "20%",
    description: "15-candle high/low channel breakout with ADX >= 20 confirmation."
  },
  {
    id: "smc_liquidity",
    name: "SMC Fair Value Gap Retest",
    category: "Scalper",
    targetRRR: "1:2.5",
    allocation: "20%",
    description: "Genuine discount/premium FVG mitigation retest with tight invalidation."
  },
  {
    id: "rsi_reversion",
    name: "Trend-Aligned RSI Reversion",
    category: "Reversal",
    targetRRR: "1:2.0",
    allocation: "15%",
    description: "Oversold dip buying in uptrends & overbought rally fading in downtrends."
  },
  {
    id: "bollinger_bands",
    name: "Bollinger Squeeze Scalp",
    category: "Reversal",
    targetRRR: "1:2.0",
    allocation: "15%",
    description: "Band touch + rejection candle back inside bands with strict trend gating."
  },
  {
    id: "asian_killzone",
    name: "Session Range Sweep",
    category: "Scalper",
    targetRRR: "1:2.0",
    allocation: "15%",
    description: "Asian range high/low liquidity sweep + 50 EMA rejection."
  }
];

export function StrategyMatrix({ openPositions }: StrategyMatrixProps) {
  return (
    <div className="glass-panel rounded-2xl p-5 shadow-2xl">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Award className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-white tracking-wide">
              Active Strategy Portfolio Matrix
            </h3>
            <p className="text-xs text-slate-400">Calibrated quantitative engines optimized for institutional profitability</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 rounded-xl">
          <CheckCircle className="w-3.5 h-3.5" />
          <span>All 8 Scalp Engines Active</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {STRATEGIES.map((strat) => {
          const activeForStrat = openPositions.filter((p) => (p.strategy || p.source) === strat.id);
          const hasOpenPosition = activeForStrat.length > 0;

          return (
            <div
              key={strat.id}
              className={`p-3.5 rounded-xl border transition-all relative overflow-hidden flex flex-col justify-between ${
                hasOpenPosition
                  ? "bg-cyan-950/30 border-cyan-500/50 shadow-md shadow-cyan-500/10"
                  : "bg-slate-900/60 border-slate-800/80 hover:border-slate-700"
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                    strat.category === "Scalper" ? "bg-amber-500/15 text-amber-300 border border-amber-500/30" :
                    strat.category === "Arbitrage" ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30" :
                    strat.category === "Momentum" ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/30" :
                    "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  }`}>
                    {strat.category}
                  </span>

                  <span className="text-[11px] font-mono-num font-bold text-slate-400">
                    Alloc: {strat.allocation}
                  </span>
                </div>

                <div className="text-sm font-bold text-white tracking-tight mb-1">
                  {strat.name}
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                  {strat.description}
                </p>
              </div>

              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1 text-slate-300 font-bold">
                  <span className="text-slate-500">RRR:</span>
                  <span className="text-cyan-400 font-mono-num">{strat.targetRRR}</span>
                </div>

                {hasOpenPosition ? (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse">
                    {activeForStrat.length} ACTIVE
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-slate-500">
                    MONITORING
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
