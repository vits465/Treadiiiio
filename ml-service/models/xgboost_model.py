import os
import joblib
import pandas as pd
import numpy as np
from xgboost import XGBClassifier
from sklearn.metrics import accuracy_score, precision_recall_fscore_support
from features.engineering import compute_features
import shap
import time
import json

MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
ARTIFACTS_DIR = os.path.join(MODEL_DIR, "model_artifacts")
os.makedirs(ARTIFACTS_DIR, exist_ok=True)

FEATURES = [
    'sma_9', 'sma_21', 'ema_12', 'ema_26', 'macd', 'macd_signal', 'macd_hist',
    'rsi_14', 'bb_width', 'atr_14', 'roc_10', 
    'feat_ma_crossover', 'feat_rsi_reversion', 'feat_bollinger_reversion'
]

class XGBoostModelManager:
  def __init__(self, instrument: str, model_id: str = None):
    self.instrument = instrument
    self.safe_name = instrument.lower().replace("/", "_").replace("\\", "_")
    self.model_id = model_id or f"xgb_{self.safe_name}_{int(time.time())}"
    self.model_path = os.path.join(ARTIFACTS_DIR, f"{self.model_id}.joblib")
    self.model = None
    self.feature_stats = {} # {feature: {'mean': float, 'std': float}}

  def load_model(self, path=None):
    load_path = path or self.model_path
    if os.path.exists(load_path):
      saved_data = joblib.load(load_path)
      # Support legacy format (just the model) or new format (dict with model and stats)
      if isinstance(saved_data, dict) and 'model' in saved_data:
        self.model = saved_data['model']
        self.feature_stats = saved_data.get('feature_stats', {})
      else:
        self.model = saved_data
      return True
    return False

  def save_model(self):
    if self.model is not None:
      data_to_save = {
        'model': self.model,
        'feature_stats': self.feature_stats
      }
      joblib.dump(data_to_save, self.model_path)

  def prepare_labels(self, df: pd.DataFrame, forward_periods: int = 5, threshold_pct: float = 0.0005):
    """
    Generate target labels based on future price change.
    2 = BUY (forward return > threshold)
    0 = SELL (forward return < -threshold)
    1 = HOLD (otherwise)
    """
    df = df.copy()
    future_close = df['close'].shift(-forward_periods)
    forward_return = (future_close - df['close']) / df['close']
    
    conditions = [
        (forward_return > threshold_pct),
        (forward_return < -threshold_pct)
    ]
    choices = [2, 0] # 2: BUY, 0: SELL
    df['target'] = np.select(conditions, choices, default=1) # 1: HOLD
    
    # Drop rows at the end where target cannot be computed
    df = df.dropna(subset=['target'])
    df['target'] = df['target'].astype(int)
    return df

  def train(self, candles_data: list, forward_periods: int = 5, threshold_pct: float = 0.0005) -> dict:
    """
    Trains the XGBoost model using walk-forward validation (split by time).
    candles_data: raw JSON list of candles with open, high, low, close, volume, time.
    """
    df_raw = pd.DataFrame(candles_data)
    if df_raw.empty or len(df_raw) < 100:
      raise ValueError("Insufficient candle data for training (need at least 100 candles).")

    # 1. Compute features
    df_features = compute_features(df_raw)
    
    # 2. Compute targets
    df_labeled = self.prepare_labels(df_features, forward_periods, threshold_pct)
    
    # Drop rows with NaNs in features
    df_clean = df_labeled.dropna(subset=FEATURES + ['target'])
    df_clean = df_clean.loc[:, ~df_clean.columns.duplicated()]
    if len(df_clean) < 50:
      raise ValueError("Insufficient data remaining after cleaning features.")

    # 3. Train/Test split by time (80% Train, 20% Test)
    split_idx = int(len(df_clean) * 0.8)
    train_df = df_clean.iloc[:split_idx]
    test_df = df_clean.iloc[split_idx:]

    X_train = train_df[FEATURES]
    y_train = train_df['target']
    X_test = test_df[FEATURES]
    y_test = test_df['target']

    # Handle class imbalance (use compute_sample_weight or standard parameters)
    classes = np.unique(y_train)
    
    # Initialize and fit XGBoost
    # Multiclass objective: multi:softprob
    self.model = XGBClassifier(
        n_estimators=150,
        max_depth=4,
        learning_rate=0.03,
        objective='multi:softprob',
        num_class=3,
        random_state=42,
        eval_metric='mlogloss'
    )
    
    self.model.fit(X_train, y_train)

    # Compute and store feature distributions
    for feature in FEATURES:
        self.feature_stats[feature] = {
            'mean': float(X_train[feature].mean()),
            'std': float(X_train[feature].std())
        }

    self.save_model()

    # 4. Evaluate out-of-sample metrics
    y_pred = self.model.predict(X_test)
    accuracy = accuracy_score(y_test, y_pred)
    
    # Precision, Recall, F1 per class (macro average)
    precision, recall, f1, _ = precision_recall_fscore_support(y_test, y_pred, average='macro', zero_division=0)

    # Calculate simple backtested performance metrics on test set
    # If prediction is BUY and true target is BUY -> correct.
    # If prediction is SELL and true target is SELL -> correct.
    # We can estimate a simple win rate or mock Sharpe.
    # Let's count trades and win rate:
    non_hold_trades = y_pred != 1
    total_trades = np.sum(non_hold_trades)
    
    win_rate = 0.0
    if total_trades > 0:
      correct_trades = np.sum((y_pred == y_test) & non_hold_trades)
      win_rate = float(correct_trades / total_trades)

    metrics = {
        "model_id": self.model_id,
        "dataset_size": len(df_clean),
        "train_size": len(train_df),
        "test_size": len(test_df),
        "accuracy": float(accuracy),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "total_test_trades": int(total_trades),
        "win_rate": win_rate
    }
    
    # Calculate SHAP feature importance
    try:
        explainer = shap.TreeExplainer(self.model)
        # TreeExplainer on multi-class returns a list of shape (classes, n_samples, n_features)
        shap_values = explainer.shap_values(X_test)
        if isinstance(shap_values, list):
            # Take absolute mean across all samples and classes
            mean_abs_shap = np.abs(shap_values).mean(axis=(0, 1))
        else:
            mean_abs_shap = np.abs(shap_values).mean(axis=0)

        importance_dict = {feat: float(score) for feat, score in zip(FEATURES, mean_abs_shap)}
        # Sort and take top 5
        top_features = dict(sorted(importance_dict.items(), key=lambda item: item[1], reverse=True)[:5])
        metrics["top_features"] = top_features
    except Exception as e:
        metrics["top_features"] = {"error": str(e)}

    return metrics

  def predict(self, recent_candles: list) -> dict:
    """
    Generates prediction for the latest candle.
    recent_candles: list of candles containing at least 30 candles to compute indicators.
    """
    if self.model is None:
      loaded = self.load_model()
      if not loaded:
        return {"action": "HOLD", "confidence": 0.0, "error": "Model not trained yet."}

    df_raw = pd.DataFrame(recent_candles)
    if len(df_raw) < 30:
      return {"action": "HOLD", "confidence": 0.0, "error": "Insufficient candles to extract features (need at least 30)."}

    # Compute features for the data
    df_features = compute_features(df_raw)
    
    # Take the very last row for prediction
    last_row = df_features.tail(1)
    
    if last_row[FEATURES].isnull().values.any():
      return {"action": "HOLD", "confidence": 0.0, "error": "Latest candle features contain NaN values."}

    X = last_row[FEATURES]
    
    # Predict probabilities
    probs = self.model.predict_proba(X)[0] # Array of 3 probabilities [P(SELL), P(HOLD), P(BUY)]
    pred_class = int(np.argmax(probs))
    confidence = float(probs[pred_class])

    # Map class back to action
    # 0 = SELL, 1 = HOLD, 2 = BUY
    class_map = {0: "SELL", 1: "HOLD", 2: "BUY"}
    action = class_map.get(pred_class, "HOLD")

    return {
        "action": action,
        "confidence": confidence,
        "probabilities": {
            "SELL": float(probs[0]),
            "HOLD": float(probs[1]),
            "BUY": float(probs[2])
        }
    }
