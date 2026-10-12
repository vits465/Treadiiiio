// dashboard/app/login/page.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Zap, 
  ShieldCheck, 
  AlertCircle, 
  Lock, 
  User, 
  Eye, 
  EyeOff, 
  Activity,
  Terminal,
  Cpu
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { validateCredentials, createSession, getSession, clearSession } from '../../lib/auth';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [logoutNotice, setLogoutNotice] = useState(false);
  const router = useRouter();

  // Handle logout query param and check existing session
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('logout') === 'true') {
        clearSession();
        setLogoutNotice(true);
        return;
      }
    }
    if (getSession()) {
      router.push('/');
    }
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Small delay for smooth institutional auth feel
    await new Promise((r) => setTimeout(r, 400));

    if (validateCredentials(username, password)) {
      createSession(username.trim());
      // Auto-set the legacy API key for background REST queries
      localStorage.setItem(
        'antigravity_session',
        process.env.NEXT_PUBLIC_API_KEY || 'a3f7c9d2e1b4f6a8c0d5e7f9b2a4c6d8'
      );
      router.push('/');
    } else {
      setError('Invalid operator credentials. Access denied.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100 flex items-center justify-center p-4 relative overflow-hidden font-sans select-none">
      {/* Dynamic Background Glows */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-[15%] left-[20%] w-[450px] h-[450px] bg-amber-500/10 rounded-full blur-[140px] mix-blend-screen" />
        <div className="absolute bottom-[15%] right-[20%] w-[450px] h-[450px] bg-cyan-600/10 rounded-full blur-[140px] mix-blend-screen" />
        <div className="absolute top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-indigo-600/5 rounded-full blur-[160px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-md bg-slate-900/50 border border-slate-800/90 rounded-3xl p-6 sm:p-8 backdrop-blur-2xl shadow-2xl shadow-black/80 flex flex-col"
      >
        {/* Terminal Header & Branding */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="relative group mb-4">
            <div className="absolute inset-0 bg-amber-500 opacity-40 blur-xl rounded-2xl group-hover:opacity-75 transition duration-500" />
            <div className="relative bg-gradient-to-br from-amber-500 to-amber-700 p-3.5 rounded-2xl text-slate-950 font-black shadow-xl shadow-amber-500/20 border border-amber-400/30">
              <Zap className="h-7 w-7" />
            </div>
          </div>

          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-1.5 font-sans">
              <span>TREADIIIIO</span>
              <span className="text-amber-400 font-extrabold text-xs px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30">
                QUANTUM
              </span>
            </h1>
          </div>
          <p className="text-[11px] text-slate-400 font-bold tracking-widest uppercase flex items-center gap-1.5 font-mono">
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            Operator Security Gateway
          </p>
        </div>

        {/* Live System Indicator */}
        <div className="mb-6 p-2.5 rounded-2xl bg-slate-950/70 border border-slate-800/80 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] text-slate-300 font-bold">Voroa Cloud Engine</span>
          </div>
          <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-md border border-cyan-500/20">
            256-BIT SECURE
          </span>
        </div>

        {/* Access Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          {/* Username Input */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-300 tracking-wider uppercase flex items-center gap-1.5 font-mono">
              <User className="w-3.5 h-3.5 text-amber-400" />
              Username
            </label>
            <div className="relative">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter operator username"
                autoComplete="username"
                autoFocus
                required
                className="w-full bg-[#050814] border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all font-mono"
              />
            </div>
          </div>

          {/* Password Input */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-300 tracking-wider uppercase flex items-center gap-1.5 font-mono">
              <Lock className="w-3.5 h-3.5 text-amber-400" />
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter secret password"
                autoComplete="current-password"
                required
                className="w-full bg-[#050814] border border-slate-800 rounded-xl px-4 py-3 pr-11 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Remember Me Checkbox */}
          <div className="flex items-center justify-between text-xs pt-1">
            <label className="flex items-center gap-2 cursor-pointer text-slate-400 hover:text-slate-300">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="rounded border-slate-800 bg-[#050814] text-amber-500 focus:ring-0 focus:ring-offset-0"
              />
              <span>Remember session</span>
            </label>
            <span className="text-[10px] text-slate-500 font-mono">Operator ID: #001</span>
          </div>

          {/* Logout Success Notice */}
          <AnimatePresence>
            {logoutNotice && !error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="flex items-center gap-2.5 text-emerald-400 text-xs bg-emerald-500/10 border border-emerald-500/25 p-3 rounded-xl font-mono"
              >
                <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>Session safely terminated. Operator logged out.</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error Notice */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="flex items-center gap-2.5 text-rose-400 text-xs bg-rose-500/10 border border-rose-500/25 p-3 rounded-xl font-mono"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 hover:from-amber-400 hover:to-amber-600 text-slate-950 font-black py-3.5 rounded-xl shadow-lg shadow-amber-500/20 transition-all transform active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs uppercase tracking-wider font-mono">Verifying...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                <span className="text-xs uppercase tracking-wider font-mono">Authorize Terminal</span>
              </>
            )}
          </button>
        </form>

        {/* Security Footnote */}
        <div className="mt-6 pt-5 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-500 font-mono">
          <div className="flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-slate-600" />
            <span>Treadiiiio v2.0</span>
          </div>
          <span>Cloud Authenticated</span>
        </div>
      </motion.div>
    </div>
  );
}
