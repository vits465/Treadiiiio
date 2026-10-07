import * as path from 'path';
import * as fs from 'fs';
import { Candle } from '../data/priceFeed';
import { logger } from '../logger';
import { db } from '../db';

export interface MLPrediction {
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  probabilities?: { BUY: number; SELL: number; HOLD: number };
  model_id?: string;
  source: 'python_service' | 'onnx_fallback' | 'heuristic_fallback';
}

export class OnnxFallbackClient {
  private static sessionCache: Map<string, any> = new Map();
  private static ort: any = null;
  private static ortLoaded = false;

  private static getOrt() {
    if (!this.ortLoaded) {
      try {
        this.ort = require('onnxruntime-node');
      } catch (err) {
        logger.warn(`onnxruntime-node not available: ${err}`);
        this.ort = null;
      }
      this.ortLoaded = true;
    }
    return this.ort;
  }

  /**
   * Evaluates prediction using in-process ONNX model fallback or local heuristic.
   */
  public static async predict(instrument: string, candles: Candle[]): Promise<MLPrediction> {
    if (candles.length < 20) {
      return { action: 'HOLD', confidence: 0.0, source: 'heuristic_fallback' };
    }

    // 1. Try in-process ONNX inference
    try {
      const onnxPrediction = await this.predictOnnx(instrument, candles);
      if (onnxPrediction) {
        return onnxPrediction;
      }
    } catch (err: any) {
      logger.warn(`In-process ONNX inference failed for ${instrument} (${err.message}). Falling back to heuristic.`);
    }

    // 2. Local heuristic predictor fallback
    return this.predictHeuristic(instrument, candles);
  }

  /**
   * Attempts to run inference using exported ONNX model artifact.
   */
  private static async predictOnnx(instrument: string, candles: Candle[]): Promise<MLPrediction | null> {
    const ort = this.getOrt();
    if (!ort) return null;

    // Find active ONNX path from SQLite or artifacts directory
    let onnxPath: string | null = null;
    let modelId: string | undefined = undefined;

    try {
      const row = db.prepare('SELECT model_id, onnx_path FROM ml_models WHERE instrument = ? AND is_active = 1 ORDER BY trained_at DESC LIMIT 1').get(instrument) as any;
      if (row && row.onnx_path && fs.existsSync(row.onnx_path)) {
        onnxPath = row.onnx_path;
        modelId = row.model_id;
      }
    } catch (e) {
      // DB query failed or table not ready
    }

    if (!onnxPath) {
      const safeName = instrument.toLowerCase().replace('/', '_').replace('\\', '_');
      const artifactsDir = path.join(process.cwd(), 'ml-service', 'models', 'model_artifacts');
      if (fs.existsSync(artifactsDir)) {
        const files = fs.readdirSync(artifactsDir).filter(f => f.startsWith(`xgb_${safeName}`) && f.endsWith('.onnx'));
        if (files.length > 0) {
          files.sort();
          onnxPath = path.join(artifactsDir, files[files.length - 1]);
          modelId = files[files.length - 1].replace('.onnx', '');
        }
      }
    }

    if (!onnxPath || !fs.existsSync(onnxPath)) {
      return null;
    }

    // Get or create session
    let session = this.sessionCache.get(onnxPath);
    if (!session) {
      session = await ort.InferenceSession.create(onnxPath);
      this.sessionCache.set(onnxPath, session);
      logger.info(`Loaded in-process ONNX model session for ${instrument} from ${onnxPath}`);
    }

    // Extract 19-dimensional feature vector matching FEATURES
    const features = this.extractFeatures(candles);
    if (!features) return null;

    const tensor = new ort.Tensor('float32', new Float32Array(features), [1, features.length]);
    const feeds: Record<string, any> = {};
    feeds[session.inputNames[0]] = tensor;

    const results = await session.run(feeds);
    
    // ONNX XGBoost output contains 'probabilities' or output tensor
    let probs: number[] = [0.33, 0.34, 0.33];
    if (results.probabilities) {
      probs = Array.from(results.probabilities.data as Float32Array);
    } else if (results[session.outputNames[1]]) {
      probs = Array.from(results[session.outputNames[1]].data as Float32Array);
    } else if (results[session.outputNames[0]]) {
      probs = Array.from(results[session.outputNames[0]].data as Float32Array);
    }

    // Map: 0 = SELL, 1 = HOLD, 2 = BUY
    const sellProb = probs[0] || 0;
    const holdProb = probs[1] || 0;
    const buyProb = probs[2] || 0;

    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let confidence = holdProb;

    if (buyProb > sellProb && buyProb > holdProb) {
      action = 'BUY';
      confidence = buyProb;
    } else if (sellProb > buyProb && sellProb > holdProb) {
      action = 'SELL';
      confidence = sellProb;
    }

    logger.info(`[ONNX IN-PROCESS] ${instrument} => ${action} (Conf: ${(confidence * 100).toFixed(1)}%, Model: ${modelId})`);

    return {
      action,
      confidence,
      probabilities: { BUY: buyProb, SELL: sellProb, HOLD: holdProb },
      model_id: modelId,
      source: 'onnx_fallback',
    };
  }

  /**
   * Lightweight indicator feature extraction in TypeScript matching FEATURES schema.
   */
  private static extractFeatures(candles: Candle[]): number[] | null {
    if (candles.length < 30) return null;

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const n = closes.length;

    // Moving averages
    const sma9 = closes.slice(-9).reduce((a, b) => a + b, 0) / 9;
    const sma21 = closes.slice(-21).reduce((a, b) => a + b, 0) / 21;

    // ATR 14
    let atrSum = 0;
    for (let i = n - 14; i < n; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      atrSum += tr;
    }
    const atr14 = Math.max(atrSum / 14, 1e-4);

    // MACD (12, 26, 9)
    const ema12 = closes.slice(-12).reduce((a, b) => a + b, 0) / 12;
    const ema26 = closes.slice(-26).reduce((a, b) => a + b, 0) / 26;
    const macd = ema12 - ema26;
    const macdSignal = macd * 0.8;
    const macdHist = macd - macdSignal;

    // RSI 14
    let gains = 0;
    let losses = 0;
    for (let i = n - 14; i < n; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const rs = losses === 0 ? 100 : gains / losses;
    const rsi14 = 100 - (100 / (1 + rs));

    // Bollinger Band Width
    const stdDev = Math.sqrt(closes.slice(-20).map(x => Math.pow(x - sma21, 2)).reduce((a, b) => a + b, 0) / 20);
    const bbWidth = (4 * stdDev) / (sma21 || 1);

    // ROC 10
    const roc10 = ((closes[n - 1] - closes[n - 11]) / (closes[n - 11] || 1)) * 100;

    // ADX proxy
    const adx14 = 25.0;
    const atrPercentile = 0.50;

    // Stationary ratios
    const priceToSma21Atr = (closes[n - 1] - sma21) / atr14;
    const smaDiffAtr = (sma9 - sma21) / atr14;

    // Strategy indicator features
    const featMaCrossover = sma9 > sma21 ? 1.0 : -1.0;
    const featRsiReversion = rsi14 < 30 ? 1.0 : (rsi14 > 70 ? -1.0 : 0.0);
    const featBollingerReversion = closes[n - 1] < (sma21 - 2 * stdDev) ? 1.0 : (closes[n - 1] > (sma21 + 2 * stdDev) ? -1.0 : 0.0);

    // Time features
    const lastDate = new Date(candles[candles.length - 1].time);
    const hour = lastDate.getUTCHours();
    const day = lastDate.getUTCDay();
    const isLondon = (hour >= 7 && hour < 16) ? 1.0 : 0.0;
    const isNy = (hour >= 13 && hour < 21) ? 1.0 : 0.0;
    const isAsian = (hour >= 0 && hour < 9) ? 1.0 : 0.0;

    return [
      macd, macdSignal, macdHist,
      rsi14, bbWidth, atr14, roc10,
      adx14, atrPercentile,
      priceToSma21Atr, smaDiffAtr,
      featMaCrossover, featRsiReversion, featBollingerReversion,
      hour, day, isLondon, isNy, isAsian
    ];
  }

  /**
   * Fallback heuristic rule evaluator.
   */
  private static predictHeuristic(instrument: string, candles: Candle[]): MLPrediction {
    const closes = candles.slice(-20).map(c => c.close);
    const sma9 = closes.slice(-9).reduce((a, b) => a + b, 0) / 9;
    const sma21 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;

    const diffPct = (sma9 - sma21) / (sma21 || 1);

    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let confidence = 0.50;

    if (diffPct > 0.001) {
      action = 'BUY';
      confidence = Math.min(0.85, 0.55 + diffPct * 50);
    } else if (diffPct < -0.001) {
      action = 'SELL';
      confidence = Math.min(0.85, 0.55 + Math.abs(diffPct) * 50);
    }

    logger.info(`[HEURISTIC FALLBACK] ML Prediction for ${instrument}: ${action} (Confidence: ${(confidence * 100).toFixed(1)}%)`);

    return {
      action,
      confidence,
      probabilities: {
        BUY: action === 'BUY' ? confidence : (1 - confidence) / 2,
        SELL: action === 'SELL' ? confidence : (1 - confidence) / 2,
        HOLD: action === 'HOLD' ? 0.60 : 0.20,
      },
      source: 'heuristic_fallback',
    };
  }
}
