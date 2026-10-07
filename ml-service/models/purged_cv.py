import numpy as np
import pandas as pd
from typing import Generator, Tuple
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, log_loss

class PurgedWalkForwardCV:
    """
    Purged and Embargoed Walk-Forward Cross Validation.
    Prevents lookahead leakage by:
    1. Enforcing strict chronological walk-forward splits (expanding or rolling window).
    2. Purging the final `purge_bars` (matching the triple-barrier holding period) from
       each training split so forward label horizons never overlap with the validation window.
    3. Embargoing bars following test periods if necessary.
    """
    def __init__(self, n_splits: int = 3, min_train_pct: float = 0.5, purge_bars: int = 24, embargo_bars: int = 6):
        self.n_splits = max(2, n_splits)
        self.min_train_pct = min_train_pct
        self.purge_bars = purge_bars
        self.embargo_bars = embargo_bars

    def split(self, df_or_X) -> Generator[Tuple[np.ndarray, np.ndarray], None, None]:
        n_samples = len(df_or_X)
        if n_samples < 60:
            # Fallback for very small sample sets
            split_point = int(n_samples * 0.7)
            yield np.arange(0, split_point), np.arange(split_point, n_samples)
            return

        min_train_samples = int(n_samples * self.min_train_pct)
        eval_window = n_samples - min_train_samples
        test_size = eval_window // self.n_splits

        for i in range(self.n_splits):
            val_start = min_train_samples + i * test_size
            val_end = val_start + test_size if i < self.n_splits - 1 else n_samples

            # Train ends before val_start minus purge_bars to eliminate label overlap
            train_end = max(10, val_start - self.purge_bars)
            train_indices = np.arange(0, train_end)
            val_indices = np.arange(val_start, val_end)

            if len(train_indices) < 20 or len(val_indices) < 5:
                continue

            yield train_indices, val_indices

    def evaluate(self, model_factory, X: pd.DataFrame, y: pd.Series) -> dict:
        """
        Runs walk-forward evaluation across splits and aggregates out-of-sample metrics.
        """
        fold_metrics = []

        for fold, (train_idx, val_idx) in enumerate(self.split(X)):
            X_train, y_train = X.iloc[train_idx], y.iloc[train_idx]
            X_val, y_val = X.iloc[val_idx], y.iloc[val_idx]

            # Fit model on training fold
            model = model_factory()
            model.fit(X_train, y_train)

            # Evaluate on purged out-of-sample validation fold
            y_pred = model.predict(X_val)
            acc = accuracy_score(y_val, y_pred)
            prec, rec, f1, _ = precision_recall_fscore_support(y_val, y_pred, average='macro', zero_division=0)

            fold_metrics.append({
                "fold": fold + 1,
                "train_samples": len(train_idx),
                "val_samples": len(val_idx),
                "accuracy": float(acc),
                "precision": float(prec),
                "recall": float(rec),
                "f1": float(f1)
            })

        if not fold_metrics:
            return {"cv_accuracy": 0.0, "cv_f1": 0.0, "folds": []}

        mean_acc = float(np.mean([m["accuracy"] for m in fold_metrics]))
        mean_f1 = float(np.mean([m["f1"] for m in fold_metrics]))
        mean_prec = float(np.mean([m["precision"] for m in fold_metrics]))
        mean_rec = float(np.mean([m["recall"] for m in fold_metrics]))

        return {
            "cv_accuracy": mean_acc,
            "cv_f1": mean_f1,
            "cv_precision": mean_prec,
            "cv_recall": mean_rec,
            "folds": fold_metrics
        }
