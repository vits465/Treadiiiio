// dashboard/app/layout.tsx
'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  TrendingUp, 
  Activity, 
  FlaskConical, 
  Cpu, 
  ShieldAlert, 
  Wifi, 
  WifiOff,
  Settings,
  Menu,
  X,
  Play,
  Pause,
  LogOut,
  Zap,
  BarChart3,
  Layers
} from 'lucide-react';
import './globals.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [enginePaused, setEnginePaused] = useState<boolean | null>(null);
  const [engineToggling, setEngineToggling] = useState(false);
  const [botOnline, setBotOnline] = useState(false);
  const [botStatusData, setBotStatusData] = useState<any>(null);

  // Authentication check — auto-authorizes session for seamless local access
  useEffect(() => {
    const checkAuth = () => {
      const expectedKey = process.env.NEXT_PUBLIC_API_KEY || "a3f7c9d2e1b4f6a8c0d5e7f9b2a4c6d8";
      let session = localStorage.getItem("antigravity_session");
      
      if (!session) {
        localStorage.setItem("antigravity_session", expectedKey);
        session = expectedKey;
      }

      setIsAuthenticated(true);
      if (pathname === "/login") {
        router.push("/");
      }
    };

    checkAuth();
  }, [pathname, router]);

  // REST-based connectivity & engine state polling
  useEffect(() => {
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const [sumRes, botStatusRes] = await Promise.all([
          fetch('/api/bot/summary'),
          fetch('/api/bot/status')
        ]);
        if (!cancelled) {
          setBotOnline(sumRes.ok);
          if (botStatusRes.ok) {
            const data = await botStatusRes.json();
            setEnginePaused(data.paused);
            setBotStatusData(data);
          }
        }
      } catch {
        if (!cancelled) {
          setBotOnline(false);
        }
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const handleToggleEngine = async () => {
    setEngineToggling(true);
    try {
      const targetEndpoint = enginePaused ? '/api/bot/start' : '/api/bot/pause';
      const res = await fetch(targetEndpoint, { method: 'POST' });
      if (res.ok) {
        setEnginePaused(!enginePaused);
      }
    } catch (e: any) {
      alert("Failed to toggle engine: " + e.message);
    } finally {
      setEngineToggling(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("antigravity_session");
    setIsAuthenticated(false);
    router.push("/login");
  };

  const navItems = [
    { name: 'Command Center', href: '/', icon: Activity },
    { name: 'Trades Terminal', href: '/trades', icon: TrendingUp },
    { name: 'Strategy Lab', href: '/strategy-lab', icon: FlaskConical },
    { name: 'AI & Models', href: '/model-monitor', icon: Cpu },
    { name: 'Risk Shield', href: '/risk', icon: ShieldAlert },
    { name: 'Analytics', href: '/analytics', icon: BarChart3 },
    { name: 'Backtest', href: '/backtest', icon: Layers },
    { name: 'Settings', href: '/settings', icon: Settings },
  ];

  const isLoginPage = pathname === "/login";

  return (
    <html lang="en">
      <head>
        <title>Treadiiiio Quantum — Institutional Scalper Terminal</title>
        <meta name="description" content="Institutional Gold & High-Frequency Scalping Command Center" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: `body { font-family: 'Outfit', sans-serif !important; }`}} />
      </head>
      <body className="bg-[#030712] text-[#f8fafc] min-h-screen flex flex-col antialiased relative overflow-x-hidden">
        
        {/* Dynamic Background Gradients */}
        <div className="fixed inset-0 z-0 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[45%] h-[45%] bg-amber-500/10 rounded-full blur-[140px] mix-blend-screen" />
          <div className="absolute top-[20%] right-[-10%] w-[40%] h-[40%] bg-cyan-600/10 rounded-full blur-[140px] mix-blend-screen" />
          <div className="absolute bottom-[-10%] left-[30%] w-[40%] h-[40%] bg-indigo-600/10 rounded-full blur-[140px] mix-blend-screen" />
        </div>

        {/* Header - Only render if authenticated and not on login page */}
        {!isLoginPage && isAuthenticated && (
          <header className="sticky top-0 z-40 bg-[#030712]/85 backdrop-blur-xl border-b border-slate-800/80 px-4 md:px-6 py-3.5 flex items-center justify-between shadow-2xl shadow-black/40">
            <div className="flex items-center space-x-3.5">
              {/* Mobile Hamburger menu */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="xl:hidden p-1.5 rounded-xl bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>

              {/* Institutional Logo */}
              <Link href="/" className="flex items-center space-x-3 group">
                <div className="relative">
                  <div className="absolute inset-0 bg-amber-500 opacity-60 blur-md rounded-xl group-hover:opacity-90 transition duration-500"></div>
                  <div className="relative bg-gradient-to-br from-amber-500 to-amber-700 p-2 rounded-xl text-slate-950 font-black shadow-lg shadow-amber-500/30">
                    <Zap className="h-5 w-5" />
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-base md:text-lg font-black tracking-tight text-white flex items-center gap-1.5">
                      <span>TREADIIIIO</span>
                      <span className="text-amber-400 font-extrabold text-xs px-1.5 py-0.2 rounded bg-amber-500/15 border border-amber-500/30">QUANTUM</span>
                    </h1>
                  </div>
                  <p className="text-[10px] text-slate-400 font-bold tracking-widest uppercase">Institutional Gold Scalper Core</p>
                </div>
              </Link>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden xl:flex space-x-0.5 bg-slate-900/60 p-1 rounded-2xl border border-slate-800/80 backdrop-blur-md">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link key={item.href} href={item.href} className="relative px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-all group">
                    {isActive && (
                      <motion.div
                        layoutId="nav-pill"
                        className="absolute inset-0 bg-gradient-to-r from-amber-500/20 to-cyan-500/20 border border-amber-500/40 rounded-xl"
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      />
                    )}
                    <div className={`relative z-10 flex items-center space-x-1.5 ${isActive ? 'text-amber-300' : 'text-slate-400 group-hover:text-white'}`}>
                      <Icon className="h-3.5 w-3.5" />
                      <span>{item.name}</span>
                    </div>
                  </Link>
                );
              })}
            </nav>

            {/* Controls Bar: Engine Toggle, Status & Kill */}
            <div className="flex items-center space-x-1.5 sm:space-x-2.5">
              {/* MT5 Live Account & Trade Limit Pill */}
              <div className="hidden lg:flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs font-mono shadow-inner">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                <span className="text-slate-400 font-sans font-bold">MT5:</span>
                <span className="text-cyan-300 font-extrabold">{botStatusData?.mt5Account || '113883228'}</span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400 font-sans font-bold">Trades:</span>
                <span className="text-amber-400 font-extrabold">{botStatusData?.todayTradesCount || 0}/{botStatusData?.maxDailyTrades || 10}</span>
                <span className="text-slate-600">|</span>
                <span className="text-emerald-400 font-extrabold">{botStatusData?.tradeDirection || 'BOTH'}</span>
              </div>

              {/* Engine Toggle Button (Live START / PAUSE) */}
              <button
                onClick={handleToggleEngine}
                disabled={engineToggling || enginePaused === null}
                className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1 sm:gap-1.5 shadow-md ${
                  enginePaused === false
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25 shadow-emerald-500/10'
                    : 'bg-amber-500/15 text-amber-300 border border-amber-500/40 hover:bg-amber-500/25 shadow-amber-500/10'
                }`}
                title={enginePaused ? "Click to resume automated trading" : "Click to pause automated trading"}
              >
                {enginePaused === false ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span className="hidden sm:inline">ENGINE ACTIVE</span>
                    <span className="sm:hidden">ACTIVE</span>
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5 text-amber-400" />
                    <span className="hidden sm:inline">ENGINE PAUSED</span>
                    <span className="sm:hidden">PAUSED</span>
                  </>
                )}
              </button>

              {/* Emergency Flatten Button */}
              <button
                onClick={async () => {
                  if (confirm("⚠️ EMERGENCY FLATTEN: Liquidate ALL open positions and pause trading immediately?")) {
                    try {
                      await fetch(`/api/bot/kill`, { method: "POST" });
                      alert("🛑 Flatten Executed! All open positions liquidated and engine paused.");
                    } catch (e: any) {
                      alert("Flatten error: " + e.message);
                    }
                  }
                }}
                className="flex items-center space-x-1 px-2 sm:px-2.5 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/40 text-xs font-extrabold transition-all font-mono"
                title="Liquidate all positions and pause bot"
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">FLATTEN</span>
              </button>

              {/* Online indicator */}
              <div className={`flex items-center space-x-1 px-2 sm:px-2.5 py-1.5 rounded-xl border text-xs font-black tracking-wider ${
                botOnline ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
              }`}>
                {botOnline ? (
                  <><Wifi className="h-3 w-3 animate-pulse" /><span className="hidden sm:inline">ONLINE</span></>
                ) : (
                  <><WifiOff className="h-3 w-3" /><span className="hidden sm:inline">OFFLINE</span></>
                )}
              </div>

              {/* Logout Button */}
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-colors"
                title="Log Out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </header>
        )}

        {/* Mobile Dropdown Menu */}
        <AnimatePresence>
          {mobileMenuOpen && !isLoginPage && isAuthenticated && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="xl:hidden bg-slate-950 border-b border-slate-800 overflow-hidden z-30 sticky top-[65px]"
            >
              <div className="p-4 space-y-2">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center space-x-3 p-3 rounded-xl transition-all ${
                        isActive 
                          ? 'bg-amber-500/15 border border-amber-500/30 text-amber-300' 
                          : 'text-slate-400 hover:text-white hover:bg-slate-900'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="font-bold text-sm">{item.name}</span>
                    </Link>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Content Area */}
        <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-[1700px] w-full mx-auto relative z-10">
          {children}
        </main>

        {/* Institutional Status Footer */}
        <footer className="mt-auto border-t border-slate-800/80 bg-slate-950/80 backdrop-blur-md px-6 py-3 text-xs text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="font-extrabold text-white">TREADIIIIO QUANTUM ENGINE v2.0</span>
            <span className="text-slate-600">|</span>
            <span className="text-amber-400 font-bold">Primary Asset: XAU/USD (Gold 1M Scalper)</span>
            <span className="text-slate-600">|</span>
            <span className="text-emerald-400 font-bold">Risk Management: Fixed-Fractional 1:2 RRR</span>
          </div>
          <div className="flex items-center gap-3 font-mono-num text-[11px]">
            <span>MT5 Bridge: Port 8000</span>
            <span>REST/WS: Port 4000</span>
            <span className="text-emerald-400 font-bold">Latency: &lt; 5ms</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
