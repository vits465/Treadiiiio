// dashboard/app/login/page.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { TrendingUp, ShieldCheck, AlertCircle, KeyRound } from "lucide-react";
import { motion } from "framer-motion";

export default function LoginPage() {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    // Verify key with configured environment variable or default
    const expectedKey = process.env.NEXT_PUBLIC_API_KEY || "a3f7c9d2e1b4f6a8c0d5e7f9b2a4c6d8";

    if (key === expectedKey) {
      // Save session token in localStorage
      localStorage.setItem("antigravity_session", key);
      router.push("/");
    } else {
      setError("Invalid security access token. Connection rejected.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#05070e] flex items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Background Orbs */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-[20%] left-[20%] w-[35%] h-[35%] bg-cyan-600/10 rounded-full blur-[100px]" />
        <div className="absolute bottom-[20%] right-[20%] w-[35%] h-[35%] bg-indigo-600/10 rounded-full blur-[100px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md bg-slate-900/40 border border-white/[0.06] rounded-3xl p-8 backdrop-blur-xl shadow-2xl flex flex-col items-center"
      >
        {/* Brand Logo */}
        <div className="relative group mb-6">
          <div className="absolute inset-0 bg-cyan-500 opacity-30 blur-lg rounded-full animate-pulse" />
          <div className="relative bg-gradient-to-br from-[#0f172a] to-[#1e293b] p-4 rounded-full border border-cyan-500/25">
            <TrendingUp className="h-8 w-8 text-cyan-400" />
          </div>
        </div>

        <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-cyan-400 bg-clip-text text-transparent mb-1 font-mono text-center">
          ANTIGRAVITY PORTAL
        </h1>
        <p className="text-[10px] text-cyan-500/80 font-bold tracking-widest uppercase mb-8 text-center font-mono">
          Secure Terminal Gate
        </p>

        {/* Access Form */}
        <form onSubmit={handleLogin} className="w-full space-y-5">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 tracking-widest uppercase font-mono">
              Access Secret Key
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
              <input
                type="password"
                placeholder="Enter authorization key..."
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="w-full bg-[#090d16] border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-all font-mono"
                required
              />
            </div>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-2 text-rose-400 text-xs bg-rose-500/10 border border-rose-500/20 px-3 py-2.5 rounded-xl font-mono"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-slate-950 font-bold py-3.5 rounded-xl shadow-lg transition-all transform active:scale-[0.98] flex items-center justify-center gap-2 hover:shadow-cyan-500/15"
          >
            <ShieldCheck className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wider font-mono">Authorize Session</span>
          </button>
        </form>

        <div className="mt-8 text-[9px] text-slate-500 text-center font-mono uppercase tracking-wider">
          Authorized terminals only. Activities are audited.
        </div>
      </motion.div>
    </div>
  );
}
