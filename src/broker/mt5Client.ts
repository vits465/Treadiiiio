import axios from 'axios';
import { config } from '../config';
import { logger } from '../logger';
import { TelegramNotifier } from '../notifier/telegram';

export interface MT5OrderResponse {
  order_id: string;
  instrument: string;
  action: string;
  price: number;
  volume: number;
}

export interface MT5Position {
  order_id: string;
  instrument: string;
  action: string;
  volume: number;
  price_open: number;
  price_current: number;
  sl: number;
  tp: number;
  profit: number;
  time: number;
}

export interface MT5Quote {
  instrument: string;
  bid: number;
  ask: number;
  time: number;
}

export class MT5Client {
  private static baseURL = `${config.ML_SERVICE_URL}/mt5`;
  private static isBridgeDown = false;
  private static lastBridgeCheck = 0;

  /**
   * Helper for exponential backoff retries
   */
  private static async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
    baseDelayMs = 1000
  ): Promise<T> {
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        const res = await operation();
        this.isBridgeDown = false;
        return res;
      } catch (error: any) {
        if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
          this.isBridgeDown = true;
          this.lastBridgeCheck = Date.now();
          throw error;
        }
        attempt++;
        if (attempt >= maxRetries) {
          throw error;
        }
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        logger.warn(`[MT5] API Call failed. Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
        await new Promise(res => setTimeout(res, delay));
      }
    }
    throw new Error('Unreachable');
  }

  public static async placeOrder(
    instrument: string,
    action: 'BUY' | 'SELL',
    volume: number,
    slPips?: number,
    tpPips?: number,
    requestedPrice?: number
  ): Promise<MT5OrderResponse | null> {
    if (config.USE_SIMULATOR) {
      logger.info(`[SIMULATOR] Placed mock ${action} order for ${volume} ${instrument}`);
      let fillPrice = requestedPrice;
      if (fillPrice === undefined) {
        const quote = await this.getQuote(instrument);
        fillPrice = quote ? (action === 'BUY' ? quote.ask : quote.bid) : 1.1000;
      }
      return {
        order_id: `mock_${Date.now()}`,
        instrument,
        action,
        price: fillPrice,
        volume
      };
    }
    try {
      logger.info(`[MT5] Placing ${action} order for ${volume} ${instrument}...`);
      const startTime = Date.now();
      const response = await this.withRetry(() => axios.post(`${this.baseURL}/order`, {
        instrument,
        action,
        volume,
        sl_pips: slPips,
        tp_pips: tpPips
      }, {
        headers: { 'X-API-Key': config.API_SECRET_KEY }
      }));
      const latencyMs = Date.now() - startTime;
      
      const responseData = response.data;
      logger.info(`[MT5] Order placed successfully. Latency: ${latencyMs}ms`);

      if (latencyMs > config.ALERT_LATENCY_MS) {
        logger.warn(`[MT5] High latency detected: ${latencyMs}ms (Threshold: ${config.ALERT_LATENCY_MS}ms)`);
        TelegramNotifier.sendMessage(`⚠️ *HIGH EXECUTION LATENCY*\nInstrument: ${instrument}\nLatency: ${latencyMs}ms\nThreshold: ${config.ALERT_LATENCY_MS}ms`);
      }

      if (requestedPrice && responseData.price) {
        const isJpy = instrument.includes('JPY');
        const isXau = instrument.includes('XAU');
        const pipSize = (isJpy || isXau) ? 0.01 : 0.0001;
        const slippagePips = Math.abs(responseData.price - requestedPrice) / pipSize;
        
        logger.info(`[MT5] Execution slippage: ${slippagePips.toFixed(1)} pips`);
        
        if (slippagePips > config.ALERT_SLIPPAGE_PIPS) {
          logger.warn(`[MT5] High slippage detected: ${slippagePips.toFixed(1)} pips (Threshold: ${config.ALERT_SLIPPAGE_PIPS} pips)`);
          TelegramNotifier.sendMessage(`⚠️ *HIGH SLIPPAGE*\nInstrument: ${instrument}\nSlippage: ${slippagePips.toFixed(1)} pips\nThreshold: ${config.ALERT_SLIPPAGE_PIPS} pips`);
        }
      }

      return responseData;
    } catch (error: any) {
      logger.error(`[MT5] Order failed after retries: ${error.response?.data?.detail || error.message}`);
      return null;
    }
  }

  public static async closeOrder(orderId: string, volume?: number): Promise<boolean> {
    if (config.USE_SIMULATOR) {
      logger.info(`[SIMULATOR] Closed mock order ${orderId}`);
      return true;
    }
    try {
      logger.info(`[MT5] Closing order ${orderId}${volume ? ` (partial volume: ${volume})` : ''}...`);
      await this.withRetry(() => axios.post(`${this.baseURL}/close`, { order_id: orderId, volume }, {
        headers: { 'X-API-Key': config.API_SECRET_KEY }
      }));
      return true;
    } catch (error: any) {
      logger.error(`[MT5] Close order failed after retries: ${error.response?.data?.detail || error.message}`);
      return false;
    }
  }

  public static async closePartialOrder(orderId: string, volume: number): Promise<boolean> {
    return this.closeOrder(orderId, volume);
  }

  public static async modifyOrder(orderId: string, sl?: number, tp?: number): Promise<boolean> {
    if (config.USE_SIMULATOR) {
      return true;
    }
    try {
      await this.withRetry(() => axios.post(`${this.baseURL}/modify`, { order_id: orderId, sl, tp }, {
        headers: { 'X-API-Key': config.API_SECRET_KEY }
      }));
      logger.info(`[MT5] Successfully modified order ${orderId} (SL: ${sl ?? 'UNCHANGED'}, TP: ${tp ?? 'UNCHANGED'})`);
      return true;
    } catch (error: any) {
      logger.warn(`[MT5] Modify order ${orderId} failed: ${error.response?.data?.detail || error.message}`);
      return false;
    }
  }

  public static async getPositions(): Promise<MT5Position[] | null> {
    if (config.USE_SIMULATOR) {
      return []; // Return empty mock positions array
    }
    if (this.isBridgeDown && Date.now() - this.lastBridgeCheck < 60000) {
      return null;
    }
    try {
      const response = await this.withRetry(() => axios.get(`${this.baseURL}/positions`, {
        headers: { 'X-API-Key': config.API_SECRET_KEY },
        timeout: 2000
      }));
      return response.data;
    } catch (error: any) {
      if (error.code !== 'ECONNREFUSED') {
        logger.error(`[MT5] Failed to get positions: ${error.message}`);
      } else {
        logger.debug(`[MT5] Bridge is offline (port 8000). Engine continuing with local tracking.`);
      }
      return null;
    }
  }

  public static async getQuote(instrument: string): Promise<MT5Quote | null> {
    if (config.USE_SIMULATOR) {
      let basePrice = 1.1000;
      if (instrument.includes('JPY')) basePrice = 150.00;
      if (instrument.includes('GBP')) basePrice = 1.2700;
      if (instrument.includes('EUR')) basePrice = 1.0850;
      if (instrument.includes('AUD')) basePrice = 0.6650;
      if (instrument.includes('CHF')) basePrice = 0.9050;
      if (instrument.includes('XAU')) basePrice = 4146.00;

      const vary = (Math.random() - 0.5) * 0.0020;
      return {
        instrument,
        bid: basePrice + vary,
        ask: basePrice + vary + 0.0002,
        time: Date.now() / 1000
      };
    }
    if (this.isBridgeDown && Date.now() - this.lastBridgeCheck < 60000) {
      return null;
    }
    try {
      const response = await this.withRetry(() => axios.get(`${this.baseURL}/quote`, {
        params: { instrument },
        headers: { 'X-API-Key': config.API_SECRET_KEY },
        timeout: 2000
      }), 2, 500);
      return response.data;
    } catch (error: any) {
      if (error.code !== 'ECONNREFUSED') {
        logger.error(`[MT5] Failed to get quote for ${instrument}: ${error.message}`);
      }
      return null;
    }
  }

  public static async getAccountInfo(): Promise<{ login: number; balance: number; equity: number; profit: number; margin: number; margin_free: number } | null> {
    if (config.USE_SIMULATOR) return null;
    if (this.isBridgeDown && Date.now() - this.lastBridgeCheck < 60000) {
      return null;
    }
    try {
      const response = await this.withRetry(() => axios.get(`${this.baseURL}/account`, {
        headers: { 'X-API-Key': config.API_SECRET_KEY },
        timeout: 2000
      }), 2, 500);
      return response.data;
    } catch (error: any) {
      if (error.code !== 'ECONNREFUSED') {
        logger.error(`[MT5] Failed to get account info: ${error.message}`);
      }
      return null;
    }
  }
}
