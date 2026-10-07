import numpy as np
import pandas as pd
from scipy.stats import ks_2samp

def calculate_psi(baseline: np.ndarray, current: np.ndarray, num_buckets: int = 10) -> float:
    """
    Calculates Population Stability Index (PSI) to measure feature distribution drift.
    PSI < 0.1: No significant distribution change.
    0.1 <= PSI < 0.2: Moderate shift (warning).
    PSI >= 0.2: Significant drift (retrain recommended).
    """
    baseline = np.asarray(baseline)
    current = np.asarray(current)
    
    # Filter out nans
    baseline = baseline[~np.isnan(baseline)]
    current = current[~np.isnan(current)]

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

def calculate_ks(baseline: np.ndarray, current: np.ndarray) -> tuple[float, float]:
    """
    Performs Kolmogorov-Smirnov 2-sample test to check whether two distributions differ.
    Returns (statistic, p_value).
    A small p-value (e.g., < 0.01) indicates the two distributions are statistically distinct.
    """
    baseline = np.asarray(baseline)
    current = np.asarray(current)
    baseline = baseline[~np.isnan(baseline)]
    current = current[~np.isnan(current)]

    if len(baseline) < 5 or len(current) < 5:
        return 0.0, 1.0

    stat, pval = ks_2samp(baseline, current)
    return float(np.round(stat, 4)), float(np.round(pval, 6))

def check_feature_drift(
    baseline_stats: dict,
    current_df: pd.DataFrame,
    psi_threshold: float = 0.2,
    ks_alpha: float = 0.01
) -> dict:
    """
    Compares current feature values against baseline stats from training.
    Returns a structured drift report for monitoring and auto-retraining alerts.
    """
    drifted_features = []
    feature_reports = {}
    max_psi = 0.0

    # Features to exclude from nominal level drift (like raw bar index)
    EXCLUDE_COLS = {'time', 'target', 'open', 'high', 'low', 'close', 'volume'}

    for feat, stats in baseline_stats.items():
        if feat in EXCLUDE_COLS or feat not in current_df.columns:
            continue

        curr_vals = current_df[feat].dropna().values
        if len(curr_vals) == 0:
            continue

        base_mean = stats.get('mean', 0.0)
        base_std = max(stats.get('std', 1.0), 1e-5)
        
        # Synthetic baseline distribution generated from mean & std if full baseline array not saved
        synth_baseline = np.random.normal(base_mean, base_std, size=min(1000, max(100, len(curr_vals))))
        psi = calculate_psi(synth_baseline, curr_vals)
        ks_stat, ks_pval = calculate_ks(synth_baseline, curr_vals)

        is_drifted = psi >= psi_threshold or ks_pval < ks_alpha
        if is_drifted:
            drifted_features.append(feat)

        if psi > max_psi:
            max_psi = psi

        feature_reports[feat] = {
            "psi": psi,
            "ks_statistic": ks_stat,
            "ks_pvalue": ks_pval,
            "is_drifted": is_drifted,
            "current_mean": float(np.mean(curr_vals)),
            "baseline_mean": base_mean
        }

    drift_detected = len(drifted_features) > 0
    recommendation = "NO_ACTION"
    if max_psi >= 0.25 or len(drifted_features) >= 3:
        recommendation = "RETRAIN_RECOMMENDED"
    elif drift_detected:
        recommendation = "WARNING"

    return {
        "drift_detected": drift_detected,
        "drifted_features": drifted_features,
        "max_psi": max_psi,
        "recommendation": recommendation,
        "features": feature_reports
    }
