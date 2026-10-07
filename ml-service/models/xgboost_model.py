import os
import joblib
import pandas as pd
import numpy as np
import hashlib
import time
import json
import logging
from xgboost import XGBClassifier
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, brier_score_loss
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from features.engineering import compute_features, compute_triple_barrier_labels
from models.purged_cv import PurgedWalkForwardCV
import shap

try:
    import onnxmltools
    from onnxmltools.convert.common.data_types import FloatTensorType
    ONNX_AVAILABLE = True
except Exception:
    ONNX_AVAILABLE = False

logger = logging.getLogger(__name__)

MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
ARTIFACTS_DIR = os.path.join(MODEL_DIR, "model_artifacts")
os.makedirs(ARTIFACTS_DIR, exist_ok=True)

# Documented stationary & regime features available at prediction time
FEATURES = [
    'macd', 'macd_signal', 'macd_hist',
    'rsi_14', 'bb_width', 'atr_14', 'roc_10',
    'adx_14', 'atr_percentile',
    'price_to_sma21_atr', 'sma_diff_atr',
    'feat_ma_crossover', 'feat_rsi_reversion', 'feat_bollinger_reversion',
    'hour_of_day', 'day_of_week', 'is_london', 'is_ny', 'is_asian'
]

FEATURES_DOCUMENTATION = {
    'macd': 'MACD fast(12) - slow(26) line',
    'macd_signal': 'MACD signal line (9-period EMA)',
    'macd_hist': 'MACD histogram oscillator',
    'rsi_14': 'Relative Strength Index (14-period momentum)',
    'bb_width': 'Bollinger Band width (volatility proxy)',
    'atr_14': 'Average True Range (14-period)',
    'roc_10': 'Rate of Change (10-period price momentum)',
    'adx_14': 'Average Directional Index (>25 trending, <20 ranging)',
    'atr_percentile': 'Rolling 100-bar ATR percentile rank (0.0=lowest, 1.0=highest volatility)',
    'price_to_sma21_atr': 'Stationary normalized distance: (Close - SMA21) / ATR14',
    'sma_diff_atr': 'Stationary normalized MA spread: (SMA9 - SMA21) / ATR14',
    'feat_ma_crossover': 'Moving Average crossover regime (+1.0 bull, -1.0 bear)',
    'feat_rsi_reversion': 'RSI oversold/overbought zone (+1.0 oversold, -1.0 overbought)',
    'feat_bollinger_reversion': 'Bollinger band touch (+1.0 below lower, -1.0 above upper)',
    'hour_of_day': 'Hour of day in UTC (0-23)',
    'day_of_week': 'Day of week (0=Mon, 4=Fri)',
    'is_london': 'London session open flag (07:00 - 16:00 UTC)',
    'is_ny': 'New York session open flag (13:00 - 21:00 UTC)',
    'is_asian': 'Asian session flag (00:00 - 09:00 UTC)'
}

class XGBoostModelManager:
    def __init__(self, instrument: str, model_id: str = None):
        self.instrument = instrument
        self.safe_name = instrument.lower().replace("/", "_").replace("\\", "_")
        self.model_id = model_id or f"xgb_{self.safe_name}_{int(time.time())}"
        self.model_path = os.path.join(ARTIFACTS_DIR, f"{self.model_id}.joblib")
        self.onnx_path = os.path.join(ARTIFACTS_DIR, f"{self.model_id}.onnx")
        self.model = None
        self.calibrated_model = None
        self.feature_stats = {}  # {feature: {'mean': float, 'std': float}}
        self.calibration_data = {}
        self.model_hash = ""

    def load_model(self, path=None):
        load_path = path or self.model_path
        if os.path.exists(load_path):
            saved_data = joblib.load(load_path)
            if isinstance(saved_data, dict):
                self.model = saved_data.get('model')
                self.calibrated_model = saved_data.get('calibrated_model') or self.model
                self.feature_stats = saved_data.get('feature_stats', {})
                self.calibration_data = saved_data.get('calibration_data', {})
                self.model_hash = saved_data.get('model_hash', '')
            else:
                self.model = saved_data
                self.calibrated_model = saved_data
            return True
        return False

    def save_model(self):
        if self.model is not None:
            # Export to ONNX if available
            self.export_onnx()

            # Compute hash of model bytes / onnx
            hasher = hashlib.sha256()
            if os.path.exists(self.onnx_path):
                with open(self.onnx_path, 'rb') as f:
                    hasher.update(f.read())
            else:
                hasher.update(f"{self.model_id}_{time.time()}".encode())
            self.model_hash = hasher.hexdigest()

            data_to_save = {
                'model': self.model,
                'calibrated_model': self.calibrated_model,
                'feature_stats': self.feature_stats,
                'calibration_data': self.calibration_data,
                'model_hash': self.model_hash,
                'features': FEATURES,
                'instrument': self.instrument
            }
            joblib.dump(data_to_save, self.model_path)

    def export_onnx(self) -> bool:
        """
        Exports the trained XGBoost model to standard ONNX format for in-process Node.js execution.
        """
        if not ONNX_AVAILABLE or self.model is None:
            return False
        try:
            initial_types = [('float_input', FloatTensorType([None, len(FEATURES)]))]
            # XGBoost booster feature names must follow 'f%d' for onnxmltools conversion
            original_names = getattr(self.model.get_booster(), 'feature_names', None)
            self.model.get_booster().feature_names = [f'f{i}' for i in range(len(FEATURES))]
            onnx_model = onnxmltools.convert_xgboost(self.model, initial_types=initial_types)
            if original_names:
                self.model.get_booster().feature_names = original_names
            onnxmltools.utils.save_model(onnx_model, self.onnx_path)
            logger.info(f"Exported ONNX model artifact to {self.onnx_path}")
            return True
        except Exception as e:
            logger.warning(f"Could not export model to ONNX: {e}")
            return False

    def prepare_labels(self, df: pd.DataFrame, sl_mult: float = 1.5, tp_mult: float = 3.0, holding_period: int = 24) -> pd.DataFrame:
        """
        Triple-Barrier Labeling matching engine ATR SL/TP multipliers:
        2 = BUY, 0 = SELL, 1 = HOLD.
        """
        df = df.copy()
        df['target'] = compute_triple_barrier_labels(df, sl_mult=sl_mult, tp_mult=tp_mult, holding_period=holding_period)
        # Drop incomplete forward horizon rows
        df = df.dropna(subset=['target'])
        df['target'] = df['target'].astype(int)
        return df

    def train(self, candles_data: list, sl_mult: float = 1.5, tp_mult: float = 3.0, holding_period: int = 24) -> dict:
        """
        Trains XGBoost using Walk-Forward Validation with Purged/Embargoed Splits
        and calibrated probabilities via Platt scaling (sigmoid).
        """
        df_raw = pd.DataFrame(candles_data)
        if df_raw.empty or len(df_raw) < 100:
            raise ValueError("Insufficient candle data for training (need at least 100 candles).")

        # 1. Compute features
        df_features = compute_features(df_raw)

        # 2. Compute Triple-Barrier targets
        df_labeled = self.prepare_labels(df_features, sl_mult=sl_mult, tp_mult=tp_mult, holding_period=holding_period)

        # Drop rows with NaNs in features
        df_clean = df_labeled.dropna(subset=FEATURES + ['target'])
        df_clean = df_clean.loc[:, ~df_clean.columns.duplicated()]
        if len(df_clean) < 60:
            raise ValueError("Insufficient data remaining after computing features and triple-barrier labels.")

        X = df_clean[FEATURES].astype(float)
        y = df_clean['target'].astype(int)

        # 3. Purged Walk-Forward Cross Validation (3 splits, 24-bar purge matching holding period)
        cv = PurgedWalkForwardCV(n_splits=3, min_train_pct=0.55, purge_bars=holding_period, embargo_bars=6)

        def create_xgb():
            return XGBClassifier(
                n_estimators=150,
                max_depth=4,
                learning_rate=0.03,
                objective='multi:softprob',
                num_class=3,
                random_state=42,
                eval_metric='mlogloss'
            )

        cv_results = cv.evaluate(create_xgb, X, y)

        # 4. Final Train/Validation Split with Purge
        # Train on 75% minus purge bars, validate on final 25%
        split_idx = int(len(df_clean) * 0.75)
        train_end_idx = max(20, split_idx - holding_period)
        
        train_df = df_clean.iloc[:train_end_idx]
        val_df = df_clean.iloc[split_idx:]

        X_train, y_train = train_df[FEATURES].astype(float), train_df['target'].astype(int)
        X_val, y_val = val_df[FEATURES].astype(float), val_df['target'].astype(int)

        # Fit base model
        self.model = create_xgb()
        self.model.fit(X_train, y_train)

        # 5. Probability Calibration (Platt scaling / Sigmoid)
        try:
            try:
                from sklearn.frozen import FrozenEstimator
                self.calibrated_model = CalibratedClassifierCV(estimator=FrozenEstimator(self.model), method='sigmoid')
            except ImportError:
                self.calibrated_model = CalibratedClassifierCV(estimator=self.model, method='sigmoid', cv='prefit')
            self.calibrated_model.fit(X_val, y_val)
            calibrated_probs = self.calibrated_model.predict_proba(X_val)
        except Exception as e:
            logger.warning(f"CalibratedClassifierCV fallback to base model: {e}")
            self.calibrated_model = self.model
            calibrated_probs = self.model.predict_proba(X_val)

        # Compute calibration curve for BUY (class 2) and SELL (class 0)
        calib_curves = {}
        for c, label in [(2, 'BUY'), (0, 'SELL')]:
            if (y_val == c).sum() > 2:
                try:
                    prob_true, prob_pred = calibration_curve((y_val == c).astype(int), calibrated_probs[:, c], n_bins=5)
                    calib_curves[label] = {
                        "prob_true": prob_true.tolist(),
                        "prob_pred": prob_pred.tolist()
                    }
                except Exception:
                    pass

        self.calibration_data = {
            "method": "sigmoid_platt",
            "curves": calib_curves
        }

        # Store baseline feature distributions for drift detection
        for feature in FEATURES:
            self.feature_stats[feature] = {
                'mean': float(X_train[feature].mean()),
                'std': float(X_train[feature].std())
            }

        self.save_model()

        # 6. Out-of-sample evaluation on validation set
        y_val_pred = self.calibrated_model.predict(X_val)
        acc = accuracy_score(y_val, y_val_pred)
        prec, rec, f1, _ = precision_recall_fscore_support(y_val, y_val_pred, average='macro', zero_division=0)

        # Win rate of active trade signals (BUY / SELL)
        active_trades = y_val_pred != 1
        total_active = int(np.sum(active_trades))
        win_rate = 0.0
        if total_active > 0:
            correct_active = np.sum((y_val_pred == y_val) & active_trades)
            win_rate = float(correct_active / total_active)

        training_start = str(df_clean['time'].iloc[0]) if 'time' in df_clean.columns else "start"
        training_end = str(df_clean['time'].iloc[-1]) if 'time' in df_clean.columns else "end"

        metrics = {
            "model_id": self.model_id,
            "model_hash": self.model_hash,
            "dataset_size": len(df_clean),
            "train_size": len(train_df),
            "test_size": len(val_df),
            "accuracy": float(acc),
            "precision": float(prec),
            "recall": float(rec),
            "f1": float(f1),
            "win_rate": win_rate,
            "total_test_trades": total_active,
            "cv_accuracy": cv_results.get("cv_accuracy", float(acc)),
            "cv_f1": cv_results.get("cv_f1", float(f1)),
            "cv_folds": cv_results.get("folds", []),
            "training_window": {
                "start": training_start,
                "end": training_end,
                "samples": len(df_clean)
            },
            "onnx_path": self.onnx_path if os.path.exists(self.onnx_path) else None
        }

        # 7. SHAP Feature Importance
        try:
            explainer = shap.TreeExplainer(self.model)
            shap_values = explainer.shap_values(X_val)
            if isinstance(shap_values, list):
                mean_abs_shap = np.abs(shap_values).mean(axis=(0, 1))
            else:
                mean_abs_shap = np.abs(shap_values).mean(axis=0)

            importance_dict = {feat: float(score) for feat, score in zip(FEATURES, mean_abs_shap)}
            top_features = dict(sorted(importance_dict.items(), key=lambda item: item[1], reverse=True)[:5])
            metrics["top_features"] = top_features
        except Exception as e:
            metrics["top_features"] = {"error": str(e)}

        return metrics

    def predict(self, recent_candles: list) -> dict:
        """
        Generates calibrated prediction for the latest candle.
        """
        if self.model is None or self.calibrated_model is None:
            loaded = self.load_model()
            if not loaded:
                return {"action": "HOLD", "confidence": 0.0, "error": "Model not trained yet."}

        df_raw = pd.DataFrame(recent_candles)
        if len(df_raw) < 30:
            return {"action": "HOLD", "confidence": 0.0, "error": "Insufficient candles to extract features (need at least 30)."}

        # Compute features
        df_features = compute_features(df_raw)
        last_row = df_features.tail(1)

        if last_row[FEATURES].isnull().values.any():
            return {"action": "HOLD", "confidence": 0.0, "error": "Latest candle features contain NaN values."}

        X = last_row[FEATURES].astype(float)

        # Predict calibrated probabilities
        predictor = self.calibrated_model or self.model
        probs = predictor.predict_proba(X)[0]  # [P(SELL=0), P(HOLD=1), P(BUY=2)]
        pred_class = int(np.argmax(probs))
        confidence = float(probs[pred_class])

        class_map = {0: "SELL", 1: "HOLD", 2: "BUY"}
        action = class_map.get(pred_class, "HOLD")

        return {
            "action": action,
            "confidence": confidence,
            "probabilities": {
                "SELL": float(probs[0]),
                "HOLD": float(probs[1]),
                "BUY": float(probs[2])
            },
            "model_id": self.model_id,
            "model_hash": self.model_hash
        }
