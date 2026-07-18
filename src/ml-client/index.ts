import axios from 'axios';
import { config } from '../config';
import { logger } from '../logger';
import { db } from '../db';
import { Candle } from '../data/priceFeed';
import { Signal, SignalAction } from '../strategy/strategy.interface';
import { RejectionLogger } from '../risk/rejectionLogger';
import { v4 as uuidv4 } from 'uuid';

export class MLClient {
  private static client = axios.create({
    baseURL: config.ML_SERVICE_URL,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': config.API_SECRET_KEY,
    },
    timeout: 15000, // 15s timeout
  });

  /**
   * Fetches a trading signal for an instrument from the ML FastAPI service.
   *
   * Changes in Realistic Edge upgrade:
   *   - Below-threshold predictions are logged to filter_rejections (ML_CONFIDENCE_LOW)
   *     AND to ml_confidence_log with accepted=0 so threshold calibration can be
   *     analysed from the DB.
   *   - Accepted predictions are logged with accepted=1.
   *   - prediction.atr is now forwarded on the returned Signal so the engine
   *     can use ATR-based SL/TP sizing for ML trades (previously silently dropped).
   */
  public static async predict(instrument: string, candles: Candle[]): Promise<Signal | null> {
    try {
      const payload = {
        instrument,
        candles: candles.map((c) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        })),
      };

      const response = await this.client.post('/predict', payload);
      const prediction = response.data; // response is direct PredictResponse schema

      if (!prediction || prediction.action === 'HOLD') {
        return null;
      }

      // Below-threshold confidence — log it for calibration analysis, then reject
      if (prediction.confidence !== undefined && prediction.confidence < config.ML_MIN_CONFIDENCE) {
        logger.debug(
          `ML Signal rejected for ${instrument}: confidence ${prediction.confidence.toFixed(3)} < min ${config.ML_MIN_CONFIDENCE}`
        );

        // Log to rejection audit table
        RejectionLogger.log(
          'MLClient.predict',
          'ML_CONFIDENCE_LOW',
          instrument,
          prediction.action,
          'ml_signal',
          `confidence=${prediction.confidence.toFixed(4)} threshold=${config.ML_MIN_CONFIDENCE}`,
          prediction.confidence
        );

        // Log to ml_confidence_log with accepted=0 for calibration analysis
        try {
          db.prepare(`
            INSERT INTO ml_confidence_log (id, signal_time, instrument, confidence, action, accepted)
            VALUES (?, ?, ?, ?, ?, 0)
          `).run(uuidv4(), new Date().toISOString(), instrument, prediction.confidence, prediction.action);
        } catch (err) {
          logger.debug(`Could not log below-threshold ML confidence: ${err}`);
        }

        return null;
      }

      // Accepted prediction — log with accepted=1
      try {
        db.prepare(`
          INSERT INTO ml_confidence_log (id, signal_time, instrument, confidence, action, accepted)
          VALUES (?, ?, ?, ?, ?, 1)
        `).run(uuidv4(), new Date().toISOString(), instrument, prediction.confidence || 0, prediction.action);
      } catch (err) {
        logger.debug(`Could not log ML confidence: ${err}`);
      }

      // Bug fix: prediction.atr was computed by Python but never forwarded
      // into executeOrder, so ATR-based SL/TP sizing never activated for ML trades.
      // It is now explicitly included in the returned Signal.
      return {
        action: prediction.action as SignalAction,
        instrument,
        strategy: 'ml_xgb',
        confidence: prediction.confidence,
        atr: prediction.atr,          // ← bug fix: was silently dropped before
        stopLossPips: prediction.stop_loss_pips,
        takeProfitPips: prediction.take_profit_pips,
      };
    } catch (error: any) {
      if (error.response && error.response.status === 404) {
        logger.warn(`No trained ML model found for ${instrument}. Skipping ML prediction.`);
        return null;
      }
      logger.error(`ML Client predict failed for ${instrument}: ${error.message}`);
      return null;
    }
  }

  /**
   * Triggers model retraining on the provided candles.
   */
  public static async train(instrument: string, candles: Candle[]): Promise<any> {
    try {
      logger.info(`Triggering model training in ML Service for ${instrument}...`);
      
      const payload = {
        instrument,
        granularity: config.CANDLE_GRANULARITY,
        lookback_days: 365,
        model_type: 'xgboost'
      };

      const response = await this.client.post('/train', payload);
      const data = response.data; // response is direct TrainResponse schema
      
      if (data && data.model_id) {
        // Map python metrics to local DB metrics schema
        const f1 = (2 * data.validation_precision * data.validation_recall) / (data.validation_precision + data.validation_recall || 1);
        const metrics = {
          accuracy: data.validation_accuracy,
          precision: data.validation_precision,
          recall: data.validation_recall,
          f1_score: parseFloat(f1.toFixed(4)),
          test_win_rate: data.validation_accuracy, // fallback to accuracy
          train_size: data.train_rows,
          notes: data.notes
        };

        const runId = uuidv4();
        const timestamp = new Date().toISOString();

        db.prepare(`
          INSERT INTO model_runs (run_id, timestamp, metrics_json)
          VALUES (?, ?, ?)
        `).run(runId, timestamp, JSON.stringify(metrics));

        logger.info(`📊 Model retrained successfully for ${instrument}. Model ID: ${data.model_id}. Test Accuracy: ${(metrics.accuracy * 100).toFixed(2)}%, Notes: ${metrics.notes}`);
        return metrics;
      }
      
      return null;
    } catch (error: any) {
      logger.error(`ML Client training trigger failed for ${instrument}: ${error.message}`);
      throw error;
    }
  }
}
