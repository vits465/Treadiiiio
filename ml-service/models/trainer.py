import os
from models.xgboost_model import XGBoostModelManager
from models.lstm_model import LSTMModelManager
from database import get_db_connection
from datetime import datetime
import json
import logging

logger = logging.getLogger(__name__)

class TrainMetrics:
    def __init__(self, accuracy: float, precision: float, recall: float):
        self.accuracy = accuracy
        self.precision = precision
        self.recall = recall

class TrainResult:
    def __init__(self, model_id: str, accuracy: float, precision: float, recall: float, notes: str, top_features: dict = None):
        self.model_id = model_id
        self.metrics = TrainMetrics(accuracy, precision, recall)
        self.notes = notes
        self.top_features = top_features or {}

class ModelWrapper:
    def __init__(self, manager):
        self.manager = manager
        self.model_id = manager.model_id
        self.min_lookback = 30

    def predict(self, features_row) -> tuple[str, float]:
        """
        Predicts action ("BUY", "SELL", "HOLD") and confidence from a single row of features.
        """
        # Call predict using the underlying XGBoost manager
        # Since prediction expected raw candles in the manager, let's write a simple row predictor
        if self.manager.model is None:
            raise ValueError("Model is not loaded.")
            
        # Re-map features columns
        from models.xgboost_model import FEATURES
        X = features_row[FEATURES]
        
        if self.model_id.startswith("lstm"):
            import torch
            # Requires a sequence, but here we only have one row. We'll duplicate it to make a sequence of length 10
            # Note: For production LSTM, the API should pass the last 10 rows. This is a shim for single-row inference.
            X_scaled = self.manager.scaler.transform(X)
            seq = np.tile(X_scaled, (self.manager.sequence_length, 1))
            X_seq = torch.Tensor(seq).unsqueeze(0).to(self.manager.device)
            self.manager.model.eval()
            with torch.no_grad():
                probs = self.manager.model(X_seq).cpu().numpy()[0]
        else:
            probs = self.manager.model.predict_proba(X)[0]
            
        import numpy as np
        pred_class = int(np.argmax(probs))
        confidence = float(probs[pred_class])
        
        class_map = {0: "SELL", 1: "HOLD", 2: "BUY"}
        action = class_map.get(pred_class, "HOLD")

        # Concept Drift Detection
        if self.manager.feature_stats:
            drift_detected = False
            for feature, stats in self.manager.feature_stats.items():
                if feature in features_row:
                    live_val = features_row[feature].iloc[0] if hasattr(features_row[feature], 'iloc') else features_row[feature]
                    mean = stats['mean']
                    std = stats['std']
                    if std > 0:
                        z_score = abs(live_val - mean) / std
                        if z_score > 3.0:
                            logger.warning(f"Drift detected in {feature}! Z-score: {z_score:.2f} (Live: {live_val:.3f}, Train Mean: {mean:.3f})")
                            drift_detected = True
            
            if drift_detected:
                confidence -= 0.20
                confidence = max(0.0, confidence)
                logger.warning(f"Applied -0.20 drift penalty to {self.manager.instrument} prediction. New confidence: {confidence:.2f}")

        return action, confidence

def train_model(features_df, model_type: str, instrument: str) -> TrainResult:
    """
    Trains the specified model on the features DataFrame.
    """
    if model_type == "lstm":
        manager = LSTMModelManager(instrument)
    else:
        manager = XGBoostModelManager(instrument)
    
    # We need candles list to train the model manager, or we can train directly in pandas.
    # In xgboost_model.py, we have `train(candles_data)`.
    # Let's convert features_df back to dict array or let XGBoostModelManager do it.
    # Actually, we can pass features_df to dict array:
    candles_data = features_df.to_dict('records')
    
    metrics = manager.train(candles_data)
    
    model_id = metrics.get('model_id')
    notes = f"Trained {model_type} on {metrics['train_size']} rows, validated on {metrics['test_size']} rows."
    
    # Save to SQLite registry
    with get_db_connection() as conn:
        # Demote old models
        conn.execute("UPDATE ml_models SET is_active = 0 WHERE instrument = ?", (instrument,))
        
        # Insert new model
        shap_importance = json.dumps(metrics.get("top_features", {}))
        metrics_json = json.dumps(metrics)
        conn.execute(
            """INSERT INTO ml_models (model_id, instrument, trained_at, metrics, shap_importance, is_active)
               VALUES (?, ?, ?, ?, ?, 1)""",
            (model_id, instrument, datetime.utcnow().isoformat(), metrics_json, shap_importance)
        )
        conn.commit()

    return TrainResult(
        model_id=model_id,
        accuracy=metrics["accuracy"],
        precision=metrics["precision"],
        recall=metrics["recall"],
        notes=notes,
        top_features=metrics.get("top_features", {})
    )

def load_latest_model(instrument: str) -> ModelWrapper | None:
    """
    Loads the latest active model for the instrument from SQLite.
    """
    model_id = None
    with get_db_connection() as conn:
        row = conn.execute("SELECT model_id FROM ml_models WHERE instrument = ? AND is_active = 1 ORDER BY trained_at DESC LIMIT 1", (instrument,)).fetchone()
        if row:
            model_id = row['model_id']
            
    if not model_id:
        return None
        
    if model_id.startswith("lstm"):
        manager = LSTMModelManager(instrument, model_id)
    else:
        manager = XGBoostModelManager(instrument, model_id)
        
    loaded = manager.load_model()
    if loaded:
        return ModelWrapper(manager)
    return None
