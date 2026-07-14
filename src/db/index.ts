import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { logger } from '../logger';

// Path for the JSON database file
const jsonDbPath = path.resolve(path.dirname(config.absoluteDbPath), 'forex_bot_db.json');

interface DbState {
  candles: any[];
  trades: any[];
  positions: any[];
  equity_snapshots: any[];
  model_runs: any[];
}

let state: DbState = {
  candles: [],
  trades: [],
  positions: [],
  equity_snapshots: [],
  model_runs: [],
};

// Load database state from disk
function loadState() {
  try {
    if (fs.existsSync(jsonDbPath)) {
      const data = fs.readFileSync(jsonDbPath, 'utf8');
      state = JSON.parse(data);
    } else {
      saveState();
    }
  } catch (error) {
    logger.error('Failed to load JSON database state:', error);
  }
}

// Save database state to disk
function saveState() {
  try {
    const dir = path.dirname(jsonDbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(jsonDbPath, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    logger.error('Failed to save JSON database state:', error);
  }
}

export function initDb() {
  logger.info(`Initializing JSON-file Database at: ${jsonDbPath}`);
  loadState();
  logger.info('JSON Database initialized successfully.');
}

// Key mapping helpers returning BOTH snake_case and camelCase for compatibility
const mapPosition = (p: any) => ({
  id: p.id,
  instrument: p.instrument,
  action: p.action,
  entry_time: p.entry_time,
  entryTime: p.entry_time,
  entry_price: p.entry_price,
  entryPrice: p.entry_price,
  units: p.units,
  unrealized_pnl: p.unrealized_pnl,
  unrealizedPnL: p.unrealized_pnl,
  stop_loss: p.stop_loss,
  stopLoss: p.stop_loss,
  take_profit: p.take_profit,
  takeProfit: p.take_profit,
  strategy: p.strategy,
});

const mapTrade = (t: any) => ({
  id: t.id,
  instrument: t.instrument,
  action: t.action,
  entry_time: t.entry_time,
  entryTime: t.entry_time,
  exit_time: t.exit_time,
  exitTime: t.exit_time,
  entry_price: t.entry_price,
  entryPrice: t.entry_price,
  exit_price: t.exit_price,
  exitPrice: t.exit_price,
  units: t.units,
  pnl: t.pnl,
  strategy: t.strategy,
  status: t.status,
});

const mapSnapshot = (s: any) => ({
  time: s.time,
  balance: s.balance,
  equity: s.equity,
  unrealized_pnl: s.unrealized_pnl,
  unrealizedPnL: s.unrealized_pnl,
  drawdown: s.drawdown,
});

const mapRun = (r: any) => ({
  run_id: r.run_id,
  runId: r.run_id,
  timestamp: r.timestamp,
  metrics_json: r.metrics_json,
  metricsJson: r.metrics_json,
  metrics: r.metrics_json ? JSON.parse(r.metrics_json) : null,
});

// Mock DB client mirroring SQLite syntax
export const db = {
  prepare(sql: string) {
    const query = sql.trim().replace(/\s+/g, ' ');

    return {
      run(...args: any[]) {
        let changed = false;

        // 1. INSERT INTO candles
        if (query.startsWith('INSERT INTO candles') || query.startsWith('INSERT OR REPLACE INTO candles')) {
          const [time, instrument, granularity, open, high, low, close, volume] = args;
          const idx = state.candles.findIndex(
            (c) => c.time === time && c.instrument === instrument && c.granularity === granularity
          );

          const candle = { time, instrument, granularity, open, high, low, close, volume };
          if (idx !== -1) {
            state.candles[idx] = candle;
          } else {
            state.candles.push(candle);
          }
          changed = true;
        }
        // 2. INSERT INTO trades
        else if (query.startsWith('INSERT INTO trades')) {
          if (args.length === 11) {
            const [id, instrument, action, entry_time, exit_time, entry_price, exit_price, units, pnl, strategy, status] = args;
            state.trades.push({
              id,
              instrument,
              action,
              entry_time,
              exit_time,
              entry_price,
              exit_price,
              units,
              pnl,
              strategy,
              status,
            });
          } else {
            const [id, instrument, action, entry_time, entry_price, units, strategy, status] = args;
            state.trades.push({
              id,
              instrument,
              action,
              entry_time,
              exit_time: null,
              entry_price,
              exit_price: null,
              units,
              pnl: null,
              strategy,
              status: status || 'OPEN',
            });
          }
          changed = true;
        }
        // 3. UPDATE trades
        else if (query.startsWith('UPDATE trades')) {
          const [exit_time, exit_price, pnl, status, id] = args;
          const idx = state.trades.findIndex((t) => t.id === id);
          if (idx !== -1) {
            state.trades[idx] = {
              ...state.trades[idx],
              exit_time,
              exit_price,
              pnl,
              status,
            };
            changed = true;
          }
        }
        // 4. INSERT INTO positions
        else if (query.startsWith('INSERT INTO positions')) {
          const [id, instrument, action, entry_time, entry_price, units, unrealized_pnl, stop_loss, take_profit, strategy] = args;
          state.positions.push({
            id,
            instrument,
            action,
            entry_time,
            entry_price,
            units,
            unrealized_pnl,
            stop_loss,
            take_profit,
            strategy,
          });
          changed = true;
        }
        // 5. UPDATE positions
        else if (query.startsWith('UPDATE positions')) {
          const [unrealized_pnl, id] = args;
          const idx = state.positions.findIndex((p) => p.id === id);
          if (idx !== -1) {
            state.positions[idx].unrealized_pnl = unrealized_pnl;
            changed = true;
          }
        }
        // 6. DELETE FROM positions
        else if (query.startsWith('DELETE FROM positions')) {
          const [id] = args;
          const initialLength = state.positions.length;
          state.positions = state.positions.filter((p) => p.id !== id);
          if (state.positions.length !== initialLength) {
            changed = true;
          }
        }
        // 7. INSERT OR REPLACE INTO equity_snapshots
        else if (query.startsWith('INSERT OR REPLACE INTO equity_snapshots') || query.startsWith('INSERT INTO equity_snapshots')) {
          const [time, balance, equity, unrealized_pnl, drawdown] = args;
          const idx = state.equity_snapshots.findIndex((s) => s.time === time);
          const snap = { time, balance, equity, unrealized_pnl, drawdown };
          if (idx !== -1) {
            state.equity_snapshots[idx] = snap;
          } else {
            state.equity_snapshots.push(snap);
          }
          changed = true;
        }
        // 8. INSERT INTO model_runs
        else if (query.startsWith('INSERT INTO model_runs')) {
          const [run_id, timestamp, metrics_json] = args;
          state.model_runs.push({ run_id, timestamp, metrics_json });
          changed = true;
        }
        // 9. DROP/DELETE ALL Tables (Helper for testing)
        else if (query.startsWith('DROP TABLE')) {
          if (query.includes('positions')) state.positions = [];
          if (query.includes('trades')) state.trades = [];
          if (query.includes('candles')) state.candles = [];
          if (query.includes('equity_snapshots')) state.equity_snapshots = [];
          if (query.includes('model_runs')) state.model_runs = [];
          changed = true;
        }

        if (changed) {
          saveState();
        }

        return { changes: changed ? 1 : 0 };
      },

      all(...args: any[]): any[] {
        // 1. SELECT candles
        if (query.includes('FROM candles')) {
          const [instrument, granularity, limit] = args;
          return state.candles
            .filter((c) => c.instrument === instrument && c.granularity === granularity)
            .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()) // DESC
            .slice(0, limit);
        }
        // 2. SELECT positions
        else if (query.includes('FROM positions')) {
          let pos = state.positions;
          if (args.length === 1) {
            pos = state.positions.filter((p) => p.instrument === args[0]);
          } else if (args.length === 2) {
            pos = state.positions.filter((p) => p.instrument === args[0] && p.strategy === args[1]);
          }
          return pos.map(mapPosition);
        }
        // 3. SELECT trades
        else if (query.includes('FROM trades')) {
          let tr = state.trades;
          if (query.includes('status = \'CLOSED\'') && !query.includes('exit_time')) {
            tr = state.trades.filter((t) => t.status === 'CLOSED');
          }
          const limit = args[0] || 100;
          return tr
            .sort((a, b) => new Date(b.entry_time).getTime() - new Date(a.entry_time).getTime()) // DESC
            .slice(0, limit)
            .map(mapTrade);
        }
        // 4. SELECT equity_snapshots
        else if (query.includes('FROM equity_snapshots')) {
          const limit = args[0] || 500;
          return state.equity_snapshots
            .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()) // ASC
            .slice(0, limit)
            .map(mapSnapshot);
        }
        // 5. SELECT model_runs
        else if (query.includes('FROM model_runs')) {
          return state.model_runs
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()) // DESC
            .map(mapRun);
        }

        return [];
      },

      get(...args: any[]): any {
        // 1. SELECT SUM(pnl) FROM trades status = 'CLOSED'
        if (query.includes('SELECT SUM(pnl)') && query.includes('status = \'CLOSED\'')) {
          if (query.includes('exit_time LIKE')) {
            const todayPattern = args[0].replace('%', ''); // e.g. "2026-07-10"
            const total = state.trades
              .filter((t) => t.status === 'CLOSED' && t.exit_time && t.exit_time.startsWith(todayPattern))
              .reduce((sum, t) => sum + (t.pnl || 0), 0);
            return { realizedToday: total };
          } else {
            const total = state.trades
              .filter((t) => t.status === 'CLOSED')
              .reduce((sum, t) => sum + (t.pnl || 0), 0);
            return { totalPnL: total };
          }
        }
        // 2. SELECT COUNT(*) as count FROM positions
        else if (query.includes('SELECT COUNT(*)') && query.includes('positions')) {
          return { count: state.positions.length };
        }
        // 3. SELECT COUNT(*) as count FROM equity_snapshots
        else if (query.includes('SELECT COUNT(*)') && query.includes('equity_snapshots')) {
          return { count: state.equity_snapshots.length };
        }
        // 4. SELECT MAX(equity) as peak FROM equity_snapshots
        else if (query.includes('SELECT MAX(equity)') && query.includes('equity_snapshots')) {
          const peak = state.equity_snapshots.reduce((max, s) => Math.max(max, s.equity), config.STARTING_BALANCE);
          return { peak };
        }
        // 5. SELECT positions single row
        else if (query.includes('FROM positions WHERE')) {
          let pos: any = null;
          if (args.length === 2) {
            const [inst, strat] = args;
            pos = state.positions.find((p) => p.instrument === inst && p.strategy === strat) || null;
          } else if (args.length === 1) {
            const val = args[0];
            pos = state.positions.find((p) => p.id === val || p.instrument === val) || null;
          }
          return pos ? mapPosition(pos) : null;
        }

        return null;
      },
    };
  },

  transaction(fn: Function) {
    return function (...args: any[]) {
      const result = fn(...args);
      saveState();
      return result;
    };
  },

  close() {
    saveState();
  },

  pragma(p: string) {
    // noop
  },
};
