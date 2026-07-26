import numpy as np
import pandas as pd

def calculate_psi(baseline: np.ndarray, current: np.ndarray, num_buckets: int = 10) -> float:
    """
    Calculates Population Stability Index (PSI) to measure feature distribution drift.
    PSI < 0.1: No significant distribution change.
    0.1 <= PSI < 0.2: Moderate shift (warning).
    PSI >= 0.2: Significant drift (retrain recommended).
    """
    baseline = np.asarray(baseline).dropna() if hasattr(baseline, 'dropna') else np.asarray(baseline)
    current = np.asarray(current).dropna() if hasattr(current, 'dropna') else np.asarray(current)

    if len(baseline) == 0 or len(current) == 0:
        return 0.0

    percentiles = np.linspace(0, 100, num_buckets + 1)
    buckets = np.percentile(baseline, percentiles)
    buckets[0] = -np.inf
    buckets[-1] = np.inf

    base_counts, _ = np.histogram(baseline, bins=buckets)
    curr_counts, _ = np.histogram(current, bins=buckets)

    base_pct = base_counts / len(baseline)
    curr_pct = curr_counts / len(current)

    # Avoid zero division with epsilon
    eps = 1e-4
    base_pct = np.where(base_pct == 0, eps, base_pct)
    curr_pct = np.where(curr_pct == 0, eps, curr_pct)

    psi = np.sum((curr_pct - base_pct) * np.log(curr_pct / base_pct))
    return float(np.round(psi, 4))
