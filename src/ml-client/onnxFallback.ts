import { Candle } from '../data/priceFeed';
import { logger } from '../logger';

export interface MLPrediction {
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  probabilities?: { BUY: number; SELL: number; HOLD: number };
  source: 'python_service' | 'onnx_fallback' | 'heuristic_fallback';
}

export class OnnxFallbackClient {
  /**
   * Evaluates prediction using lightweight local heuristic fallback when Python ML service is unreachable.
   */
  public static predict(instrument: string, candles: Candle[]): MLPrediction {
    if (candles.length < 20) {
      return { action: 'HOLD', confidence: 0.0, source: 'heuristic_fallback' };
    }

    const closes = candles.slice(-20).map(c => c.close);
    const sma9 = closes.slice(-9).reduce((a, b) => a + b, 0) / 9;
    const sma21 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;

    const currentPrice = closes[closes.length - 1];
    const diffPct = (sma9 - sma21) / sma21;

    let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let confidence = 0.50;

    if (diffPct > 0.001) {
      action = 'BUY';
      confidence = Math.min(0.85, 0.55 + diffPct * 50);
    } else if (diffPct < -0.001) {
      action = 'SELL';
      confidence = Math.min(0.85, 0.55 + Math.abs(diffPct) * 50);
    }

    logger.info(`[ONNX/LOCAL FALLBACK] ML Prediction for ${instrument}: ${action} (Confidence: ${(confidence * 100).toFixed(1)}%)`);

    return {
      action,
      confidence,
      probabilities: {
        BUY: action === 'BUY' ? confidence : (1 - confidence) / 2,
        SELL: action === 'SELL' ? confidence : (1 - confidence) / 2,
        HOLD: action === 'HOLD' ? 0.60 : 0.20,
      },
      source: 'onnx_fallback',
    };
  }
}
