// Set up environment for tests
process.env.DB_PATH = ':memory:';
process.env.USE_SIMULATOR = 'true';
process.env.STARTING_BALANCE = '10000';
process.env.API_SECRET_KEY = 'test_api_key_for_unit_tests_1234';
process.env.CORS_ALLOWED_ORIGIN = 'http://localhost:3000';

import { initDb, db } from '../src/db';

// Mock TelegramNotifier to prevent actual network calls
jest.mock('../src/notifier/telegram', () => ({
  TelegramNotifier: {
    sendMessage: jest.fn(),
    initialize: jest.fn(),
  }
}));

import { apiKeyAuth, validateWsApiKey } from '../src/api/authMiddleware';
import { Request, Response, NextFunction } from 'express';

beforeAll(() => {
  initDb();
});

afterAll(() => {
  db.close();
});

describe('Authentication Middleware', () => {
  function createMockReq(overrides: Partial<Request> = {}): Request {
    return {
      method: 'GET',
      path: '/api/status',
      ip: '127.0.0.1',
      headers: {},
      ...overrides,
    } as unknown as Request;
  }

  function createMockRes(): { res: Response; statusCode: number; body: any } {
    const state = { statusCode: 200, body: null as any };
    const res = {
      status(code: number) {
        state.statusCode = code;
        return this;
      },
      json(data: any) {
        state.body = data;
        return this;
      },
      sendStatus(code: number) {
        state.statusCode = code;
        return this;
      },
      header() { return this; },
    } as unknown as Response;
    return { res, ...state };
  }

  test('should reject requests without X-API-Key header', () => {
    const req = createMockReq();
    const mockRes = createMockRes();
    const next = jest.fn();

    apiKeyAuth(req, mockRes.res, next);

    expect(next).not.toHaveBeenCalled();
    // The status was set on the response
  });

  test('should reject requests with incorrect X-API-Key', () => {
    const req = createMockReq({
      headers: { 'x-api-key': 'wrong_key' },
    });
    const mockRes = createMockRes();
    const next = jest.fn();

    apiKeyAuth(req, mockRes.res, next);

    expect(next).not.toHaveBeenCalled();
  });

  test('should allow requests with correct X-API-Key', () => {
    const req = createMockReq({
      headers: { 'x-api-key': 'test_api_key_for_unit_tests_1234' },
    });
    const mockRes = createMockRes();
    const next = jest.fn();

    apiKeyAuth(req, mockRes.res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('should allow OPTIONS requests without API key (CORS preflight)', () => {
    const req = createMockReq({ method: 'OPTIONS' });
    const mockRes = createMockRes();
    const next = jest.fn();

    apiKeyAuth(req, mockRes.res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('WebSocket API Key Validation', () => {
  test('should accept valid API key in query params', () => {
    const result = validateWsApiKey(
      '/ws?apiKey=test_api_key_for_unit_tests_1234',
      {}
    );
    expect(result).toBe(true);
  });

  test('should accept valid API key in headers', () => {
    const result = validateWsApiKey('/ws', {
      'x-api-key': 'test_api_key_for_unit_tests_1234',
    });
    expect(result).toBe(true);
  });

  test('should reject invalid API key', () => {
    const result = validateWsApiKey('/ws?apiKey=wrong_key', {});
    expect(result).toBe(false);
  });

  test('should reject when no API key provided', () => {
    const result = validateWsApiKey('/ws', {});
    expect(result).toBe(false);
  });
});

describe('Database Connection (SQLite)', () => {
  test('should successfully query the database', () => {
    const row = db.prepare('SELECT 1 as ok').get() as any;
    expect(row.ok).toBe(1);
  });

  test('should have filter_rejections table', () => {
    const rows = db.prepare('SELECT * FROM filter_rejections').all();
    expect(Array.isArray(rows)).toBe(true);
  });

  test('should have all required tables', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[];
    const tableNames = tables.map(t => t.name);
    
    expect(tableNames).toContain('candles');
    expect(tableNames).toContain('trades');
    expect(tableNames).toContain('positions');
    expect(tableNames).toContain('equity_snapshots');
    expect(tableNames).toContain('model_runs');
    expect(tableNames).toContain('ml_confidence_log');
    expect(tableNames).toContain('filter_rejections');
  });
});
