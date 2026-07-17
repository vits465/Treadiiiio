import unittest
import pandas as pd
import numpy as np
import sys
import os

# Append the root of ml-service to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from features.engineering import compute_features

class TestFeatureEngineering(unittest.TestCase):
    def setUp(self):
        # Create a series of 50 price candles representing a trend
        np.random.seed(42)
        dates = pd.date_range(start="2026-07-01", periods=50, freq="1min")
        close_prices = 1.0800 + np.cumsum(np.random.normal(0, 0.0005, 50))
        
        self.mock_data = pd.DataFrame({
            "time": dates.astype(str),
            "open": close_prices - 0.0002,
            "high": close_prices + 0.0004,
            "low": close_prices - 0.0003,
            "close": close_prices,
            "volume": np.random.randint(50, 200, size=50)
        })

    def test_compute_features_success(self):
        df_features = compute_features(self.mock_data)
        
        # Verify columns are added
        expected_cols = [
            'sma_9', 'sma_21', 'ema_12', 'ema_26', 'macd', 'macd_signal', 'macd_hist',
            'rsi_14', 'bb_middle', 'bb_upper', 'bb_lower', 'bb_width',
            'atr_14', 'roc_10', 'feat_ma_crossover', 'feat_rsi_reversion', 'feat_bollinger_reversion'
        ]
        for col in expected_cols:
            self.assertIn(col, df_features.columns)
            
        # The dataframe should not contain nulls because compute_features calls bfill/ffill
        self.assertFalse(df_features.isnull().any().any())
        
    def test_indicator_values_bounds(self):
        df_features = compute_features(self.mock_data)
        df_clean = df_features.dropna(subset=['rsi_14', 'bb_upper', 'bb_middle', 'bb_lower'])
        
        # RSI must be between 0 and 100
        self.assertTrue((df_clean['rsi_14'] >= 0).all())
        self.assertTrue((df_clean['rsi_14'] <= 100).all())
        
        # Bollinger Bands check: Upper > Middle > Lower
        self.assertTrue((df_clean['bb_upper'] >= df_clean['bb_middle']).all())
        self.assertTrue((df_clean['bb_middle'] >= df_clean['bb_lower']).all())

if __name__ == '__main__':
    unittest.main()
