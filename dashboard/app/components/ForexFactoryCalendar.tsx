// dashboard/app/components/ForexFactoryCalendar.tsx
"use client";

import React, { useState, useEffect } from "react";
import { Calendar, RefreshCw } from "lucide-react";
import { NewsEvent, getNews } from "@/lib/api-client";

export function ForexFactoryCalendar() {
  const [events, setEvents] = useState<NewsEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filterImpact, setFilterImpact] = useState<string>("HIGH");

  const parseDirectJson = (rawItems: any[]): NewsEvent[] => {
    return rawItems.map((item) => {
      const d = new Date(item.date);
      const dateStr = d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
      const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
      return {
        title: item.title,
        country: item.country,
        date: dateStr,
        time: timeStr,
        impact: item.impact,
        forecast: item.forecast || "",
        previous: item.previous || "",
        timestamp: d.getTime(),
      };
    });
  };

  const loadCalendar = async () => {
    setLoading(true);
    try {
      const data = await getNews();
      if (Array.isArray(data) && data.length > 0) {
        setEvents(data);
        return;
      }
      throw new Error("Empty backend news");
    } catch {
      // Serverless Proxy Fallback (bypasses browser CORS completely)
      try {
        const res = await fetch("/api/calendar");
        if (res.ok) {
          const directData = await res.json();
          if (Array.isArray(directData)) {
            setEvents(parseDirectJson(directData));
          }
        }
      } catch (err) {
        console.error("Failed to fetch ForexFactory calendar via proxy:", err);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCalendar();
    const interval = setInterval(loadCalendar, 15 * 60 * 1000); // refresh every 15 mins
    return () => clearInterval(interval);
  }, []);

  const filteredEvents = events.filter((e) => {
    if (filterImpact === "ALL") return true;
    if (filterImpact === "MEDIUM") {
      const imp = e.impact?.toUpperCase();
      return imp === "HIGH" || imp === "MEDIUM";
    }
    return e.impact?.toUpperCase() === filterImpact.toUpperCase();
  });

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col font-mono">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-amber-400" />
          <div>
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
              ForexFactory Economic Calendar
            </h2>
            <span className="text-[10px] text-slate-500 font-sans block">
              Automated high-impact news blackout protection
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Impact Filter */}
          <select
            value={filterImpact}
            onChange={(e) => setFilterImpact(e.target.value)}
            className="bg-slate-850 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-300 focus:outline-none"
          >
            <option value="HIGH">High Impact Only 🔴</option>
            <option value="MEDIUM">Medium & High 🟡</option>
            <option value="ALL">All Impacts ⚪</option>
          </select>

          <button
            onClick={loadCalendar}
            disabled={loading}
            className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700 transition-colors"
            title="Refresh ForexFactory Calendar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Events List */}
      <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
        {filteredEvents.length > 0 ? (
          filteredEvents.map((event, idx) => {
            const isHigh = event.impact?.toLowerCase() === "high";
            const isMedium = event.impact?.toLowerCase() === "medium";

            return (
              <div
                key={idx}
                className={`p-2.5 rounded-lg border flex items-center justify-between transition-colors ${
                  isHigh
                    ? "bg-rose-500/10 border-rose-500/20"
                    : isMedium
                    ? "bg-amber-500/10 border-amber-500/20"
                    : "bg-slate-850 border-slate-800"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                      isHigh
                        ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                        : isMedium
                        ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {event.country?.toUpperCase()}
                  </span>
                  <div>
                    <span className="text-xs font-semibold text-slate-200 block">
                      {event.title}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {event.date} at {event.time}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-right">
                  <div>
                    <span className="text-[10px] text-slate-500 block">Forecast / Prev</span>
                    <span className="text-xs font-semibold text-slate-300">
                      {event.forecast || "-"} / {event.previous || "-"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex items-center justify-center py-8 text-slate-500 text-xs italic">
            No high-impact ForexFactory events scheduled for this session.
          </div>
        )}
      </div>
    </div>
  );
}
