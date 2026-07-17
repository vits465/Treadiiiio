import * as dotenv from 'dotenv';
import { z } from 'zod';
import * as path from 'path';

// Load environment variables
dotenv.config();

const envSchema = z.object({
  PORT: z.string().transform((val) => parseInt(val, 10)).default('4000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DB_PATH: z.string().default('./forex_bot.db'),
  TWELVE_DATA_API_KEY: z.string().min(10, 'TWELVE_DATA_API_KEY is required and must be at least 10 chars'),
  USE_SIMULATOR: z.string().transform((val) => val === 'true').default('true'),
  USE_REAL_PRICES: z.string().transform((val) => val === 'true').default('false'),
  CURRENCY_PAIRS: z.string().transform((val) => val.split(',').map((p) => p.trim())),
  CANDLE_GRANULARITY: z.string().default('1h'), // Twelve Data default interval
  POLL_INTERVAL_SECONDS: z.string().transform((val) => parseInt(val, 10)).default('60'),
  STARTING_BALANCE: z.string().transform((val) => parseFloat(val)).default('10000'),
  SPREAD_PIPS: z.string().transform((val) => parseFloat(val)).default('1.5'),
  SLIPPAGE_PIPS: z.string().transform((val) => parseFloat(val)).default('0.5'),
  RISK_MODE: z.enum(['conservative', 'standard', 'aggressive']).default('conservative'),
  RISK_BASE_PCT_PER_TRADE: z.string().transform((val) => parseFloat(val)).default('1.0'),
  RISK_MAX_TOTAL_OPEN_RISK_PCT: z.string().transform((val) => parseFloat(val)).default('3.0'),
  RISK_WEEKLY_LOSS_LIMIT_PCT: z.string().transform((val) => parseFloat(val)).default('12.0'),
  RISK_MAX_RECOVERY_CUMULATIVE_PCT: z.string().transform((val) => parseFloat(val)).default('4.0'),
  RISK_MAX_DRAWDOWN_PCT: z.string().transform((val) => parseFloat(val)).default('30.0'),
  RISK_MAX_POSITION_SIZE_PCT: z.string().transform((val) => parseFloat(val)).default('2'),
  RISK_MAX_CONCURRENT_POSITIONS: z.string().transform((val) => parseInt(val, 10)).default('5'),
  RISK_DAILY_LOSS_LIMIT_PCT: z.string().transform((val) => parseFloat(val)).default('5'),
  ML_MIN_CONFIDENCE: z.string().transform((val) => parseFloat(val)).default('0.62'),
  CORRELATION_GROUPS: z.string().transform((val) => val.split('|').map(g => g.trim())).default('USD:EUR/USD,GBP/USD,USD/JPY,AUD/USD,USD/CHF'),
  ML_SERVICE_URL: z.string().default('http://127.0.0.1:8000'),
  ENABLED_STRATEGIES: z.string().transform((val) => val.split(',').map((s) => s.trim())),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  API_SECRET_KEY: z.string().min(16, 'API_SECRET_KEY must be at least 16 characters'),
  CORS_ALLOWED_ORIGIN: z.string().default('http://localhost:3000'),
  
  // Phase 2: Trade Gating Controls
  TRADING_SESSIONS: z.string().transform((val) => val.split(',').map(s => s.trim().toUpperCase())).default('LONDON,NY'),
  TRADING_DAYS: z.string().transform((val) => val.split(',').map(d => parseInt(d.trim(), 10))).default('1,2,3,4,5'), // 1=Mon, 5=Fri
  NEWS_BLACKOUT_MINUTES_BEFORE: z.string().transform((val) => parseInt(val, 10)).default('30'),
  NEWS_BLACKOUT_MINUTES_AFTER: z.string().transform((val) => parseInt(val, 10)).default('30'),
  NEWS_RESTRICT_IMPACT: z.string().transform((val) => val.split(',').map(i => i.trim().toUpperCase())).default('HIGH'),
  RISK_DAILY_PROFIT_LOCK_PCT: z.string().transform((val) => parseFloat(val)).default('3.0'),
  TRADE_DIRECTION: z.enum(['BUY_ONLY', 'SELL_ONLY', 'BOTH']).default('BOTH'),
  HOLIDAY_GUARD_ENABLED: z.string().transform((val) => val.toLowerCase() === 'true').default('true'),

  // Phase 3: Execution Quality
  USE_ATR_SIZING: z.string().transform((val) => val.toLowerCase() === 'true').default('true'),
  ATR_SL_MULTIPLIER: z.string().transform((val) => parseFloat(val)).default('1.5'),
  ATR_TP_MULTIPLIER: z.string().transform((val) => parseFloat(val)).default('3.0'),
  ALERT_LATENCY_MS: z.string().transform((val) => parseInt(val, 10)).default('500'),
  ALERT_SLIPPAGE_PIPS: z.string().transform((val) => parseFloat(val)).default('2.0'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

if (parsed.data.STARTING_BALANCE < 200 && parsed.data.RISK_MODE !== 'conservative') {
  console.warn(`⚠️ WARNING: STARTING_BALANCE is $${parsed.data.STARTING_BALANCE} (< $200). It is highly recommended to use RISK_MODE='conservative' instead of '${parsed.data.RISK_MODE}'.`);
}

export const config = {
  ...parsed.data,
  absoluteDbPath: path.resolve(process.cwd(), parsed.data.DB_PATH),
};

export type Config = typeof config;
