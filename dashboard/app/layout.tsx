'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  TrendingUp, 
  Activity, 
  FlaskConical, 
  Cpu, 
  ShieldAlert, 
  Wifi, 
  WifiOff,
  Settings
} from 'lucide-react';
import './globals.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [wsConnected, setWsConnected] = useState(false);

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
          reconnectTimeout = setTimeout(connect, 1000);
        };
        ws.onerror = () => setWsConnected(false);
      } catch (e) {
        setWsConnected(false);
        reconnectTimeout = setTimeout(connect, 1000);
      }
    };
    connect();
    return () => {
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);

  const navItems = [
    { name: 'Overview', href: '/', icon: Activity },
    { name: 'Trades Log', href: '/trades', icon: TrendingUp },
    { name: 'Strategy Lab', href: '/strategy-lab', icon: FlaskConical },
    { name: 'Model Monitor', href: '/model-monitor', icon: Cpu },
    { name: 'Risk Panel', href: '/risk', icon: ShieldAlert },
    { name: 'Backtest', href: '/backtest', icon: TrendingUp },
    { name: 'Settings', href: '/settings', icon: Settings },
  ];

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

        {/* Header */}
        <header className="sticky top-0 z-40 bg-[#05070e]/60 backdrop-blur-xl border-b border-[#1e293b]/50 px-6 py-4 flex items-center justify-between shadow-lg shadow-black/20">
          <div className="flex items-center space-x-3">
            <div className="relative group">
              <div className="absolute inset-0 bg-cyan-400 opacity-50 blur-md rounded-lg group-hover:opacity-75 transition duration-500"></div>
              <div className="relative bg-gradient-to-br from-[#0f172a] to-[#1e293b] p-2 rounded-lg border border-cyan-500/30">
                <TrendingUp className="h-6 w-6 text-cyan-400" />
              </div>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-cyan-400 bg-clip-text text-transparent">
                ANTIGRAVITY
              </h1>
              <p className="text-[10px] text-cyan-500/80 font-bold tracking-widest uppercase">Live Trading Core</p>
            </div>
          </div>

          <nav className="hidden md:flex space-x-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link key={item.href} href={item.href} className="relative px-4 py-2 rounded-xl text-sm font-medium transition-all group">
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

          <div className="flex items-center space-x-4">
            {/* Emergency Flatten Button */}
            <button
              onClick={async () => {
                if (confirm("⚠️ EMERGENCY KILL: Close all MT5 positions and HALT trading immediately?")) {
                  try {
                    const apiKey = process.env.NEXT_PUBLIC_API_KEY ?? "a3f7c9d2e1b4f6a8c0d5e7f9b2a4c6d8";
                    const apiBase = process.env.NEXT_PUBLIC_BOT_API_URL ?? "https://forex-trading-bot-hga8.onrender.com";
                    await fetch(`${apiBase}/api/bot/kill`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json", "x-api-key": apiKey }
                    });
                    alert("🛑 Kill Switch Executed! All MT5 positions closed and engine paused.");
                  } catch (e: any) {
                    alert("Failed to execute Kill Switch: " + e.message);
                  }
                }
              }}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/40 text-xs font-bold transition-all shadow-lg shadow-rose-500/10 font-mono"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>EMERGENCY FLATTEN</span>
            </button>

            <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-full border text-xs font-bold tracking-wider ${
              wsConnected ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
            }`}>
              {wsConnected ? (
                <><Wifi className="h-3.5 w-3.5 animate-pulse" /><span>WS LIVE</span></>
              ) : (
                <><WifiOff className="h-3.5 w-3.5" /><span>OFFLINE</span></>
              )}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="relative z-10 flex-grow p-6 max-w-7xl mx-auto w-full">
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </body>
    </html>
  );
}
