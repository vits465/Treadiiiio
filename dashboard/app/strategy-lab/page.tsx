'use client';

import React, { useState, useEffect } from 'react';
import { getStrategies, setStrategyEnabled, StrategyToggle, connectLiveFeed } from '../../lib/api-client';
import { 
  Play, 
  Square, 
  FlaskConical, 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  AlertCircle
} from 'lucide-react';

export default function StrategyLabPage() {
  const [strategies, setStrategies] = useState<StrategyToggle[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchStrategiesList = async () => {
    try {
      const data = await getStrategies();
      setStrategies(data);
    } catch (e) {
      console.error("Failed to load strategies:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStrategiesList();
    const interval = setInterval(fetchStrategiesList, 2000);

    // Re-fetch totals when a trade completes
    const disconnect = connectLiveFeed((event) => {
      if (event.type === 'trade_closed') {
        fetchStrategiesList();
      }
    });

    return () => {
      clearInterval(interval);
      disconnect();
    };
  }, []);

  const handleToggle = async (name: string, currentEnabled: boolean) => {
    setActionLoading(name);
    try {
      await setStrategyEnabled(name, !currentEnabled);
      setStrategies(prev => 
        prev.map(s => s.name === name ? { ...s, enabled: !currentEnabled } : s)
      );
    } catch (e) {
      console.error("Failed to toggle strategy:", e);
    } finally {
      setActionLoading(null);
    }
  };

  const getStrategyDescription = (name: string) => {
    switch (name) {
      case 'ma_crossover':
        return 'Trend Following: Moving Average Crossover (SMA 9 vs. SMA 21). Signals BUY when fast crosses above slow, and SELL when fast crosses below slow.';
      case 'rsi_reversion':
        return 'Mean Reversion: Wilder\'s RSI (14). Signals BUY when exiting oversold (<30) and SELL when exiting overbought (>70). Closes on opposite extreme.';
      case 'bollinger_bands':
        return 'Mean Reversion: Bollinger Bands (20, 2). Signals BUY when close breaks below lower band, SELL when close breaks above upper band. Closes at middle SMA.';
      case 'ml_signal':
        return 'Machine Learning: XGBoost Gradient Boosted Trees model. Computes features from previous indicators + returns probabilities for BUY/SELL/HOLD.';
      default:
        return 'Standard technical indicators based signal logic.';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Strategy Control Lab</h2>
        <p className="text-slate-500 text-sm font-medium">Activate or deactivate specific rules-based strategies and compare their performance side-by-side.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-cyan-400"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {strategies.map((strat) => {
            const isWin = strat.pnl >= 0;
            return (
              <div 
                key={strat.name} 
                className={`glass-panel rounded-2xl p-6 border ${
                  strat.enabled 
                    ? 'border-cyan-500/25 bg-[#0f172a]/30' 
                    : 'border-slate-800/60 opacity-60'
                }`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center space-x-3">
                    <div className={`p-2.5 rounded-xl border ${
                      strat.enabled 
                        ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400' 
                        : 'bg-slate-900 border-slate-800 text-slate-500'
                    }`}>
                      <FlaskConical className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white tracking-wide uppercase">{strat.name.replace('_', ' ')}</h3>
                      <div className="flex items-center space-x-1.5 mt-0.5">
                        <span className={`h-2 w-2 rounded-full ${strat.enabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`}></span>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                          {strat.enabled ? 'Active running' : 'Disabled / Sleeping'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleToggle(strat.name, strat.enabled)}
                    disabled={actionLoading !== null}
                    className={`flex items-center space-x-1.5 text-xs font-bold px-3 py-2 rounded-lg transition-all border ${
                      strat.enabled
                        ? 'bg-rose-950/20 border-rose-500/20 hover:bg-rose-950/40 text-rose-400'
                        : 'bg-emerald-950/20 border-emerald-500/20 hover:bg-emerald-950/40 text-emerald-400'
                    }`}
                  >
                    {actionLoading === strat.name ? (
                      <div className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-current"></div>
                    ) : strat.enabled ? (
                      <>
                        <Square className="h-3 w-3 fill-current" />
                        <span>HALT STRATEGY</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-3 w-3 fill-current" />
                        <span>RUN STRATEGY</span>
                      </>
                    )}
                  </button>
                </div>

                <p className="text-xs text-slate-400 font-medium leading-relaxed mb-6 min-h-[40px]">
                  {getStrategyDescription(strat.name)}
                </p>

                {/* Metrics Breakdown */}
                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-800/40">
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Trades Count</span>
                    <p className="text-lg font-black text-white">{strat.trades}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Win Rate</span>
                    <p className="text-lg font-black text-white">
                      {typeof strat.winRate === 'number' && !isNaN(strat.winRate) ? `${strat.winRate.toFixed(1)}%` : '0.0%'}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Realized PnL</span>
                    <div className="flex items-center space-x-1">
                      {strat.trades > 0 ? (
                        isWin ? (
                          <TrendingUp className="h-4.5 w-4.5 text-emerald-400" />
                        ) : (
                          <TrendingDown className="h-4.5 w-4.5 text-rose-400" />
                        )
                      ) : (
                        <Activity className="h-4.5 w-4.5 text-slate-600" />
                      )}
                      <p className={`text-lg font-black ${strat.trades > 0 ? (isWin ? 'text-emerald-400' : 'text-rose-400') : 'text-slate-400'}`}>
                        {isWin ? '+' : ''}${(strat.pnl ?? 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Warning Box */}
      <div className="bg-amber-950/20 border border-amber-500/20 rounded-xl p-5 flex items-start space-x-3.5">
        <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <h4 className="text-sm font-bold text-amber-400">Isolated Sandbox Execution</h4>
          <p className="text-xs text-slate-400 font-medium leading-relaxed mt-1">
            Each strategy runs in its own sub-portfolio container. They will execute trade sizes sized against the global balance, but operate independently. This allows you to perform side-by-side forward testing of multiple models under identical pricing and slippage conditions.
          </p>
        </div>
      </div>
    </div>
  );
}
