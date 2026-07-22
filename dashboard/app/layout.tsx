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
  LogOut
} from 'lucide-react';
import './globals.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [wsConnected, setWsConnected] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Authentication check
  useEffect(() => {
    const checkAuth = () => {
      const session = localStorage.getItem("antigravity_session");
      const expectedKey = process.env.NEXT_PUBLIC_API_KEY || "a3f7c9d2e1b4f6a8c0d5e7f9b2a4c6d8";
      
      if (pathname === "/login") {
        setIsAuthenticated(false);
        return;
      }

      if (session === expectedKey) {
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
        router.push("/login");
      }
    };

    checkAuth();
  }, [pathname, router]);

  // REST-based connectivity status (reliable, works through Vercel proxy)
  const [botOnline, setBotOnline] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/bot/summary');
        if (!cancelled) setBotOnline(res.ok);
      } catch {
        if (!cancelled) setBotOnline(false);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // WebSocket Live feed (best-effort, for live updates only)
  useEffect(() => {
    const wsBaseUrl = process.env.NEXT_PUBLIC_BOT_WS_URL ?? "ws://localhost:4000/ws";
    const apiKey = process.env.NEXT_PUBLIC_API_KEY ?? "a3f7c9d2e1b4f6a8c0d5e7f9b2a4c6d8";
    const socketUrl = `${wsBaseUrl}?apiKey=${apiKey}`;
    let ws: WebSocket;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      try {
        ws = new WebSocket(socketUrl);
        ws.onopen = () => setWsConnected(true);
        ws.onclose = () => {
          setWsConnected(false);
          reconnectTimeout = setTimeout(connect, 5000);
        };
        ws.onerror = () => setWsConnected(false);
      } catch (e) {
        setWsConnected(false);
        reconnectTimeout = setTimeout(connect, 5000);
      }
    };
    connect();
    return () => {
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("antigravity_session");
    setIsAuthenticated(false);
    router.push("/login");
  };

  const navItems = [
    { name: 'Overview', href: '/', icon: Activity },
    { name: 'Trades Log', href: '/trades', icon: TrendingUp },
    { name: 'Strategy Lab', href: '/strategy-lab', icon: FlaskConical },
    { name: 'Model Monitor', href: '/model-monitor', icon: Cpu },
    { name: 'Risk Panel', href: '/risk', icon: ShieldAlert },
    { name: 'Backtest', href: '/backtest', icon: TrendingUp },
    { name: 'Settings', href: '/settings', icon: Settings },
  ];

  const isLoginPage = pathname === "/login";

  return (
    <html lang="en">
      <head>
        <title>Antigravity Forex Trading</title>
        <meta name="description" content="Premium Trading Admin Center" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: `body { font-family: 'Outfit', sans-serif !important; }`}} />
      </head>
      <body className="bg-[#05070e] text-[#f8fafc] min-h-screen flex flex-col antialiased relative overflow-x-hidden">
        
        {/* Dynamic Background Gradients */}
        <div className="fixed inset-0 z-0 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-cyan-600/10 rounded-full blur-[120px] mix-blend-screen" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-600/10 rounded-full blur-[120px] mix-blend-screen" />
        </div>

        {/* Header - Only render if authenticated and not on login page */}
        {!isLoginPage && isAuthenticated && (
          <header className="sticky top-0 z-40 bg-[#05070e]/80 backdrop-blur-xl border-b border-[#1e293b]/50 px-4 md:px-6 py-4 flex items-center justify-between shadow-lg shadow-black/20">
            <div className="flex items-center space-x-3">
              {/* Mobile Hamburger menu */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white border border-slate-700"
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>

              <div className="relative group">
                <div className="absolute inset-0 bg-cyan-400 opacity-50 blur-md rounded-lg group-hover:opacity-75 transition duration-500"></div>
                <div className="relative bg-gradient-to-br from-[#0f172a] to-[#1e293b] p-2 rounded-lg border border-cyan-500/30">
                  <TrendingUp className="h-5 w-5 md:h-6 md:w-6 text-cyan-400" />
                </div>
              </div>
              <div>
                <h1 className="text-lg md:text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-cyan-400 bg-clip-text text-transparent">
                  ANTIGRAVITY
                </h1>
                <p className="text-[9px] md:text-[10px] text-cyan-500/80 font-bold tracking-widest uppercase">Live Trading Core</p>
              </div>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex space-x-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link key={item.href} href={item.href} className="relative px-3.5 py-2 rounded-xl text-sm font-medium transition-all group">
                    {isActive && (
                      <motion.div
                        layoutId="nav-pill"
                        className="absolute inset-0 bg-cyan-500/10 border border-cyan-500/30 rounded-xl"
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      />
                    )}
                    <div className={`relative z-10 flex items-center space-x-2 ${isActive ? 'text-cyan-400' : 'text-slate-400 group-hover:text-white'}`}>
                      <Icon className="h-4 w-4" />
                      <span>{item.name}</span>
                    </div>
                  </Link>
                );
              })}
            </nav>

            <div className="flex items-center space-x-3">
              {/* Emergency Flatten Button */}
              <button
                onClick={async () => {
                  if (confirm("⚠️ EMERGENCY KILL: Close all MT5 positions and HALT trading immediately?")) {
                    try {
                      await fetch(`/api/bot/kill`, {
                        method: "POST",
                      });
                      alert("🛑 Kill Switch Executed! All MT5 positions closed and engine paused.");
                    } catch (e: any) {
                      alert("Failed to execute Kill Switch: " + e.message);
                    }
                  }
                }}
                className="flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/40 text-[10px] md:text-xs font-bold transition-all shadow-lg font-mono"
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">EMERGENCY FLATTEN</span>
                <span className="sm:hidden">FLATTEN</span>
              </button>

              <div className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-full border text-[9px] md:text-xs font-bold tracking-wider ${
                botOnline ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
              }`}>
                {botOnline ? (
                  <><Wifi className="h-3 w-3 animate-pulse" /><span className="hidden md:inline">ONLINE</span></>
                ) : (
                  <><WifiOff className="h-3 w-3" /><span className="hidden md:inline">OFFLINE</span></>
                )}
              </div>

              {/* Logout Button */}
              <button
                onClick={handleLogout}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition-colors"
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
              className="lg:hidden bg-slate-950 border-b border-slate-800 overflow-hidden z-30 sticky top-[73px]"
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
                          ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-400' 
                          : 'text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="text-sm font-semibold">{item.name}</span>
                    </Link>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Content */}
        <main className="relative z-10 flex-grow p-4 md:p-6 max-w-7xl mx-auto w-full">
          <AnimatePresence mode="wait">
            {isLoginPage ? (
              children
            ) : isAuthenticated === null ? (
              <div className="flex items-center justify-center min-h-[400px] text-slate-500 text-xs font-mono uppercase tracking-widest">
                Initiating Secure Connection...
              </div>
            ) : (
              isAuthenticated && (
                <motion.div
                  key={pathname}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.2 }}
                >
                  {children}
                </motion.div>
              )
            )}
          </AnimatePresence>
        </main>
      </body>
    </html>
  );
}
