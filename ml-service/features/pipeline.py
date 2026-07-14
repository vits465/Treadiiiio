import pandas as pd
from features.engineering import compute_features

def build_feature_matrix(df: pd.DataFrame) -> pd.DataFrame:
    """
    Builds the feature matrix from raw candle DataFrame.
    """
    return compute_features(df)
