import os
import json
import random
from datetime import datetime, timedelta

def fetch_historical_candles(instrument: str, granularity: str, lookback_days: int) -> list[dict]:
    """
    Fetches historical candles from the shared JSON database, or generates
    realistic simulated candles if there is insufficient data.
    """
    db_path = os.getenv("DB_PATH", "../forex_bot.db")
    # Resolve the JSON file path relative to the db path
    json_path = os.path.join(os.path.dirname(db_path), "forex_bot_db.json")
    
    candles = []
    
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                all_candles = data.get("candles", [])
                
                # Filter by instrument and granularity
                candles = [
                    c for c in all_candles 
                    if c.get("instrument") == instrument and c.get("granularity") == granularity
                ]
                
                # Sort chronologically (oldest first)
                candles.sort(key=lambda x: x.get("time"))
        except Exception as e:
            print(f"Error reading JSON database in python historical fetch: {e}")
            
    # If we don't have enough candles (need at least 200), generate synthetic candles
    if len(candles) < 200:
        print(f"Insufficient candles in database ({len(candles)} found). Generating synthetic data for {instrument}...")
        candles = generate_synthetic_candles(instrument, granularity, count=500)
        
    return candles

def generate_synthetic_candles(instrument: str, granularity: str, count: int) -> list[dict]:
    """
    Generates synthetic random-walk price candles.
    """
    base_prices = {
        "EUR_USD": 1.0850,
        "GBP_USD": 1.2700,
        "USD_JPY": 155.50,
        "AUD_USD": 0.6650,
        "USD_CHF": 0.9050,
    }
    
    price = base_prices.get(instrument, 1.0000)
    candles = []
    now = datetime.utcnow()
    
    # Granularity parsing (Twelve Data intervals)
    minutes_map = {"1min": 1, "5min": 5, "15min": 15, "30min": 30, "1h": 60, "1day": 1440}
    minutes_step = minutes_map.get(granularity, 1)
    
    for i in range(count):
        delta = timedelta(minutes=minutes_step * (count - i))
        candle_time = (now - delta).isoformat() + "Z"
        
        vol = price * 0.001 # 0.1% volatility
        open_p = price
        close_p = price + (random.random() - 0.5) * vol
        high_p = max(open_p, close_p) + random.random() * vol * 0.5
        low_p = min(open_p, close_p) - random.random() * vol * 0.5
        volume = random.randint(50, 500)
        
        digits = 3 if "JPY" in instrument else 5
        
        candles.append({
            "time": candle_time,
            "instrument": instrument,
            "granularity": granularity,
            "open": round(open_p, digits),
            "high": round(high_p, digits),
            "low": round(low_p, digits),
            "close": round(close_p, digits),
            "volume": volume
        })
        
        price = close_p
        
    return candles
