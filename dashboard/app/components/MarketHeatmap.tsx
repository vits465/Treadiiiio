// dashboard/app/components/MarketHeatmap.tsx
"use client";

import React from "react";
import { Activity, ShieldCheck, Flame, Compass } from "lucide-react";

interface HeatmapPair {
  symbol: string;
  rsi: number;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  signalStatus: "READY" | "NEUTRAL" | "OVERBOUGHT" | "OVERSOLD";
  volatility: "HIGH" | "MEDIUM" | "LOW";
}

const MOCK_HEATMAP_DATA: HeatmapPair[] = [
  { symbol: "XAU/USD", rsi: 48.2, trend: "BULLISH", signalStatus: "NEUTRAL", volatility: "HIGH" },
  { symbol: "EUR/USD", rsi: 34.5, trend: "BULLISH", signalStatus: "OVERSOLD", volatility: "MEDIUM" },
  { symbol: "GBP/USD", rsi: 68.1, trend: "BEARISH", signalStatus: "OVERBOUGHT", volatility: "MEDIUM" },
  { symbol: "USD/JPY", rsi: 52.0, trend: "NEUTRAL", signalStatus: "NEUTRAL", volatility: "LOW" },
];

export function MarketHeatmap() {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-indigo-400" />
          <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
            Multi-Pair Signal Heatmap & Scanner
          </h2>
        </div>
        <span className="text-xs text-slate-400 font-mono">1H Granularity</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {MOCK_HEATMAP_DATA.map((item) => {
          const isOversold = item.rsi <= 35;
          const isOverbought = item.rsi >= 65;

          return (
            <div
              key={item.symbol}
              className={`p-3.5 rounded-lg border flex flex-col justify-between transition-all ${
                isOversold
                  ? "bg-emerald-500/10 border-emerald-500/30"
                  : isOverbought
                  ? "bg-rose-500/10 border-rose-500/30"
                  : "bg-slate-850 border-slate-800 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-slate-100">{item.symbol}</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                    item.trend === "BULLISH"
                      ? "bg-emerald-500/20 text-emerald-400"
                      : item.trend === "BEARISH"
                      ? "bg-rose-500/20 text-rose-400"
                      : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {item.trend}
                </span>
              </div>

              {/* RSI Bar */}
              <div className="mb-2">
                <div className="flex justify-between text-xs mb-1 font-mono">
                  <span className="text-slate-400">RSI (14)</span>
                  <span
                    className={`font-semibold ${
                      isOversold
                        ? "text-emerald-400"
                        : isOverbought
                        ? "text-rose-400"
                        : "text-slate-300"
                    }`}
                  >
                    {item.rsi.toFixed(1)}
                  </span>
                </div>
                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      isOversold
                        ? "bg-emerald-400"
                        : isOverbought
                        ? "bg-rose-400"
                        : "bg-indigo-400"
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, item.rsi))}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-800/60">
                <span>Signal Proximity</span>
                <span
                  className={`font-semibold ${
                    isOversold || isOverbought ? "text-amber-400 animate-pulse" : "text-slate-400"
                  }`}
                >
                  {isOversold ? "⚡ BUY NEAR" : isOverbought ? "⚡ SELL NEAR" : "WAITING"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
