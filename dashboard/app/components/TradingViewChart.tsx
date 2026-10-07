// dashboard/app/components/TradingViewChart.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { BarChart2, Zap, Clock, Maximize2 } from "lucide-react";

interface TradingViewChartProps {
  defaultSymbol?: string;
  defaultInterval?: string;
}

const SUPPORTED_SYMBOLS = [
  { label: "XAU/USD (Gold)", tvSymbol: "OANDA:XAUUSD", isGold: true },
  { label: "EUR/USD", tvSymbol: "FX:EURUSD", isGold: false },
  { label: "GBP/USD", tvSymbol: "FX:GBPUSD", isGold: false },
  { label: "USD/JPY", tvSymbol: "FX:USDJPY", isGold: false },
];

const TIMEFRAMES = [
  { label: "1m (Scalp)", interval: "1" },
  { label: "5m", interval: "5" },
  { label: "15m", interval: "15" },
  { label: "1h", interval: "60" },
  { label: "1D", interval: "D" },
];

export function TradingViewChart({
  defaultSymbol = "OANDA:XAUUSD",
  defaultInterval = "1"
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedSymbol, setSelectedSymbol] = useState(defaultSymbol);
  const [selectedInterval, setSelectedInterval] = useState(defaultInterval);

  useEffect(() => {
    if (!containerRef.current) return;

    containerRef.current.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: selectedSymbol,
      interval: selectedInterval,
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      backgroundColor: "rgba(3, 7, 18, 1)",
      gridColor: "rgba(30, 41, 59, 0.4)",
      enable_publishing: false,
      allow_symbol_change: true,
      hide_side_toolbar: false,
      withdateranges: true,
      save_image: false,
      calendar: false,
      studies: [
        "STD;EMA",
        "STD;VWAP",
        "STD;RSI"
      ],
      support_host: "https://www.tradingview.com",
    });

    containerRef.current.appendChild(script);
  }, [selectedSymbol, selectedInterval]);

  return (
    <div className="glass-panel rounded-2xl p-3 sm:p-4 shadow-2xl flex flex-col h-[420px] sm:h-[480px] lg:h-[560px] border border-slate-800/80 bg-slate-950/70">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80 mb-3">
        {/* Title & Scalping Badge */}
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 shrink-0">
            <Zap className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white tracking-wide">
                Live High-Definition Execution Chart
              </h2>
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                1M Scalper Active
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Institutional real-time tick streaming with EMA 9/21/50 & VWAP overlays</p>
          </div>
        </div>

        {/* Controls: Symbol & Timeframe selectors */}
        <div className="flex flex-wrap items-center gap-2 overflow-x-auto max-w-full pb-1">
          {/* Timeframe Pill Bar */}
          <div className="flex items-center bg-slate-900/90 border border-slate-800 rounded-xl p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.interval}
                onClick={() => setSelectedInterval(tf.interval)}
                className={`px-2 sm:px-2.5 py-1 text-xs rounded-lg font-bold transition-all ${
                  selectedInterval === tf.interval
                    ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-sm shadow-cyan-500/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          {/* Symbol Selector */}
          <div className="flex items-center bg-slate-900/90 border border-slate-800 rounded-xl p-0.5">
            {SUPPORTED_SYMBOLS.map((s) => (
              <button
                key={s.tvSymbol}
                onClick={() => setSelectedSymbol(s.tvSymbol)}
                className={`px-2 sm:px-3 py-1 text-xs rounded-lg font-bold transition-all ${
                  selectedSymbol === s.tvSymbol
                    ? s.isGold
                      ? "bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black shadow-sm shadow-amber-500/40"
                      : "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* TradingView Widget Container */}
      <div className="w-full flex-1 rounded-xl overflow-hidden relative border border-slate-800/60 bg-[#030712]">
        <div
          ref={containerRef}
          className="tradingview-widget-container h-full w-full"
          style={{ height: "100%", width: "100%" }}
        />
      </div>
    </div>
  );
}
