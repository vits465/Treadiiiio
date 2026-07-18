/**
 * Jest test environment bootstrap.
 *
 * Supplies safe defaults for all schema-required environment variables so the
 * test suite runs without a local .env file.  Engine tests also disable the
 * time-of-day and day-of-week trading gates so they pass on weekends and
 * outside session hours.
 */

// Core identifiers
process.env.TWELVE_DATA_API_KEY = 'test_key_12345678';
process.env.API_SECRET_KEY = 'test_secret_key_for_jest_bootstrap';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';

// Account
process.env.STARTING_BALANCE = '10000';
process.env.RISK_MODE = 'conservative';
process.env.RISK_BASE_PCT_PER_TRADE = '1.0';
process.env.RISK_MAX_POSITION_SIZE_PCT = '2';
process.env.RISK_MAX_CONCURRENT_POSITIONS = '5';
process.env.RISK_DAILY_LOSS_LIMIT_PCT = '5';
process.env.RISK_WEEKLY_LOSS_LIMIT_PCT = '12';
process.env.RISK_MAX_DRAWDOWN_PCT = '30';
process.env.RISK_MAX_TOTAL_OPEN_RISK_PCT = '3';
process.env.RISK_MAX_RECOVERY_CUMULATIVE_PCT = '4';
process.env.RISK_DAILY_PROFIT_LOCK_PCT = '3';

// Spread / slippage
process.env.SPREAD_PIPS = '1.5';
process.env.SLIPPAGE_PIPS = '0.5';
process.env.ALERT_SLIPPAGE_PIPS = '2.0';

// Instruments / strategies
process.env.CURRENCY_PAIRS = 'EUR/USD';
process.env.ENABLED_STRATEGIES = 'ma_crossover';
process.env.CANDLE_GRANULARITY = '1h';
process.env.POLL_INTERVAL_SECONDS = '60';
process.env.ALERT_LATENCY_MS = '500';

// Phase 4 keys
process.env.ML_CONFIDENCE_FULL_SIZE = '0.80';
process.env.SIZING_VOL_TARGET_PERCENTILE = '0.5';
process.env.ML_REQUIRE_RULE_CONFIRMATION = 'true';
process.env.ML_MIN_RULE_CONFIRMATIONS = '1';
process.env.ML_MIN_CONFIDENCE = '0.62';
process.env.RECOVERY_MAX_CONSECUTIVE_LOSSES = '3';
process.env.RECOVERY_COOLDOWN_HOURS = '24';
process.env.RISK_MAX_CONSECUTIVE_LOSSES = '5';
process.env.RISK_CONSECUTIVE_LOSS_COOLDOWN_HOURS = '4';

// Gating — open all time windows so tests pass on weekends
process.env.TRADING_SESSIONS = 'LONDON,NY,TOKYO,SYDNEY';
process.env.TRADING_DAYS = '0,1,2,3,4,5,6';  // all days including Sat/Sun
process.env.TRADE_DIRECTION = 'BOTH';
process.env.HOLIDAY_GUARD_ENABLED = 'false';
process.env.NEWS_BLACKOUT_MINUTES_BEFORE = '0';
process.env.NEWS_BLACKOUT_MINUTES_AFTER = '0';
process.env.NEWS_RESTRICT_IMPACT = 'NONE';

// ATR sizing
process.env.USE_ATR_SIZING = 'false';
process.env.ATR_SL_MULTIPLIER = '1.5';
process.env.ATR_TP_MULTIPLIER = '3.0';

// Correlation
process.env.CORRELATION_GROUPS = 'USD:EUR/USD,GBP/USD,USD/JPY,AUD/USD,USD/CHF';

// Misc
process.env.CORS_ALLOWED_ORIGIN = 'http://localhost:3000';
process.env.ML_SERVICE_URL = 'http://127.0.0.1:8000';
process.env.USE_SIMULATOR = 'true';
process.env.USE_REAL_PRICES = 'false';
