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
  ENABLED_STRATEGIES: z.string().transform((val) => val.split(',').map((s) => s.trim())).default('ma_crossover,rsi_reversion,bollinger_bands,loss_recovery,smc_liquidity,ml_signal'),
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

  // Phase 4 — Realistic Edge Upgrade keys (all optional with safe defaults)

  // Area 1: Dynamic Sizing
  ML_CONFIDENCE_FULL_SIZE: z.string().transform((val) => parseFloat(val)).default('0.80'),
  SIZING_VOL_TARGET_PERCENTILE: z.string().transform((val) => parseFloat(val)).default('0.5'),

  // Area 2: ML Gate
  ML_REQUIRE_RULE_CONFIRMATION: z.string().transform((val) => val.toLowerCase() === 'true').default('true'),
  ML_MIN_RULE_CONFIRMATIONS: z.string().transform((val) => parseInt(val, 10)).default('1'),

  // Area 3: Bounded Recovery
  RECOVERY_MAX_CONSECUTIVE_LOSSES: z.string().transform((val) => parseInt(val, 10)).default('3'),
  RECOVERY_COOLDOWN_HOURS: z.string().transform((val) => parseInt(val, 10)).default('24'),

  // Area 4: Circuit Breakers
  RISK_MAX_CONSECUTIVE_LOSSES: z.string().transform((val) => parseInt(val, 10)).default('5'),
  RISK_CONSECUTIVE_LOSS_COOLDOWN_HOURS: z.string().transform((val) => parseInt(val, 10)).default('4'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

// Area 6: Small Account Handling — force conservative mode for <$200 accounts
// A warning is insufficient; running aggressive on a $150 account blows it up.
if (parsed.data.STARTING_BALANCE < 200 && parsed.data.RISK_MODE !== 'conservative') {
  console.error(
    `❌ SAFETY OVERRIDE: STARTING_BALANCE is $${parsed.data.STARTING_BALANCE} (< $200). ` +
    `Running with RISK_MODE='${parsed.data.RISK_MODE}' on a micro-account risks rapid ruin. ` +
    `RISK_MODE has been FORCED to 'conservative'. ` +
    `Set STARTING_BALANCE >= $200 or explicitly set RISK_MODE=conservative to suppress this message.`
  );
  // Mutate the parsed data to enforce the safety override
  parsed.data.RISK_MODE = 'conservative';
}

export const config = {
  ...parsed.data,
  absoluteDbPath: path.resolve(process.cwd(), parsed.data.DB_PATH),
};

export type Config = typeof config;
