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
  Pause, 
  LogOut, 
  Zap, 
  BarChart3, 
  Layers,
  UserCheck,
  ShieldCheck,
  Radio
} from 'lucide-react';
import { getSession, clearSession } from '../lib/auth';
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

  // Strict Authentication Guard
  useEffect(() => {
    const session = getSession();
    if (!session) {
      setIsAuthenticated(false);
      if (pathname !== '/login') {
        router.push('/login');
      }
    } else {
      setIsAuthenticated(true);
      if (pathname === '/login') {
        router.push('/');
      }
    }
  }, [pathname, router]);

  // REST connectivity & engine telemetry polling (only when authenticated)
  useEffect(() => {
    if (pathname === '/login') return;

    let cancelled = false;
    const checkHealth = async () => {
      try {
        const [sumRes, botStatusRes] = await Promise.all([
          fetch('/api/bot/summary', { cache: 'no-store' }),
          fetch('/api/bot/status', { cache: 'no-store' })
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
    const interval = setInterval(checkHealth, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pathname]);

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
    clearSession();
    setIsAuthenticated(false);
    router.push('/login');
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

  const isLoginPage = pathname === '/login';

  return (
    <html lang="en">
      <head>
        <title>Treadiiiio Quantum — Institutional Scalper Terminal</title>
        <meta name="description" content="Institutional Gold & High-Frequency Scalping Command Center" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: `body { font-family: 'Outfit', sans-serif !important; }`}} />
      </head>
      <body className="bg-[#030712] text-[#f8fafc] min-h-screen flex flex-col antialiased relative overflow-x-hidden">
        
        {/* Dynamic Background Glows */}
        <div className="fixed inset-0 z-0 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[45%] h-[45%] bg-amber-500/10 rounded-full blur-[140px] mix-blend-screen" />
          <div className="absolute top-[20%] right-[-10%] w-[40%] h-[40%] bg-cyan-600/10 rounded-full blur-[140px] mix-blend-screen" />
          <div className="absolute bottom-[-10%] left-[30%] w-[40%] h-[40%] bg-indigo-600/10 rounded-full blur-[140px] mix-blend-screen" />
        </div>

        {/* --- Case 1: Login Page View --- */}
        {isLoginPage ? (
          <main className="flex-1 relative z-10">{children}</main>
        ) : (
          /* --- Case 2: Protected Application View --- */
          <>
            {/* Authenticating Loading Screen if verifying session */}
            {isAuthenticated === null ? (
              <div className="min-h-screen flex items-center justify-center bg-[#030712] relative z-50">
                <div className="flex flex-col items-center gap-4">
                  <div className="relative">
                    <div className="absolute inset-0 bg-amber-500/40 blur-xl rounded-full animate-ping" />
                    <div className="relative bg-gradient-to-br from-amber-500 to-amber-700 p-4 rounded-2xl text-slate-950 font-black shadow-xl">
                      <Zap className="h-8 w-8 animate-pulse" />
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-black tracking-widest text-white uppercase font-mono">
                      Verifying Operator Clearance
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono mt-1">
                      Treadiiiio Quantum Gate • 256-Bit TLS
                    </div>
                  </div>
                </div>
              </div>
            ) : isAuthenticated ? (
              <>
                {/* Responsive Fixed Header */}
                <header className="sticky top-0 z-40 bg-[#030712]/90 backdrop-blur-2xl border-b border-slate-800/80 px-3 sm:px-6 py-2.5 sm:py-3.5 flex items-center justify-between shadow-2xl shadow-black/50">
                  <div className="flex items-center space-x-2 sm:space-x-3.5">
                    {/* Mobile Hamburger menu */}
                    <button
                      onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                      className="xl:hidden p-2 rounded-xl bg-slate-900 text-slate-300 hover:text-white border border-slate-800 transition-colors"
                      aria-label="Toggle navigation menu"
                    >
                      {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                    </button>

                    {/* Institutional Brand Logo */}
                    <Link href="/" className="flex items-center space-x-2.5 sm:space-x-3 group">
                      <div className="relative shrink-0">
                        <div className="absolute inset-0 bg-amber-500 opacity-60 blur-md rounded-xl group-hover:opacity-90 transition duration-500" />
                        <div className="relative bg-gradient-to-br from-amber-500 to-amber-700 p-1.5 sm:p-2 rounded-xl text-slate-950 font-black shadow-lg shadow-amber-500/30">
                          <Zap className="h-4 w-4 sm:h-5 sm:w-5" />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h1 className="text-sm sm:text-base md:text-lg font-black tracking-tight text-white flex items-center gap-1">
                            <span>TREADIIIIO</span>
                            <span className="text-amber-400 font-extrabold text-[10px] sm:text-xs px-1.5 py-0.2 rounded bg-amber-500/15 border border-amber-500/30">
                              QUANTUM
                            </span>
                          </h1>
                        </div>
                        <p className="hidden sm:block text-[9px] sm:text-[10px] text-slate-400 font-bold tracking-widest uppercase">
                          Institutional Gold Scalper Core
                        </p>
                      </div>
                    </Link>
                  </div>

                  {/* Desktop Navigation Links */}
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

                  {/* Controls & Operator Bar */}
                  <div className="flex items-center space-x-1.5 sm:space-x-2.5">
                    {/* MT5 Account Pill (Desktop & Tablet) */}
                    <div className="hidden lg:flex items-center space-x-2 px-2.5 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs font-mono">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                      <span className="text-slate-400 font-sans font-bold">MT5:</span>
                      <span className="text-cyan-300 font-extrabold">{botStatusData?.mt5Account || '113883228'}</span>
                      <span className="text-slate-600">|</span>
                      <span className="text-slate-400 font-sans font-bold">Limit:</span>
                      <span className="text-amber-400 font-extrabold">{botStatusData?.todayTradesCount || 0}/{botStatusData?.maxDailyTrades || 4}</span>
                    </div>

                    {/* Engine START / PAUSE Button */}
                    <button
                      onClick={handleToggleEngine}
                      disabled={engineToggling || enginePaused === null}
                      className={`px-2 sm:px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-md ${
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
                          <span className="sm:hidden text-[10px]">ACTIVE</span>
                        </>
                      ) : (
                        <>
                          <Pause className="w-3.5 h-3.5 text-amber-400" />
                          <span className="hidden sm:inline">ENGINE PAUSED</span>
                          <span className="sm:hidden text-[10px]">PAUSED</span>
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
                      <span className="hidden md:inline">FLATTEN</span>
                    </button>

                    {/* Voroa Online Status Indicator */}
                    <div className={`flex items-center space-x-1 px-2 sm:px-2.5 py-1.5 rounded-xl border text-[11px] font-black tracking-wider font-mono ${
                      botOnline ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                    }`}>
                      {botOnline ? (
                        <><Wifi className="h-3 w-3 animate-pulse" /><span className="hidden md:inline">ONLINE</span></>
                      ) : (
                        <><WifiOff className="h-3 w-3" /><span className="hidden md:inline">OFFLINE</span></>
                      )}
                    </div>

                    {/* Operator Badge (AdiVish) */}
                    <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold font-mono">
                      <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                      <span>AdiVish</span>
                    </div>

                    {/* Logout Button */}
                    <button
                      onClick={handleLogout}
                      className="p-1.5 rounded-xl bg-slate-900 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-slate-800 hover:border-rose-500/40 transition-colors"
                      title="Log Out (AdiVish)"
                    >
                      <LogOut className="h-4 w-4" />
                    </button>
                  </div>
                </header>

                {/* Mobile Dropdown Drawer */}
                <AnimatePresence>
                  {mobileMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="xl:hidden bg-slate-950/95 border-b border-slate-800/90 backdrop-blur-2xl overflow-hidden z-30 sticky top-[57px] sm:top-[65px]"
                    >
                      <div className="p-4 space-y-3">
                        {/* Operator Profile Banner in Mobile Menu */}
                        <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/90 border border-slate-800">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-slate-950 font-black text-xs">
                              AV
                            </div>
                            <div>
                              <div className="text-xs font-black text-white flex items-center gap-1.5">
                                <span>AdiVish</span>
                                <ShieldCheck className="w-3 h-3 text-amber-400" />
                              </div>
                              <div className="text-[10px] text-emerald-400 font-mono">Authorized Master Operator</div>
                            </div>
                          </div>
                          <button
                            onClick={handleLogout}
                            className="text-[11px] px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-300 border border-rose-500/25 font-mono"
                          >
                            Logout
                          </button>
                        </div>

                        {/* MT5 Account Status on Mobile */}
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                          <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                            <div className="text-[10px] text-slate-500">MT5 ACCOUNT</div>
                            <div className="text-cyan-300 font-bold">{botStatusData?.mt5Account || '113883228'}</div>
                          </div>
                          <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                            <div className="text-[10px] text-slate-500">DAILY TRADES</div>
                            <div className="text-amber-400 font-bold">{botStatusData?.todayTradesCount || 0}/{botStatusData?.maxDailyTrades || 4}</div>
                          </div>
                        </div>

                        {/* Navigation Links */}
                        <div className="space-y-1 pt-1">
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
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Main Content Area */}
                <main className="flex-1 p-3 sm:p-5 md:p-6 lg:p-8 max-w-[1700px] w-full mx-auto relative z-10">
                  {children}
                </main>

                {/* Institutional Status Footer */}
                <footer className="mt-auto border-t border-slate-800/80 bg-slate-950/90 backdrop-blur-md px-4 sm:px-6 py-3 text-xs text-slate-400 flex flex-col md:flex-row items-center justify-between gap-2.5">
                  <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 sm:gap-3 text-center md:text-left">
                    <span className="font-black text-white">TREADIIIIO QUANTUM v2.0</span>
                    <span className="text-slate-600 hidden sm:inline">•</span>
                    <span className="text-amber-400 font-bold">XAU/USD Gold Scalper</span>
                    <span className="text-slate-600 hidden sm:inline">•</span>
                    <span className="text-emerald-400 font-bold">Cloud Engine: Voroa Mumbai</span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span>Operator: <strong className="text-slate-200">AdiVish</strong></span>
                    </span>
                    <span className="text-slate-600">•</span>
                    <span>Port: 4000</span>
                    <span className="text-slate-600">•</span>
                    <span className="text-emerald-400 font-bold">Live 24/7</span>
                  </div>
                </footer>
              </>
            ) : null}
          </>
        )}
      </body>
    </html>
  );
}
