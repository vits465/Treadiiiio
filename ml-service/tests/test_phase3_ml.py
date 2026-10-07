import pytest
import numpy as np
import pandas as pd
import sys
import os
import shutil

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from models.xgboost_model import XGBoostModelManager, FEATURES
from models.drift import calculate_psi, calculate_ks, check_feature_drift

def test_xgboost_train_walkforward_and_onnx(tmp_path):
    # Generate 150 synthetic candles
    np.random.seed(42)
    n = 150
    dates = pd.date_range("2026-01-01", periods=n, freq="15min")
    prices = 2000.0 + np.cumsum(np.random.normal(0, 1.5, n))
    
    candles = []
    for i in range(n):
        p = prices[i]
        candles.append({
            "time": str(dates[i]),
            "open": p,
            "high": p + abs(np.random.normal(0, 0.8)),
            "low": p - abs(np.random.normal(0, 0.8)),
            "close": p + np.random.normal(0, 0.3),
            "volume": int(np.random.randint(100, 1000))
        })

    manager = XGBoostModelManager("XAU_USD", model_id="test_xgb_xau")
    
    metrics = manager.train(candles, sl_mult=1.5, tp_mult=3.0, holding_period=10)

    # 1. Metrics check
    assert "accuracy" in metrics
    assert "cv_accuracy" in metrics
    assert "model_hash" in metrics
    assert len(metrics["model_hash"]) == 64  # SHA256 length
    assert metrics["train_size"] > 0
    assert metrics["test_size"] > 0

    # 2. ONNX artifact verification
    assert os.path.exists(manager.onnx_path)
    assert os.path.getsize(manager.onnx_path) > 100

    # 3. Model predict with calibrated probabilities
    pred = manager.predict(candles[-40:])
    assert pred["action"] in ["BUY", "SELL", "HOLD"]
    assert 0.0 <= pred["confidence"] <= 1.0
    assert "probabilities" in pred
    probs = pred["probabilities"]
    assert abs((probs["BUY"] + probs["SELL"] + probs["HOLD"]) - 1.0) < 0.05

    # 4. Clean up test artifacts
    if os.path.exists(manager.model_path):
        os.remove(manager.model_path)
    if os.path.exists(manager.onnx_path):
        os.remove(manager.onnx_path)

def test_drift_detection_comprehensive():
    base_stats = {
        "rsi_14": {"mean": 50.0, "std": 10.0},
        "adx_14": {"mean": 25.0, "std": 5.0},
        "atr_14": {"mean": 1.2, "std": 0.3}
    }

    # Case 1: Normal distribution without drift
    normal_df = pd.DataFrame({
        "rsi_14": np.random.normal(50.0, 10.0, 100),
        "adx_14": np.random.normal(25.0, 5.0, 100),
        "atr_14": np.random.normal(1.2, 0.3, 100)
    })
    report = check_feature_drift(base_stats, normal_df)
    assert report["recommendation"] in ["NO_ACTION", "WARNING"]

    # Case 2: Heavily shifted distribution (extreme drift)
    shifted_df = pd.DataFrame({
        "rsi_14": np.random.normal(85.0, 5.0, 100),
        "adx_14": np.random.normal(55.0, 5.0, 100),
        "atr_14": np.random.normal(5.0, 1.0, 100)
    })
    report_drifted = check_feature_drift(base_stats, shifted_df)
    assert report_drifted["drift_detected"] is True
    assert report_drifted["recommendation"] == "RETRAIN_RECOMMENDED"
    assert len(report_drifted["drifted_features"]) >= 2
