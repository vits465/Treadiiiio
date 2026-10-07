// dashboard/app/components/LiveScalpTerminal.tsx
"use client";

import React, { useState, useEffect } from "react";
import { Zap, ShieldCheck, ArrowUpRight, ArrowDownRight, Activity, AlertTriangle, Lock, RefreshCw } from "lucide-react";
import { executeManualTrade, closeManualTrade, getOpenPositions, Position } from "../../lib/api-client";
import { sounds, sendDesktopNotification } from "../../lib/audioNotifier";

interface LiveScalpTerminalProps {
  onRefresh: () => void;
  openPositions: Position[];
}

export function LiveScalpTerminal({ onRefresh, openPositions }: LiveScalpTerminalProps) {
  const [livePrice, setLivePrice] = useState<{ bid: number; ask: number; spread: number; instrument: string }>({
    bid: 4165.50,
    ask: 4165.75,
    spread: 2.5,
    instrument: "XAU/USD"
  });
  const [executing, setExecuting] = useState(false);
  const [lockingBE, setLockingBE] = useState(false);

  // Poll live quote from MT5 / API
  useEffect(() => {
    let active = true;
    const fetchQuote = async () => {
      try {
        const res = await fetch("/api/bot/quote?instrument=XAU/USD");
        if (res.ok) {
          const data = await res.json();
          if (active && data.bid && data.ask) {
            const spreadPips = ((data.ask - data.bid) / 0.01);
            setLivePrice({
              bid: data.bid,
              ask: data.ask,
              spread: Math.round(spreadPips * 10) / 10,
              instrument: data.instrument || "XAU/USD"
            });
          }
        }
      } catch (e) {
        // Fallback or quiet catch
      }
    };

    fetchQuote();
    const timer = setInterval(fetchQuote, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const handleInstantScalp = async (side: "BUY" | "SELL") => {
    setExecuting(true);
    try {
      await executeManualTrade("XAU/USD", side);
      sounds.playTradeOpened();
      sendDesktopNotification("⚡ Scalp Executed", `1M Scalp ${side} opened on XAU/USD with 1:2 RRR`);
      onRefresh();
    } catch (e: any) {
      alert("Scalp execution error: " + (e.message || e));
    } finally {
      setExecuting(false);
    }
  };

  const handleLockAllBreakEven = async () => {
    setLockingBE(true);
    try {
      const res = await fetch("/api/bot/lock-breakeven", { method: "POST" });
      if (res.ok) {
        sounds.playTradeWin();
        alert("🛡️ All active positions with profit have been locked to Break-Even (+2 pips)!");
      } else {
        alert("No eligible positions in sufficient profit to move to break-even yet.");
      }
      onRefresh();
    } catch (e: any) {
      alert("Break-Even error: " + e.message);
    } finally {
      setLockingBE(false);
    }
  };

  const spreadQuality = 
    livePrice.spread <= 2.5 ? { text: "EXCELLENT", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" } :
    livePrice.spread <= 3.8 ? { text: "ACCEPTABLE", color: "text-amber-400 bg-amber-500/10 border-amber-500/30" } :
    { text: "HIGH SPREAD", color: "text-rose-400 bg-rose-500/10 border-rose-500/30" };

  return (
    <div className="glass-panel-gold rounded-2xl p-4 sm:p-5 shadow-2xl relative overflow-hidden">
      {/* Background radial glow */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-amber-500/20">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 shadow-sm shadow-amber-500/20">
            <Zap className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-extrabold text-white tracking-wide">
                Instant 1-Minute Scalper Console
              </h3>
              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                Institutional 1:2 RRR
              </span>
            </div>
            <p className="text-xs text-slate-400">Direct order flow execution with automated ATR stop-loss and trailing profit lock</p>
          </div>
        </div>

        {/* Live Spread & Ticker Pill */}
        <div className="flex items-center gap-2">
          <div className={`px-2.5 py-1 rounded-xl text-xs font-bold border flex items-center gap-1.5 ${spreadQuality.color}`}>
            <Activity className="w-3.5 h-3.5" />
            <span>Spread: {livePrice.spread.toFixed(1)} pips ({spreadQuality.text})</span>
          </div>

          <button
            onClick={handleLockAllBreakEven}
            disabled={lockingBE || openPositions.length === 0}
            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm shadow-indigo-500/20"
            title="Lock all profitable positions at Entry + 2 pips"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Lock Break-Even</span>
          </button>
        </div>
      </div>

      {/* Main Execution Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 items-center">
        {/* Price Feed Display */}
        <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">XAU/USD Bid Price</div>
            <div className="text-2xl font-black font-mono-num text-rose-400">
              ${livePrice.bid.toFixed(2)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">XAU/USD Ask Price</div>
            <div className="text-2xl font-black font-mono-num text-emerald-400">
              ${livePrice.ask.toFixed(2)}
            </div>
          </div>
        </div>

        {/* 1-Click Scalp BUY Button */}
        <button
          onClick={() => handleInstantScalp("BUY")}
          disabled={executing}
          className="group relative overflow-hidden p-4 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-slate-950 font-black transition-all shadow-lg shadow-emerald-500/25 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-950/40 text-emerald-200">
              <ArrowUpRight className="w-5 h-5 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-transform" />
            </div>
            <div className="text-left">
              <div className="text-sm font-black text-white tracking-wide">SCALP BUY</div>
              <div className="text-[11px] font-bold text-emerald-100/90">SL: 15p | TP: 30p (1:2 RRR)</div>
            </div>
          </div>
          <div className="text-right font-mono-num text-sm text-emerald-100 font-bold">
            ${livePrice.ask.toFixed(2)}
          </div>
        </button>

        {/* 1-Click Scalp SELL Button */}
        <button
          onClick={() => handleInstantScalp("SELL")}
          disabled={executing}
          className="group relative overflow-hidden p-4 rounded-xl bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 text-white font-black transition-all shadow-lg shadow-rose-500/25 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-950/40 text-rose-200">
              <ArrowDownRight className="w-5 h-5 group-hover:translate-y-0.5 group-hover:translate-x-0.5 transition-transform" />
            </div>
            <div className="text-left">
              <div className="text-sm font-black text-white tracking-wide">SCALP SELL</div>
              <div className="text-[11px] font-bold text-rose-100/90">SL: 15p | TP: 30p (1:2 RRR)</div>
            </div>
          </div>
          <div className="text-right font-mono-num text-sm text-rose-100 font-bold">
            ${livePrice.bid.toFixed(2)}
          </div>
        </button>
      </div>
    </div>
  );
}
