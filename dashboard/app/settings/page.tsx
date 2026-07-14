'use client';

import React, { useState, useEffect } from 'react';
import { getBotStatus, pauseBot, startBot, restartBot, BotStatus, getConfig, updateConfig, ConfigData } from '../../lib/api-client';
import { 
  Settings,
  Play,
  Pause,
  RefreshCw,
  Server,
  Activity
} from 'lucide-react';
import { motion } from 'framer-motion';

export default function SettingsPage() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [config, setConfig] = useState<ConfigData>({
    RISK_MAX_POSITION_SIZE_PCT: 2,
    CURRENCY_PAIRS: 'EUR_USD',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_CHAT_ID: ''
  });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);

  const fetchStatus = async () => {
    try {
      const [botData, configData] = await Promise.all([
        getBotStatus(),
        getConfig()
      ]);
      setStatus(botData);
      setConfig(configData);
    } catch (e) {
      console.error("Failed to fetch status:", e);
    } finally {
      setLoading(false);
      setActionLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Poll every 5 seconds to keep uptime accurate and check if restarted
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handlePause = async () => {
    setActionLoading(true);
    await pauseBot();
    await fetchStatus();
  };

  const handleStart = async () => {
    setActionLoading(true);
    await startBot();
    await fetchStatus();
  };

  const handleRestart = async () => {
    if (!window.confirm("Are you sure you want to restart the engine? The connection will be lost temporarily.")) return;
    setActionLoading(true);
    try {
      await restartBot();
    } catch (e) {
      // Expected to fail if server drops connection instantly
    }
    // Wait a few seconds for reboot before polling again
    setTimeout(() => {
      fetchStatus();
    }, 4000);
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setConfigLoading(true);
    try {
      await updateConfig(config);
      // Wait for backend to reboot
      setTimeout(() => {
        fetchStatus();
        setConfigLoading(false);
      }, 3000);
    } catch (e) {
      console.error(e);
      setConfigLoading(false);
    }
  };

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
  };

  if (false) {
    return null;
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">System Settings</h2>
          <p className="text-slate-400 text-sm font-medium mt-1">Control the core trading engine process and parameters.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Core Engine Control */}
        <div className="glass-panel rounded-3xl p-8 border border-white/[0.05] relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
          
          <div className="flex items-start justify-between mb-8 relative z-10">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-slate-800/50 rounded-2xl border border-white/[0.05]">
                <Server className="h-8 w-8 text-cyan-400" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Execution Engine</h3>
                <p className="text-sm text-slate-400 font-medium">Node.js Core Process</p>
              </div>
            </div>
            
            {status?.paused ? (
              <div className="flex items-center space-x-2 bg-amber-500/10 border border-amber-500/20 px-4 py-1.5 rounded-full">
                <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse"></div>
                <span className="text-amber-400 text-xs font-bold tracking-widest uppercase">Paused</span>
              </div>
            ) : (
              <div className="flex items-center space-x-2 bg-emerald-500/10 border border-emerald-500/20 px-4 py-1.5 rounded-full">
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></div>
                <span className="text-emerald-400 text-xs font-bold tracking-widest uppercase">Running</span>
              </div>
            )}
          </div>

          <div className="space-y-6 relative z-10">
            <div className="flex flex-col space-y-1">
              <span className="text-xs font-bold text-slate-500 tracking-widest uppercase">System Uptime</span>
              <span className="text-2xl font-mono text-slate-200">{formatUptime(status?.uptime || 0)}</span>
            </div>

            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-white/[0.05]">
              {!status?.paused ? (
                <button 
                  onClick={handlePause}
                  disabled={actionLoading}
                  className="flex flex-col items-center justify-center py-4 space-y-2 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-50 border border-amber-500/20 rounded-2xl transition-colors text-amber-400"
                >
                  <Pause className="h-6 w-6" />
                  <span className="text-xs font-bold tracking-wider">PAUSE</span>
                </button>
              ) : (
                <button 
                  onClick={handleStart}
                  disabled={actionLoading}
                  className="flex flex-col items-center justify-center py-4 space-y-2 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50 border border-emerald-500/20 rounded-2xl transition-colors text-emerald-400"
                >
                  <Play className="h-6 w-6" />
                  <span className="text-xs font-bold tracking-wider">RESUME</span>
                </button>
              )}

              <button 
                onClick={handleRestart}
                disabled={actionLoading}
                className="flex flex-col items-center justify-center py-4 space-y-2 bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 border border-rose-500/20 rounded-2xl transition-colors text-rose-400 col-span-2"
              >
                <RefreshCw className={`h-6 w-6 ${actionLoading ? 'animate-spin' : ''}`} />
                <span className="text-xs font-bold tracking-wider">REBOOT ENGINE</span>
              </button>
            </div>
            
            <p className="text-xs text-slate-500 mt-4 leading-relaxed font-medium">
              <strong className="text-amber-500/80">Note:</strong> Pausing the engine stops it from opening new positions. Active trades will still be managed and closed when they hit SL/TP.
            </p>
          </div>
        </div>

        {/* Advanced Configuration */}
        <div className="glass-panel rounded-3xl p-8 border border-white/[0.05] relative overflow-hidden flex flex-col">
          <div className="flex items-center space-x-3 mb-6">
            <Settings className="h-6 w-6 text-indigo-400" />
            <h3 className="text-xl font-bold text-white">Advanced Configuration</h3>
          </div>
          
          <form onSubmit={handleSaveConfig} className="space-y-4 flex-1">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Risk per Trade (%)</label>
              <input 
                type="number" 
                step="0.1"
                required
                value={config.RISK_MAX_POSITION_SIZE_PCT}
                onChange={e => setConfig({...config, RISK_MAX_POSITION_SIZE_PCT: parseFloat(e.target.value)})}
                className="w-full bg-slate-900/50 border border-white/[0.1] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
              />
              <p className="text-[10px] text-slate-500 mt-1 font-medium">Percentage of account balance risked per trade via Dynamic Lot Sizing.</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Active Currency Pairs</label>
              <input 
                type="text" 
                required
                value={config.CURRENCY_PAIRS}
                onChange={e => setConfig({...config, CURRENCY_PAIRS: e.target.value})}
                className="w-full bg-slate-900/50 border border-white/[0.1] rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
              />
              <p className="text-[10px] text-slate-500 mt-1 font-medium">Comma separated (e.g., EUR_USD, GBP_JPY).</p>
            </div>
            
            <div className="pt-4 border-t border-white/[0.05]">
              <h4 className="text-sm font-bold text-slate-300 mb-3">Telegram Notifications</h4>
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Bot Token</label>
                  <input 
                    type="password" 
                    value={config.TELEGRAM_BOT_TOKEN}
                    onChange={e => setConfig({...config, TELEGRAM_BOT_TOKEN: e.target.value})}
                    placeholder="123456789:ABCdefGHIjklMNO..."
                    className="w-full bg-slate-900/50 border border-white/[0.1] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Chat ID</label>
                  <input 
                    type="text" 
                    value={config.TELEGRAM_CHAT_ID}
                    onChange={e => setConfig({...config, TELEGRAM_CHAT_ID: e.target.value})}
                    placeholder="-1001234567890"
                    className="w-full bg-slate-900/50 border border-white/[0.1] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="pt-4 mt-auto">
              <button 
                type="submit"
                disabled={configLoading}
                className="w-full py-3 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-400 font-bold tracking-wider uppercase text-xs rounded-xl transition-all flex justify-center items-center space-x-2"
              >
                {configLoading ? <Activity className="h-4 w-4 animate-spin" /> : <span>Save & Reboot Engine</span>}
              </button>
            </div>
          </form>
        </div>

      </div>
    </motion.div>
  );
}
