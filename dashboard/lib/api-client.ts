// dashboard/lib/api-client.ts
//
// Central API client for the Next.js admin dashboard.
// Talks to the Node.js bot's REST API + WebSocket feed.
// Fill in NEXT_PUBLIC_BOT_API_URL / NEXT_PUBLIC_BOT_WS_URL in .env.local

const API_BASE = process.env.NEXT_PUBLIC_BOT_API_URL ?? "http://localhost:4000";
const WS_BASE_URL = process.env.NEXT_PUBLIC_BOT_WS_URL ?? "ws://localhost:4000/ws";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "a3f7c9d2e1b4f6a8c0d5e7f9b2a4c6d8";
const WS_URL = `${WS_BASE_URL}?apiKey=${API_KEY}`;

// ---------- Types (mirror the Node bot's response shapes) ----------

export interface EquitySnapshot {
  timestamp: string;
  equity: number;
  balance: number;
}

export interface Position {
  id: string;
  instrument: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  openedAt: string;
  source: string; // strategy name or ML model id
  units: number;
  stopLoss: number | null;
  takeProfit: number | null;
}

export interface Trade {
  id: string;
  instrument: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  openedAt: string;
  closedAt: string;
  source: string;
}

export interface Summary {
  totalPnl: number;
  winRate: number;
  maxDrawdown: number;
  sharpeApprox: number;
  bySource: Record<string, { pnl: number; trades: number; winRate: number }>;
}

export interface ModelStatus {
  modelId: string;
  instrument: string;
  trainedAt: string;
  validationAccuracy: number;
  liveAccuracy: number | null; // computed from actual outcomes since training
  driftWarning: boolean;
}

export interface StrategyToggle {
  name: string;
  enabled: boolean;
  pnl: number;
  trades: number;
  winRate?: number;
}

// ---------- Fetch helpers ----------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY, ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${path} failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

// ---------- Overview ----------

export const getEquityCurve = () => apiFetch<EquitySnapshot[]>("/api/equity-curve");
export const getOpenPositions = () => apiFetch<Position[]>("/api/positions");
export const getSummary = () => apiFetch<Summary>("/api/summary");

// ---------- Trades Log ----------

export interface TradesQuery {
  source?: string;
  instrument?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export const getTrades = (query: TradesQuery = {}) => {
  const params = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined) as [string, string][]
  );
  return apiFetch<{ trades: Trade[]; total: number }>(`/api/trades?${params.toString()}`);
};

// ---------- Strategy Lab ----------

export const getStrategies = () => apiFetch<StrategyToggle[]>("/api/strategies");

export const setStrategyEnabled = (name: string, enabled: boolean) =>
  apiFetch<StrategyToggle>(`/api/strategies/${encodeURIComponent(name)}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });

// ---------- Model Monitor ----------

export const getModelStatus = (instrument: string) =>
  apiFetch<ModelStatus>(`/api/model-status?instrument=${encodeURIComponent(instrument)}`);

export const triggerRetrain = (instrument: string) =>
  apiFetch<{ started: boolean }>(`/api/model-retrain`, {
    method: "POST",
    body: JSON.stringify({ instrument }),
  });

// ---------- Risk Panel ----------

export interface RiskStatus {
  dailyLossLimit: number;
  dailyLossUsed: number;
  weeklyLossLimit: number;
  weeklyLossUsed: number;
  maxPositionSizePct: number;
  effectiveRiskPct: number;
  currentTotalOpenRiskPct: number;
  distanceToCircuitBreaker: number;
  circuitBreakerLevel: number;
  maxConcurrentPositions: number;
  currentOpenPositions: number;
}

export const getRiskStatus = () => apiFetch<RiskStatus>("/api/risk-status");

// ---------- System Control ----------

export interface BotStatus {
  paused: boolean;
  uptime: number;
}

export const getBotStatus = () => apiFetch<BotStatus>("/api/bot/status");
export const pauseBot = () => apiFetch<{ paused: boolean }>("/api/bot/pause", { method: "POST" });
export const startBot = () => apiFetch<{ paused: boolean }>("/api/bot/start", { method: "POST" });
export const restartBot = () => apiFetch<{ restarting: boolean }>("/api/bot/restart", { method: "POST" });

export const executeManualTrade = (instrument: string, action: 'BUY'|'SELL', stopLoss?: number, takeProfit?: number) => 
  apiFetch<{ success: boolean; orderId: string }>("/api/trade/execute", {
    method: "POST",
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instrument, action, stopLoss, takeProfit })
  });

export const closeManualTrade = (positionId: string) => 
  apiFetch<{ success: boolean }>("/api/trade/close", {
    method: "POST",
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positionId })
  });

export interface ConfigData {
  RISK_MAX_POSITION_SIZE_PCT: number;
  CURRENCY_PAIRS: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

export const getConfig = () => apiFetch<ConfigData>("/api/config");
export const updateConfig = (data: Partial<ConfigData>) => 
  apiFetch<{ success: boolean }>("/api/config", {
    method: "POST",
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

// ---------- Live updates (WebSocket) ----------

export interface NewsEvent {
  title: string;
  country: string;
  date: string;
  time: string;
  impact: string;
  forecast: string;
  previous: string;
  timestamp: number;
}

export const getNews = () => apiFetch<NewsEvent[]>("/api/news");

export interface LogRecord {
  timestamp: string;
  level: string;
  message: string;
}

export const getLogs = () => apiFetch<LogRecord[]>("/api/logs");

type LiveEvent =
  | { type: "position_update"; data: Position }
  | { type: "trade_closed"; data: Trade }
  | { type: "equity_tick"; data: EquitySnapshot }
  | { type: "signal_generated"; data: { instrument: string; source: string; action: string } }
  | { type: "log_entry"; data: LogRecord };

export function connectLiveFeed(onEvent: (event: LiveEvent) => void): () => void {
  let ws: WebSocket | null = null;
  let timer: NodeJS.Timeout | null = null;
  let isClosed = false;

  const connect = () => {
    if (isClosed) return;
    try {
      ws = new WebSocket(WS_URL);
      ws.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data) as LiveEvent;
          onEvent(parsed);
        } catch {}
      };
      ws.onclose = () => {
        if (!isClosed) timer = setTimeout(connect, 1000);
      };
      ws.onerror = () => {
        if (ws) ws.close();
      };
    } catch {
      if (!isClosed) timer = setTimeout(connect, 1000);
    }
  };

  connect();

  return () => {
    isClosed = true;
    if (timer) clearTimeout(timer);
    if (ws) ws.close();
  };
}
