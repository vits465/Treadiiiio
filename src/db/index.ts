import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { logger } from '../logger';

let database: Database.Database;

// Path for the old JSON database file (used for migration only)
const jsonDbPath = path.resolve(path.dirname(config.absoluteDbPath), 'forex_bot_db.json');

/**
 * Adds a column to a table if it does not already exist.
 * Uses PRAGMA table_info to check — safe for pre-existing DBs.
 */
function ensureColumn(tableName: string, columnName: string, columnDef: string): void {
  try {
    const cols = database.pragma(`table_info(${tableName})`) as Array<{ name: string }>;
    const exists = cols.some((c) => c.name === columnName);
    if (!exists) {
      database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
      logger.info(`DB migration: added column ${tableName}.${columnName}`);
    }
  } catch (err) {
    logger.warn(`ensureColumn(${tableName}.${columnName}) failed: ${err}`);
  }
}

/**
 * Initializes the real SQLite database with better-sqlite3.
 * Creates all tables and migrates from JSON if needed.
 */
export function initDb() {
  const dbPath = config.absoluteDbPath;
  const isMemory = config.DB_PATH === ':memory:' || dbPath === ':memory:';
  const effectivePath = isMemory ? ':memory:' : dbPath;
  
  logger.info(`Initializing SQLite Database at: ${effectivePath}`);

  if (!isMemory) {
    const dir = path.dirname(effectivePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  database = new Database(effectivePath);

  // Enable WAL mode for file-based databases (not supported for :memory:)
  if (!isMemory) {
    database.pragma('journal_mode = WAL');
  }
  database.pragma('foreign_keys = ON');

  // Create tables
  database.exec(`
    CREATE TABLE IF NOT EXISTS candles (
      time TEXT NOT NULL,
      instrument TEXT NOT NULL,
      granularity TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume INTEGER DEFAULT 0,
      PRIMARY KEY (time, instrument, granularity)
    );

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      instrument TEXT NOT NULL,
      action TEXT NOT NULL,
      entry_time TEXT NOT NULL,
      exit_time TEXT,
      entry_price REAL NOT NULL,
      exit_price REAL,
      units REAL NOT NULL,
      pnl REAL,
      strategy TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      broker_order_id TEXT,
      risk_pct REAL
    );

    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      instrument TEXT NOT NULL,
      action TEXT NOT NULL,
      entry_time TEXT NOT NULL,
      entry_price REAL NOT NULL,
      units REAL NOT NULL,
      unrealized_pnl REAL DEFAULT 0,
      stop_loss REAL,
      take_profit REAL,
      tp1_price REAL,
      tp2_price REAL,
      partial_tp_hit INTEGER DEFAULT 0,
      initial_units REAL,
      strategy TEXT NOT NULL,
      broker_order_id TEXT,
      max_favorable_price REAL,
      trailing_stop_pips REAL
    );

    CREATE TABLE IF NOT EXISTS equity_snapshots (
      time TEXT PRIMARY KEY,
      balance REAL NOT NULL,
      equity REAL NOT NULL,
      unrealized_pnl REAL DEFAULT 0,
      drawdown REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS model_runs (
      run_id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      metrics_json TEXT
    );

    CREATE TABLE IF NOT EXISTS ml_confidence_log (
      id TEXT PRIMARY KEY,
      signal_time TEXT,
      instrument TEXT,
      confidence REAL,
      action TEXT,
      accepted INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS filter_rejections (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      filter_name TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      instrument TEXT NOT NULL,
      direction TEXT,
      strategy TEXT,
      details TEXT,
      ml_confidence REAL
    );

    CREATE TABLE IF NOT EXISTS ml_models (
      model_id TEXT PRIMARY KEY,
      instrument TEXT NOT NULL,
      trained_at DATETIME NOT NULL,
      metrics TEXT,
      shap_importance TEXT,
      is_active BOOLEAN DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS order_transitions (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      from_state TEXT NOT NULL,
      to_state TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      details TEXT
    );

    CREATE TABLE IF NOT EXISTS backtest_runs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      strategy TEXT NOT NULL,
      instrument TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      equity_curve_json TEXT,
      wfe_score REAL,
      monte_carlo_max_dd REAL
    );
  `);

  // Create indexes for common queries
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_candles_instrument_granularity ON candles(instrument, granularity);
    CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
    CREATE INDEX IF NOT EXISTS idx_trades_exit_time ON trades(exit_time);
    CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy);
    CREATE INDEX IF NOT EXISTS idx_positions_instrument ON positions(instrument);
    CREATE INDEX IF NOT EXISTS idx_filter_rejections_timestamp ON filter_rejections(timestamp);
    CREATE INDEX IF NOT EXISTS idx_filter_rejections_instrument ON filter_rejections(instrument);
  `);

  // In-place migrations for pre-existing databases (PRAGMA-based, idempotent)
  ensureColumn('trades', 'risk_pct', 'REAL');
  ensureColumn('positions', 'partial_booked', 'INTEGER DEFAULT 0');
  ensureColumn('positions', 'initial_risk_usd', 'REAL DEFAULT 0');
  ensureColumn('positions', 'partial_tp_hit', 'INTEGER DEFAULT 0');
  ensureColumn('positions', 'tp1_price', 'REAL');
  ensureColumn('positions', 'tp2_price', 'REAL');
  ensureColumn('positions', 'initial_units', 'REAL');
  ensureColumn('ml_confidence_log', 'accepted', 'INTEGER DEFAULT 1');
  ensureColumn('filter_rejections', 'ml_confidence', 'REAL');

  // Migrate from JSON if this is a fresh file-based DB and JSON file exists
  if (!isMemory) {
    migrateFromJson();
  }

  logger.info('SQLite Database initialized successfully.');
}

/**
 * One-time migration from the old forex_bot_db.json to SQLite.
 * Only runs if the JSON file exists and the SQLite DB has no trades yet.
 */
function migrateFromJson() {
  if (!fs.existsSync(jsonDbPath)) return;

  // Check if we already have data
  const tradeCount = database.prepare('SELECT COUNT(*) as count FROM trades').get() as { count: number };
  if (tradeCount.count > 0) {
    logger.debug('SQLite already has data, skipping JSON migration.');
    return;
  }

  try {
    logger.info(`Migrating data from JSON file: ${jsonDbPath}`);
    const raw = fs.readFileSync(jsonDbPath, 'utf8');
    const data = JSON.parse(raw);

    const insertCandle = database.prepare(`
      INSERT OR REPLACE INTO candles (time, instrument, granularity, open, high, low, close, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertTrade = database.prepare(`
      INSERT OR REPLACE INTO trades (id, instrument, action, entry_time, exit_time, entry_price, exit_price, units, pnl, strategy, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertPosition = database.prepare(`
      INSERT OR REPLACE INTO positions (id, instrument, action, entry_time, entry_price, units, unrealized_pnl, stop_loss, take_profit, strategy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSnapshot = database.prepare(`
      INSERT OR REPLACE INTO equity_snapshots (time, balance, equity, unrealized_pnl, drawdown)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertModelRun = database.prepare(`
      INSERT OR REPLACE INTO model_runs (run_id, timestamp, metrics_json)
      VALUES (?, ?, ?)
    `);

    const migrate = database.transaction(() => {
      // Migrate candles
      if (Array.isArray(data.candles)) {
        for (const c of data.candles) {
          insertCandle.run(c.time, c.instrument, c.granularity, c.open, c.high, c.low, c.close, c.volume || 0);
        }
        logger.info(`  Migrated ${data.candles.length} candles`);
      }

      // Migrate trades
      if (Array.isArray(data.trades)) {
        for (const t of data.trades) {
          insertTrade.run(t.id, t.instrument, t.action, t.entry_time, t.exit_time, t.entry_price, t.exit_price, t.units, t.pnl, t.strategy, t.status || 'OPEN');
        }
        logger.info(`  Migrated ${data.trades.length} trades`);
      }

      // Migrate positions
      if (Array.isArray(data.positions)) {
        for (const p of data.positions) {
          insertPosition.run(p.id, p.instrument, p.action, p.entry_time, p.entry_price, p.units, p.unrealized_pnl || 0, p.stop_loss, p.take_profit, p.strategy);
        }
        logger.info(`  Migrated ${data.positions.length} positions`);
      }

      // Migrate equity snapshots
      if (Array.isArray(data.equity_snapshots)) {
        for (const s of data.equity_snapshots) {
          insertSnapshot.run(s.time, s.balance, s.equity, s.unrealized_pnl || 0, s.drawdown || 0);
        }
        logger.info(`  Migrated ${data.equity_snapshots.length} equity snapshots`);
      }

      // Migrate model runs
      if (Array.isArray(data.model_runs)) {
        for (const r of data.model_runs) {
          insertModelRun.run(r.run_id, r.timestamp, r.metrics_json);
        }
        logger.info(`  Migrated ${data.model_runs.length} model runs`);
      }
    });

    migrate();

    // Rename JSON file to .migrated (safety net, not deleted)
    const migratedPath = jsonDbPath + '.migrated';
    fs.renameSync(jsonDbPath, migratedPath);
    logger.info(`JSON migration complete. Original file renamed to: ${migratedPath}`);
  } catch (error) {
    logger.error('Failed to migrate JSON database to SQLite:', error);
    // Non-fatal — the DB was initialized with empty tables, which is fine
  }
}

/**
 * The `db` export provides the same API as the old JSON shim:
 * db.prepare(sql).run/get/all — now backed by real SQLite.
 */
export const db = {
  prepare(sql: string) {
    return database.prepare(sql);
  },

  transaction<T extends (...args: any[]) => any>(fn: T): T {
    return database.transaction(fn) as unknown as T;
  },

  close() {
    if (database) {
      database.close();
    }
  },

  pragma(p: string) {
    return database.pragma(p);
  },
};
