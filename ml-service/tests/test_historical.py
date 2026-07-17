"""Tests for historical data fetching with synthetic data safety guard."""
import pytest
import os
import json
import tempfile

# Set up environment before importing
os.environ.setdefault("DB_PATH", "../forex_bot.db")

from data.historical import fetch_historical_candles, generate_synthetic_candles


class TestFetchHistoricalCandles:
    """Tests for the fetch_historical_candles function."""

    def test_raises_error_when_insufficient_data_and_synthetic_not_allowed(self, tmp_path):
        """Should raise ValueError when real data is insufficient and allow_synthetic=False."""
        # Create an empty JSON db
        json_path = tmp_path / "forex_bot_db.json"
        json_path.write_text(json.dumps({"candles": []}))
        
        os.environ["DB_PATH"] = str(tmp_path / "forex_bot.db")
        
        with pytest.raises(ValueError, match="Insufficient real market data"):
            fetch_historical_candles(
                instrument="EUR_USD",
                granularity="1h",
                lookback_days=365,
                allow_synthetic=False,
            )

    def test_returns_synthetic_data_when_allowed(self, tmp_path):
        """Should return synthetic candles with SYNTHETIC data_source when allowed."""
        json_path = tmp_path / "forex_bot_db.json"
        json_path.write_text(json.dumps({"candles": []}))
        
        os.environ["DB_PATH"] = str(tmp_path / "forex_bot.db")
        
        candles, data_source = fetch_historical_candles(
            instrument="EUR_USD",
            granularity="1h",
            lookback_days=365,
            allow_synthetic=True,
        )
        
        assert data_source == "SYNTHETIC"
        assert len(candles) == 500  # default synthetic count
        assert candles[0]["instrument"] == "EUR_USD"

    def test_returns_real_data_when_sufficient(self, tmp_path):
        """Should return real data with REAL data_source when enough candles exist."""
        # Generate 250 real candles in JSON
        real_candles = generate_synthetic_candles("EUR_USD", "1h", 250)
        
        json_path = tmp_path / "forex_bot_db.json"
        json_path.write_text(json.dumps({"candles": real_candles}))
        
        os.environ["DB_PATH"] = str(tmp_path / "forex_bot.db")
        
        candles, data_source = fetch_historical_candles(
            instrument="EUR_USD",
            granularity="1h",
            lookback_days=365,
            allow_synthetic=False,
        )
        
        assert data_source == "REAL"
        assert len(candles) == 250

    def test_default_allow_synthetic_is_false(self, tmp_path):
        """Should default to not allowing synthetic data."""
        json_path = tmp_path / "forex_bot_db.json"
        json_path.write_text(json.dumps({"candles": []}))
        
        os.environ["DB_PATH"] = str(tmp_path / "forex_bot.db")
        
        with pytest.raises(ValueError):
            fetch_historical_candles(
                instrument="EUR_USD",
                granularity="1h",
                lookback_days=365,
                # allow_synthetic defaults to False
            )


class TestGenerateSyntheticCandles:
    """Tests for the synthetic candle generator."""

    def test_generates_correct_count(self):
        candles = generate_synthetic_candles("EUR_USD", "1h", 100)
        assert len(candles) == 100

    def test_candles_have_required_fields(self):
        candles = generate_synthetic_candles("EUR_USD", "1h", 10)
        for c in candles:
            assert "time" in c
            assert "open" in c
            assert "high" in c
            assert "low" in c
            assert "close" in c
            assert "volume" in c
            assert "instrument" in c
            assert c["instrument"] == "EUR_USD"

    def test_jpy_uses_3_decimal_places(self):
        candles = generate_synthetic_candles("USD_JPY", "1h", 10)
        for c in candles:
            # JPY prices should have at most 3 decimal places
            assert len(str(c["open"]).split(".")[-1]) <= 3
