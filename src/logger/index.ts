import * as winston from 'winston';
import 'winston-daily-rotate-file';

export interface LogRecord {
  timestamp: string;
  level: string;
  message: string;
}

const recentLogsBuffer: LogRecord[] = [];
const MAX_LOGS = 150;
let logBroadcastCallback: ((log: LogRecord) => void) | null = null;

export function setLogBroadcastCallback(cb: (log: LogRecord) => void) {
  logBroadcastCallback = cb;
}

export function getRecentLogs(): LogRecord[] {
  return [...recentLogsBuffer];
}

// Custom format to capture and broadcast log entries
const memoryAndWsFormat = winston.format((info) => {
  const record: LogRecord = {
    timestamp: (info.timestamp as string) || new Date().toISOString(),
    level: (info.level as string) || 'info',
    message: (info.message as string) || ''
  };

  recentLogsBuffer.push(record);
  if (recentLogsBuffer.length > MAX_LOGS) {
    recentLogsBuffer.shift();
  }

  if (logBroadcastCallback) {
    try {
      logBroadcastCallback(record);
    } catch {}
  }

  return info;
})();

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  memoryAndWsFormat,
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `[${timestamp}] ${level}: ${message}`;
    if (Object.keys(metadata).length > 0 && level.indexOf('error') === -1) {
      msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
  })
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    new winston.transports.DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '14d'
    }),
    new winston.transports.DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d'
    }),
  ],
});
