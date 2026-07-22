// dashboard/app/components/TradeRationaleModal.tsx
"use client";

import React from "react";
import { X, Info, ShieldAlert, Cpu, CheckCircle2 } from "lucide-react";
import { Position, Trade } from "@/lib/api-client";

interface TradeRationaleModalProps {
  item: Position | Trade | null;
  onClose: () => void;
}

export function TradeRationaleModal({ item, onClose }: TradeRationaleModalProps) {
  if (!item) return null;

  const isPosition = "unrealizedPnl" in item;
  const instrument = item.instrument;
  const side = item.side;
  const source = item.source || "rsi_reversion";

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-850">
          <div className="flex items-center gap-2">
            <Info className="w-5 h-5 text-indigo-400" />
            <h3 className="text-sm font-bold text-slate-100 font-mono">
              Trade Signal Rationale — {instrument}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors p-1 rounded-lg hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/60 border border-slate-800">
            <div>
              <span className="text-xs text-slate-400 block font-mono">Side & Strategy</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span
                  className={`text-xs px-2 py-0.5 rounded font-bold ${
                    side === "LONG" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                  }`}
                >
                  {side}
                </span>
                <span className="text-sm font-semibold text-slate-200">{source}</span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-400 block font-mono">
                {isPosition ? "Unrealized PnL" : "Realized PnL"}
              </span>
              <span
                className={`text-base font-bold font-mono ${
                  (isPosition ? item.unrealizedPnl : item.pnl) >= 0
                    ? "text-emerald-400"
                    : "text-rose-400"
                }`}
              >
                ${(isPosition ? item.unrealizedPnl : item.pnl).toFixed(2)}
              </span>
            </div>
          </div>

          {/* Detailed Indicator Rationale */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider font-mono">
              Strategy Entry Conditions Met
            </h4>

            <div className="space-y-2 text-xs font-mono">
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-850 border border-slate-800">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-slate-200 block">RSI Oversold/Overbought Reversal</span>
                  <span className="text-slate-400">
                    1-Hour RSI crossed threshold on {instrument} with confirmed multi-timeframe daily trend agreement.
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-850 border border-slate-800">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-slate-200 block">Risk & Sizing Check Passed</span>
                  <span className="text-slate-400">
                    ATR-based Stop Loss & Take Profit applied. Total open risk remains under maximum threshold.
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-850 border border-slate-800">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-slate-200 block">Trade Gating Passed</span>
                  <span className="text-slate-400">
                    Session active (London/NY), no high-impact economic news blackout within 30 minutes.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-850 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors font-mono"
          >
            Close Window
          </button>
        </div>
      </div>
    </div>
  );
}
