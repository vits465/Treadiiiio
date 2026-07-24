import os
import joblib
import pandas as pd
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
from sklearn.metrics import accuracy_score, precision_recall_fscore_support
from sklearn.preprocessing import StandardScaler
from features.engineering import compute_features
import time

MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
ARTIFACTS_DIR = os.path.join(MODEL_DIR, "model_artifacts")
os.makedirs(ARTIFACTS_DIR, exist_ok=True)

FEATURES = [
    'sma_9', 'sma_21', 'ema_12', 'ema_26', 'macd', 'macd_signal', 'macd_hist',
    'rsi_14', 'bb_width', 'atr_14', 'roc_10'
]

class LSTMNetwork(nn.Module):
    def __init__(self, input_size, hidden_size=64, num_layers=2, num_classes=3):
        super(LSTMNetwork, self).__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.lstm = nn.LSTM(input_size, hidden_size, num_layers, batch_first=True, dropout=0.2)
        self.fc = nn.Linear(hidden_size, num_classes)
        self.softmax = nn.Softmax(dim=1)

    def forward(self, x):
        h0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size).to(x.device)
        c0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size).to(x.device)
        out, _ = self.lstm(x, (h0, c0))
        out = self.fc(out[:, -1, :])
        return self.softmax(out)

class LSTMModelManager:
    def __init__(self, instrument: str, model_id: str = None):
        self.instrument = instrument
        self.safe_name = instrument.lower().replace("/", "_").replace("\\", "_")
        self.model_id = model_id or f"lstm_{self.safe_name}_{int(time.time())}"
        self.model_path = os.path.join(ARTIFACTS_DIR, f"{self.model_id}.pth")
        self.scaler_path = os.path.join(ARTIFACTS_DIR, f"{self.model_id}_scaler.joblib")
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.model = None
        self.scaler = None
        self.feature_stats = {}
        self.sequence_length = 10

    def load_model(self, path=None):
        load_path = path or self.model_path
        if os.path.exists(load_path) and os.path.exists(self.scaler_path):
            self.model = LSTMNetwork(input_size=len(FEATURES)).to(self.device)
            self.model.load_state_dict(torch.load(load_path, map_location=self.device))
            self.model.eval()
            
            saved_data = joblib.load(self.scaler_path)
            self.scaler = saved_data.get('scaler')
            self.feature_stats = saved_data.get('feature_stats', {})
            return True
        return False

    def save_model(self):
        if self.model is not None and self.scaler is not None:
            torch.save(self.model.state_dict(), self.model_path)
            data_to_save = {
                'scaler': self.scaler,
                'feature_stats': self.feature_stats
            }
            joblib.dump(data_to_save, self.scaler_path)

    def prepare_labels(self, df: pd.DataFrame, forward_periods: int = 5, threshold_pct: float = 0.0005):
        df = df.copy()
        future_close = df['close'].shift(-forward_periods)
        forward_return = (future_close - df['close']) / df['close']
        
        conditions = [
            (forward_return > threshold_pct),
            (forward_return < -threshold_pct)
        ]
        choices = [2, 0] # 2: BUY, 0: SELL
        df['target'] = np.select(conditions, choices, default=1)
        df = df.dropna(subset=['target'])
        df['target'] = df['target'].astype(int)
        return df

    def create_sequences(self, data, targets, seq_length):
        xs, ys = [], []
        for i in range(len(data) - seq_length):
            x = data[i:(i + seq_length)]
            y = targets[i + seq_length]
            xs.append(x)
            ys.append(y)
        return np.array(xs), np.array(ys)

    def train(self, candles_data: list, forward_periods: int = 5, threshold_pct: float = 0.0005) -> dict:
        df_raw = pd.DataFrame(candles_data)
        if len(df_raw) < 200:
            raise ValueError("Insufficient candle data for LSTM training (need at least 200 candles).")

        df_features = compute_features(df_raw)
        df_labeled = self.prepare_labels(df_features, forward_periods, threshold_pct)
        df_clean = df_labeled.dropna(subset=FEATURES + ['target']).copy()
        
        if len(df_clean) < 100:
            raise ValueError("Insufficient data remaining after cleaning features.")

        # Train/Test split
        split_idx = int(len(df_clean) * 0.8)
        train_df = df_clean.iloc[:split_idx]
        test_df = df_clean.iloc[split_idx:]

        self.scaler = StandardScaler()
        X_train_scaled = self.scaler.fit_transform(train_df[FEATURES])
        X_test_scaled = self.scaler.transform(test_df[FEATURES])

        for feature in FEATURES:
            idx = FEATURES.index(feature)
            self.feature_stats[feature] = {
                'mean': float(self.scaler.mean_[idx]),
                'std': float(self.scaler.scale_[idx])
            }

        y_train = train_df['target'].values
        y_test = test_df['target'].values

        X_train_seq, y_train_seq = self.create_sequences(X_train_scaled, y_train, self.sequence_length)
        X_test_seq, y_test_seq = self.create_sequences(X_test_scaled, y_test, self.sequence_length)

        train_data = TensorDataset(torch.Tensor(X_train_seq), torch.LongTensor(y_train_seq))
        train_loader = DataLoader(train_data, batch_size=32, shuffle=True)

        self.model = LSTMNetwork(input_size=len(FEATURES)).to(self.device)
        criterion = nn.CrossEntropyLoss()
        optimizer = optim.Adam(self.model.parameters(), lr=0.001)

        self.model.train()
        epochs = 15
        for epoch in range(epochs):
            for batch_x, batch_y in train_loader:
                batch_x, batch_y = batch_x.to(self.device), batch_y.to(self.device)
                optimizer.zero_grad()
                outputs = self.model(batch_x)
                loss = criterion(outputs, batch_y)
                loss.backward()
                optimizer.step()

        self.save_model()
        self.model.eval()
        
        with torch.no_grad():
            X_test_t = torch.Tensor(X_test_seq).to(self.device)
            y_pred_probs = self.model(X_test_t).cpu().numpy()
            y_pred = np.argmax(y_pred_probs, axis=1)

        accuracy = accuracy_score(y_test_seq, y_pred)
        precision, recall, f1, _ = precision_recall_fscore_support(y_test_seq, y_pred, average='macro', zero_division=0)

        metrics = {
            "model_id": self.model_id,
            "dataset_size": len(df_clean),
            "train_size": len(train_df),
            "test_size": len(test_df),
            "accuracy": float(accuracy),
            "precision": float(precision),
            "recall": float(recall),
            "f1": float(f1),
            "top_features": {"lstm_all_features": 1.0}
        }
        
        return metrics

    def predict(self, recent_candles: list) -> dict:
        if self.model is None or self.scaler is None:
            loaded = self.load_model()
            if not loaded:
                return {"action": "HOLD", "confidence": 0.0, "error": "Model not trained yet."}

        df_raw = pd.DataFrame(recent_candles)
        if len(df_raw) < self.sequence_length + 30:
            return {"action": "HOLD", "confidence": 0.0, "error": f"Need at least {self.sequence_length + 30} candles."}

        df_features = compute_features(df_raw)
        df_clean = df_features.dropna(subset=FEATURES).tail(self.sequence_length)
        
        if len(df_clean) < self.sequence_length:
            return {"action": "HOLD", "confidence": 0.0, "error": "Insufficient valid features."}

        X_scaled = self.scaler.transform(df_clean[FEATURES])
        X_seq = torch.Tensor(X_scaled).unsqueeze(0).to(self.device)

        self.model.eval()
        with torch.no_grad():
            probs = self.model(X_seq).cpu().numpy()[0]
            
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
            }
        }
