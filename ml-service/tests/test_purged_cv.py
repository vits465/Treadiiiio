import pytest
import numpy as np
import pandas as pd
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from models.purged_cv import PurgedWalkForwardCV
from sklearn.dummy import DummyClassifier

def test_purged_walk_forward_splits_no_overlap():
    n_samples = 120
    df = pd.DataFrame({'feature': np.random.randn(n_samples), 'target': np.random.randint(0, 3, n_samples)})
    
    purge_bars = 10
    cv = PurgedWalkForwardCV(n_splits=3, min_train_pct=0.5, purge_bars=purge_bars, embargo_bars=2)
    
    splits = list(cv.split(df))
    assert len(splits) >= 2

    for fold, (train_idx, val_idx) in enumerate(splits):
        # 1. Monotonicity: train comes strictly before validation
        assert np.max(train_idx) < np.min(val_idx)
        
        # 2. Purge gap check: the gap between train end and val start must be at least purge_bars
        gap = np.min(val_idx) - np.max(train_idx)
        assert gap >= purge_bars, f"Fold {fold}: Expected gap >= {purge_bars}, got {gap}"

def test_purged_cv_evaluation():
    n_samples = 150
    X = pd.DataFrame({'f1': np.random.randn(n_samples), 'f2': np.random.randn(n_samples)})
    y = pd.Series(np.random.randint(0, 3, n_samples))

    cv = PurgedWalkForwardCV(n_splits=3, min_train_pct=0.5, purge_bars=12, embargo_bars=4)
    results = cv.evaluate(lambda: DummyClassifier(strategy='most_frequent'), X, y)

    assert 'cv_accuracy' in results
    assert 'cv_f1' in results
    assert len(results['folds']) >= 2
    assert 0.0 <= results['cv_accuracy'] <= 1.0
