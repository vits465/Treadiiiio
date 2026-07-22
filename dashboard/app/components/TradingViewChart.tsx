// dashboard/app/components/TradingViewChart.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { LineChart, BarChart2 } from "lucide-react";

interface TradingViewChartProps {
  defaultSymbol?: string;
}

const SUPPORTED_SYMBOLS = [
  { label: "XAU/USD (Gold)", tvSymbol: "OANDA:XAUUSD" },
  { label: "EUR/USD", tvSymbol: "FX:EURUSD" },
  { label: "GBP/USD", tvSymbol: "FX:GBPUSD" },
  { label: "USD/JPY", tvSymbol: "FX:USDJPY" },
];

export function TradingViewChart({ defaultSymbol = "OANDA:XAUUSD" }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedSymbol, setSelectedSymbol] = useState(defaultSymbol);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear existing container
    containerRef.current.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: selectedSymbol,
      interval: "60",
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      enable_publishing: false,
      allow_symbol_change: true,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });

    containerRef.current.appendChild(script);
  }, [selectedSymbol]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col h-[500px]">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-emerald-400" />
          <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
            Live Technical Charting
          </h2>
        </div>

        {/* Symbol Selector */}
        <div className="flex items-center gap-2">
          {SUPPORTED_SYMBOLS.map((s) => (
            <button
              key={s.tvSymbol}
              onClick={() => setSelectedSymbol(s.tvSymbol)}
              className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                selectedSymbol === s.tvSymbol
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                  : "bg-slate-800 text-slate-400 hover:text-slate-200 border border-transparent"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* TradingView Widget Container */}
      <div className="w-full flex-1 rounded-lg overflow-hidden relative">
        <div
          ref={containerRef}
          className="tradingview-widget-container h-full w-full"
          style={{ height: "100%", width: "100%" }}
        />
      </div>
    </div>
  );
}
