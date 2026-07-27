// dashboard/app/components/ProfitProgressRing.tsx
"use client";

import React from "react";
import { Target, TrendingUp, Award } from "lucide-react";

interface ProfitProgressRingProps {
  currentProfit: number;
  targetProfit?: number;
}

export function ProfitProgressRing({
  currentProfit = 0,
  targetProfit = 35,
}: ProfitProgressRingProps) {
  const safeCurrent = typeof currentProfit === 'number' && !isNaN(currentProfit) ? currentProfit : 0;
  const safeTarget = typeof targetProfit === 'number' && !isNaN(targetProfit) && targetProfit > 0 ? targetProfit : 35;
  const percentage = Math.min(100, Math.max(0, (safeCurrent / safeTarget) * 100));
  const strokeDashoffset = 283 - (283 * percentage) / 100;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col justify-between">
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-emerald-400" />
          <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
            Daily Target Goal
          </h2>
        </div>
        <span className="text-xs text-slate-400 font-mono">${safeTarget.toFixed(0)} Goal</span>
      </div>

      <div className="flex items-center justify-around py-4">
        {/* SVG Circular Ring */}
        <div className="relative w-28 h-28 flex items-center justify-center">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
            {/* Background Ring */}
            <circle
              cx="50"
              cy="50"
              r="45"
              className="stroke-slate-800"
              strokeWidth="8"
              fill="transparent"
            />
            {/* Progress Ring */}
            <circle
              cx="50"
              cy="50"
              r="45"
              className="stroke-emerald-400 transition-all duration-700 ease-out"
              strokeWidth="8"
              strokeDasharray="283"
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              fill="transparent"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-xl font-bold font-mono text-emerald-400">
              {percentage.toFixed(0)}%
            </span>
            <span className="text-[10px] text-slate-400 font-medium">REACHED</span>
          </div>
        </div>

        {/* Stats Summary */}
        <div className="flex flex-col gap-2">
          <div>
            <span className="text-[11px] text-slate-400 uppercase font-mono block">Today PnL</span>
            <span
              className={`text-lg font-bold font-mono ${
                safeCurrent >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              ${safeCurrent.toFixed(2)}
            </span>
          </div>

          <div>
            <span className="text-[11px] text-slate-400 uppercase font-mono block">Remaining</span>
            <span className="text-sm font-semibold font-mono text-slate-300">
              ${Math.max(0, safeTarget - safeCurrent).toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-850 p-2 rounded-lg border border-slate-800 font-mono">
        <Award className="w-4 h-4 text-amber-400 flex-shrink-0" />
        <span>
          {percentage >= 100
            ? "🎉 Daily Target Locked! Profit Shield Active."
            : `${(100 - percentage).toFixed(0)}% away from daily target completion.`}
        </span>
      </div>
    </div>
  );
}
