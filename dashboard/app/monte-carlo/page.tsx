'use client';

import React, { useState } from 'react';
import { Play, Activity, ShieldAlert, Target } from 'lucide-react';
import { motion } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function MonteCarloPage() {
  const [running, setRunning] = useState(false);
  const [target, setTarget] = useState(300);
  const [trades, setTrades] = useState(200);
  const [results, setResults] = useState<any>(null);
  const [chartData, setChartData] = useState<any[]>([]);

  const runSimulation = async () => {
    setRunning(true);
    setResults(null);
    try {
      const res = await fetch(`/api/bot/monte-carlo?target=${target}&trades=${trades}`);
      const data = await res.json();
      
      setResults({
        targetProbability: data.targetProbability,
        circuitBreakerProbability: data.circuitBreakerProbability,
      });

      // Format data for Recharts
      if (data.medianCurve) {
        const formatted = data.medianCurve.map((val: number, i: number) => ({
          trade: i,
          Median: val,
          '95th Percentile': data.p95Curve[i],
          '5th Percentile': data.p5Curve[i],
        }));
        setChartData(formatted);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRunning(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between space-y-2 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Monte Carlo Reality Check</h2>
          <p className="text-slate-500 text-sm font-medium">Probabilistic modeling of account equity based on historical trades.</p>
        </div>
      </div>

      <div className="glass-panel p-6 rounded-2xl border border-[#1e293b]">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400">Target Balance ($)</label>
            <input 
              type="number"
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
              className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-white outline-none focus:border-cyan-500 transition-colors"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-400">Number of Trades</label>
            <input 
              type="number"
              value={trades}
              onChange={(e) => setTrades(Number(e.target.value))}
              className="w-full bg-[#0f172a] border border-[#1e293b] rounded-lg px-3 py-2 text-white outline-none focus:border-cyan-500 transition-colors"
            />
          </div>
          
          <div className="flex items-end">
            <button 
              onClick={runSimulation}
              disabled={running}
              className="w-full bg-cyan-500 hover:bg-cyan-400 text-[#060911] font-bold py-2 px-4 rounded-lg flex items-center justify-center space-x-2 transition-all disabled:opacity-50"
            >
              {running ? <Activity className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              <span>{running ? 'Simulating...' : 'Run Simulation'}</span>
            </button>
          </div>
        </div>
      </div>

      {results && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          <div className="glass-panel p-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Probability of Hitting Target</span>
              <Target className="h-4 w-4 text-emerald-400" />
            </div>
            <p className="text-3xl font-bold text-emerald-400">{results.targetProbability}%</p>
          </div>
          
          <div className="glass-panel p-5 rounded-xl border border-rose-500/20 bg-rose-500/5">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Probability of Ruin / Circuit Breaker</span>
              <ShieldAlert className="h-4 w-4 text-rose-400" />
            </div>
            <p className="text-3xl font-bold text-rose-400">{results.circuitBreakerProbability}%</p>
          </div>
        </motion.div>
      )}

      {chartData.length > 0 && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel p-6 rounded-2xl border border-[#1e293b]"
        >
          <h3 className="text-lg font-bold text-white mb-6">Equity Curve Distribution</h3>
          <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="trade" stroke="#64748b" tick={{ fill: '#64748b' }} />
                <YAxis stroke="#64748b" tick={{ fill: '#64748b' }} domain={['auto', 'auto']} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#fff' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Legend />
                <Line type="monotone" dataKey="95th Percentile" stroke="#10b981" strokeDasharray="5 5" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="Median" stroke="#06b6d4" dot={false} strokeWidth={3} />
                <Line type="monotone" dataKey="5th Percentile" stroke="#f43f5e" strokeDasharray="5 5" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
