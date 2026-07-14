import os
from models.xgboost_model import XGBoostModelManager

class TrainMetrics:
    def __init__(self, accuracy: float, precision: float, recall: float):
        self.accuracy = accuracy
        self.precision = precision
        self.recall = recall

class TrainResult:
    def __init__(self, model_id: str, accuracy: float, precision: float, recall: float, notes: str):
        self.model_id = model_id
        self.metrics = TrainMetrics(accuracy, precision, recall)
        self.notes = notes

class ModelWrapper:
    def __init__(self, manager: XGBoostModelManager):
        self.manager = manager
        self.model_id = f"xgb_{manager.instrument.lower()}_v1"
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
        
        probs = self.manager.model.predict_proba(X)[0]
        import numpy as np
        pred_class = int(np.argmax(probs))
        confidence = float(probs[pred_class])
        
        class_map = {0: "SELL", 1: "HOLD", 2: "BUY"}
        action = class_map.get(pred_class, "HOLD")
        
        return action, confidence

def train_model(features_df, model_type: str, instrument: str) -> TrainResult:
    """
    Trains the XGBoost model on the features DataFrame.
    """
    manager = XGBoostModelManager(instrument)
    
    # We need candles list to train the model manager, or we can train directly in pandas.
    # In xgboost_model.py, we have `train(candles_data)`.
    # Let's convert features_df back to dict array or let XGBoostModelManager do it.
    # Actually, we can pass features_df to dict array:
    candles_data = features_df.to_dict('records')
    
    metrics = manager.train(candles_data)
    
    model_id = f"xgb_{instrument.lower()}_v1"
    notes = f"Trained {model_type} on {metrics['train_size']} rows, validated on {metrics['test_size']} rows."
    
    return TrainResult(
        model_id=model_id,
        accuracy=metrics["accuracy"],
        precision=metrics["precision"],
        recall=metrics["recall"],
        notes=notes
    )

def load_latest_model(instrument: str) -> ModelWrapper | None:
    """
    Loads the latest model for the instrument and wraps it.
    """
    manager = XGBoostModelManager(instrument)
    loaded = manager.load_model()
    if loaded:
        return ModelWrapper(manager)
    return None
