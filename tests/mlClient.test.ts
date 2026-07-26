import { MLClient } from '../src/ml-client';
import { OnnxFallbackClient } from '../src/ml-client/onnxFallback';
import { Candle } from '../src/data/priceFeed';

function makeCandle(close: number): Candle {
  return {
    time: new Date().toISOString(),
    instrument: 'EUR/USD',
    granularity: '1h',
    open: close,
    high: close + 0.0010,
    low: close - 0.0010,
    close,
    volume: 100,
  };
}

describe('MLClient & Local Fallback Serving', () => {
  test('evaluates local fallback when Python ML service is offline', async () => {
    const candles: Candle[] = [];
    let price = 1.0800;
    for (let i = 0; i < 25; i++) {
      price += 0.0010;
      candles.push(makeCandle(price));
    }

    const signal = await MLClient.predict('EUR/USD', candles);
    if (signal) {
      expect(['BUY', 'SELL']).toContain(signal.action);
      expect(signal.strategy).toBe('ml_xgb_fallback');
      expect(signal.confidence).toBeGreaterThanOrEqual(0.62);
    }
  });

  test('OnnxFallbackClient predicts BUY in uptrend', () => {
    const candles: Candle[] = [];
    let price = 1.0800;
    for (let i = 0; i < 25; i++) {
      price += 0.0010;
      candles.push(makeCandle(price));
    }

    const res = OnnxFallbackClient.predict('EUR/USD', candles);
    expect(res.action).toBe('BUY');
    expect(res.confidence).toBeGreaterThan(0.60);
    expect(res.source).toBe('onnx_fallback');
  });
});
