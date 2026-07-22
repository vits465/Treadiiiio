// dashboard/app/components/BotConsoleLogs.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import { Terminal, Search, Trash2, Pause, Play, ShieldAlert } from "lucide-react";
import { LogRecord, getLogs } from "@/lib/api-client";

interface BotConsoleLogsProps {
  logs?: LogRecord[];
  onLogReceived?: (log: LogRecord) => void;
}

export function BotConsoleLogs({ logs: externalLogs }: BotConsoleLogsProps) {
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [filterLevel, setFilterLevel] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Initial fetch of logs
  useEffect(() => {
    getLogs()
      .then((data) => {
        if (Array.isArray(data)) setLogs(data);
      })
      .catch(() => {});
  }, []);

  // Update when external logs change
  useEffect(() => {
    if (externalLogs && externalLogs.length > 0) {
      setLogs(externalLogs);
    }
  }, [externalLogs]);

  // Auto scroll to bottom
  useEffect(() => {
    if (!isPaused && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, isPaused]);

  const filteredLogs = logs.filter((record) => {
    const matchesLevel =
      filterLevel === "ALL" || record.level.toUpperCase().includes(filterLevel);
    const matchesSearch =
      searchQuery === "" ||
      record.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
      record.timestamp.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesLevel && matchesSearch;
  });

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col h-[400px] font-mono">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-3 border-b border-slate-800 gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
            Live Bot Engine Console Logs
          </h2>
          <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse ml-1"></span>
        </div>

        {/* Actions & Filters */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-500" />
            <input
              type="text"
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-850 border border-slate-800 rounded-lg pl-8 pr-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/50 w-32"
            />
          </div>

          {/* Level Filter */}
          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            className="bg-slate-850 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-cyan-500/50"
          >
            <option value="ALL">All Logs</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
          </select>

          {/* Pause/Resume Auto Scroll */}
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={`p-1.5 rounded-lg border transition-colors ${
              isPaused
                ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                : "bg-slate-800 text-slate-400 hover:text-slate-200 border-slate-700"
            }`}
            title={isPaused ? "Resume Auto-Scroll" : "Pause Auto-Scroll"}
          >
            {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          </button>

          {/* Clear Logs */}
          <button
            onClick={() => setLogs([])}
            className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-rose-400 border border-slate-700 transition-colors"
            title="Clear Log View"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal View Output */}
      <div
        ref={logContainerRef}
        className="flex-1 bg-[#090d16] border border-slate-850 rounded-lg p-3 overflow-y-auto space-y-1.5 text-xs text-slate-300"
      >
        {filteredLogs.length > 0 ? (
          filteredLogs.map((log, idx) => {
            const isError = log.level.toLowerCase().includes("error");
            const isWarn = log.level.toLowerCase().includes("warn");

            return (
              <div key={idx} className="flex items-start gap-2 leading-relaxed hover:bg-slate-800/40 p-0.5 rounded">
                <span className="text-slate-500 shrink-0 font-sans text-[11px]">{log.timestamp}</span>
                <span
                  className={`px-1.5 py-0.2 text-[10px] font-bold rounded shrink-0 uppercase ${
                    isError
                      ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                      : isWarn
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      : "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  }`}
                >
                  {log.level}
                </span>
                <span className={`break-all ${isError ? "text-rose-300" : isWarn ? "text-amber-300" : "text-slate-300"}`}>
                  {log.message}
                </span>
              </div>
            );
          })
        ) : (
          <div className="flex items-center justify-center h-full text-slate-600 text-xs italic">
            No logs matched criteria. Awaiting live console output...
          </div>
        )}
      </div>
    </div>
  );
}
