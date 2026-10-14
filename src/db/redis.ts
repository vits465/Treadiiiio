import { createClient, RedisClientType } from 'redis';
import { logger } from '../logger';

class RedisManager {
  private static instance: RedisClientType | null = null;
  private static isConnecting = false;
  private static isUnavailable = false;

  public static async getClient(): Promise<RedisClientType | null> {
    if (this.isUnavailable) {
      return null;
    }

    if (this.instance) {
      return this.instance;
    }

    if (this.isConnecting) {
      let retries = 0;
      while (this.isConnecting && retries < 10) {
        await new Promise(resolve => setTimeout(resolve, 200));
        retries++;
      }
      return this.instance;
    }

    this.isConnecting = true;
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      const client = createClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: false,
          connectTimeout: 2000,
        }
      });

      client.on('error', (err) => {
        if (!this.isUnavailable) {
          logger.debug(`Redis Client Error: ${err}`);
        }
      });

      client.on('connect', () => logger.info('Redis Client Connected'));

      await client.connect();
      this.instance = client as RedisClientType;
      this.isConnecting = false;
      return this.instance;
    } catch (err) {
      this.isConnecting = false;
      this.isUnavailable = true;
      logger.info('Redis not detected on localhost — using fast in-memory caching fallback.');
      return null;
    }
  }

  private static memoryCache: Map<string, { value: any; expiresAt: number }> = new Map();

  public static async setCache(key: string, value: any, ttlSeconds: number = 60): Promise<void> {
    const client = await this.getClient();
    if (client) {
      try {
        await client.setEx(key, ttlSeconds, JSON.stringify(value));
        return;
      } catch (err) {
        logger.debug(`Redis setCache error for key ${key}: ${err}`);
      }
    }

    // In-memory caching fallback
    this.memoryCache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  public static async getCache<T>(key: string): Promise<T | null> {
    const client = await this.getClient();
    if (client) {
      try {
        const data = await client.get(key);
        if (data) {
          return JSON.parse(data) as T;
        }
        return null;
      } catch (err) {
        logger.debug(`Redis getCache error for key ${key}: ${err}`);
      }
    }

    // In-memory caching fallback
    const entry = this.memoryCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.memoryCache.delete(key);
      return null;
    }
    return entry.value as T;
  }
}

export const redis = RedisManager;
