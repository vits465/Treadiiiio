import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { logger } from '../logger';

/**
 * Middleware that validates the X-API-Key header against the configured API_SECRET_KEY.
 * Rejects requests without a valid key with 401 Unauthorized.
 * OPTIONS requests (CORS preflight) are allowed through.
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  // Allow CORS preflight requests through
  if (req.method === 'OPTIONS') {
    next();
    return;
  }

  const apiKey = req.headers['x-api-key'] as string | undefined;

  if (!apiKey || apiKey !== config.API_SECRET_KEY) {
    logger.warn(`[AUTH] Rejected request to ${req.method} ${req.path} — invalid or missing API key from ${req.ip}`);
    res.status(401).json({ error: 'Unauthorized — invalid or missing X-API-Key header' });
    return;
  }

  next();
}

/**
 * Validates API key from WebSocket upgrade request query parameters.
 * Usage: ws://host:port/ws?apiKey=YOUR_KEY
 */
export function validateWsApiKey(url: string, headers: Record<string, string | string[] | undefined>): boolean {
  try {
    const parsedUrl = new URL(url, 'http://localhost');
    const queryKey = parsedUrl.searchParams.get('apiKey');
    const headerKey = headers['x-api-key'] as string | undefined;
    const key = queryKey || headerKey;
    return key === config.API_SECRET_KEY;
  } catch {
    return false;
  }
}
