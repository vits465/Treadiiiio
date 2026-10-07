import pytest
import numpy as np
import pandas as pd
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from features.engineering import compute_triple_barrier_labels

def test_triple_barrier_strong_uptrend():
    # Construct strong upward price path
    n = 60
    prices = 100.0 + np.arange(n) * 2.0  # continuous strong up
    df = pd.DataFrame({
        'open': prices,
        'high': prices + 0.5,
        'low': prices - 0.2,
        'close': prices + 0.3,
        'atr_14': np.full(n, 1.0)
    })

    labels = compute_triple_barrier_labels(df, sl_mult=1.5, tp_mult=3.0, holding_period=10)
    
    # In strong continuous uptrend, early rows should hit upper TP barrier -> 2 (BUY)
    valid_labels = labels.dropna()
    assert (valid_labels.iloc[:20] == 2.0).all()

def test_triple_barrier_strong_downtrend():
    # Construct strong downward price path
    n = 60
    prices = 200.0 - np.arange(n) * 2.0  # continuous strong down
    df = pd.DataFrame({
        'open': prices,
        'high': prices + 0.2,
        'low': prices - 0.5,
        'close': prices - 0.3,
        'atr_14': np.full(n, 1.0)
    })

    labels = compute_triple_barrier_labels(df, sl_mult=1.5, tp_mult=3.0, holding_period=10)
    
    # In strong continuous downtrend, early rows should hit lower TP barrier -> 0 (SELL)
    valid_labels = labels.dropna()
    assert (valid_labels.iloc[:20] == 0.0).all()

def test_triple_barrier_trailing_nans():
    n = 50
    holding_period = 15
    df = pd.DataFrame({
        'open': np.full(n, 100.0),
        'high': np.full(n, 100.5),
        'low': np.full(n, 99.5),
        'close': np.full(n, 100.0),
        'atr_14': np.full(n, 1.0)
    })

    labels = compute_triple_barrier_labels(df, sl_mult=1.5, tp_mult=3.0, holding_period=holding_period)
    
    # The last holding_period rows must be NaN to prevent lookahead leakage
    assert labels.iloc[-holding_period:].isna().all()
