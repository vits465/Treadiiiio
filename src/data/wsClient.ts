import WebSocket from 'ws';
import { logger } from '../logger';
import { redis } from '../db/redis';
import { config } from '../config';

export class WebSocketManager {
  private static ws: WebSocket | null = null;
  private static pingInterval: NodeJS.Timeout | null = null;
  private static activeInstruments: string[] = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'XAU/USD'];

  public static async start(): Promise<void> {
    if (config.USE_SIMULATOR && !config.USE_REAL_PRICES) {
      logger.info('Using Simulated WebSocket feed for ultra-fast ticking');
      this.startSimulatorFeed();
      return;
    }

    // Defaulting to Polygon.io Forex WebSocket as a placeholder
    // User can change the URL / Auth based on their final provider
    const wsUrl = process.env.WS_PROVIDER_URL || 'wss://socket.polygon.io/forex';
    const apiKey = process.env.MASSIVE_API_KEY || 'RPlbk0FN2femlRAfRNE_SafThj2x3TYj';
    
    logger.info(`Connecting to WebSocket feed at ${wsUrl}...`);
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      logger.info('WebSocket Connected');
      // Polygon Auth example
      this.ws?.send(JSON.stringify({ action: 'auth', params: apiKey }));
      
      // Subscribe to active instruments
      const subs = this.activeInstruments.map(i => `C.${i.replace('/', '')}`).join(',');
      this.ws?.send(JSON.stringify({ action: 'subscribe', params: subs }));
      
      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.ping();
        }
      }, 30000);
    });

    this.ws.on('message', async (data: string) => {
      try {
        const payload = JSON.parse(data);
        if (Array.isArray(payload)) {
          for (const msg of payload) {
             if (msg.ev === 'C') {
               // Parse Quote (Polygon Format)
               const instrument = this.parseInstrument(msg.pair);
               const quote = {
                 instrument,
                 time: new Date(msg.t).toISOString(),
                 bid: msg.b,
                 ask: msg.a
               };
               // Cache in Redis for instant read by PriceFeed
               await redis.setCache(`quote:${instrument}`, quote, 60);
             }
          }
        }
      } catch (err) {
        logger.debug(`WS Parse Error: ${err}`);
      }
    });

    this.ws.on('close', () => {
      logger.warn('WebSocket Disconnected. Reconnecting in 5s...');
      if (this.pingInterval) clearInterval(this.pingInterval);
      setTimeout(() => this.start(), 5000);
    });

    this.ws.on('error', (err) => {
      logger.error(`WebSocket Error: ${err.message}`);
    });
  }

  private static parseInstrument(pair: string): string {
    // converts EURUSD to EUR/USD
    if (pair === 'XAUUSD') return 'XAU/USD';
    if (pair.length === 6) {
      return `${pair.substring(0,3)}/${pair.substring(3,6)}`;
    }
    return pair;
  }

  private static startSimulatorFeed() {
    const basePrices: Record<string, number> = {
      'EUR/USD': 1.0850,
      'GBP/USD': 1.2700,
      'USD/JPY': 155.50,
      'XAU/USD': 2600.00
    };

    const spreads: Record<string, number> = {
      'EUR/USD': 0.00015,
      'GBP/USD': 0.00020,
      'USD/JPY': 0.015,
      'XAU/USD': 0.30
    };

    setInterval(async () => {
      for (const inst of this.activeInstruments) {
        let currentMid = basePrices[inst];
        const vol = currentMid * 0.00005; 
        currentMid += (Math.random() - 0.5) * vol;
        basePrices[inst] = currentMid; // update internal state
        
        const spread = spreads[inst] || 0.0002;
        const bid = currentMid - (spread / 2);
        const ask = currentMid + (spread / 2);
        
        const quote = {
          instrument: inst,
          time: new Date().toISOString(),
          bid: parseFloat(bid.toFixed(inst.includes('JPY') || inst.includes('XAU') ? 3 : 5)),
          ask: parseFloat(ask.toFixed(inst.includes('JPY') || inst.includes('XAU') ? 3 : 5))
        };

        // Cache in Redis for instant read by PriceFeed
        await redis.setCache(`quote:${inst}`, quote, 60);
      }
    }, 100); // Super fast 100ms ticks!
  }
}
