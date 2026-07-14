from datetime import datetime
from typing import Literal
import os
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# Imports from other modules
from features.pipeline import build_feature_matrix
from models.trainer import train_model, load_latest_model
from data.historical import fetch_historical_candles
from api.mt5_routes import router as mt5_router

app = FastAPI(title="Forex Bot ML Service", version="0.1.0")

app.include_router(mt5_router)

# Set the DB path from environment variables or use default
# This allows python processes to share sqlite/json configurations
os.environ.setdefault("DB_PATH", "../forex_bot.db")

# ---------- Schemas ----------

class TrainRequest(BaseModel):
    instrument: str = Field(..., examples=["EUR_USD"])
    granularity: str = Field("1h", description="Twelve Data interval, e.g. 5min, 1h, 1day")
    lookback_days: int = Field(365, ge=30, le=2000)
    model_type: Literal["xgboost", "lightgbm"] = "xgboost"

class TrainResponse(BaseModel):
    model_id: str
    trained_at: datetime
    train_rows: int
    validation_accuracy: float
    validation_precision: float
    validation_recall: float
    notes: str

class PredictRequest(BaseModel):
    instrument: str
    candles: list[dict] = Field(
        ..., description="List of {time, open, high, low, close, volume}, most recent last"
    )

class PredictResponse(BaseModel):
    instrument: str
    action: Literal["BUY", "SELL", "HOLD"]
    confidence: float
    model_id: str
    predicted_at: datetime

# ---------- Routes ----------

@app.post("/train", response_model=TrainResponse)
def train(req: TrainRequest):
    """
    Pulls historical candles, builds features, trains a model with a
    time-based train/validation split (NEVER shuffled — this is time series),
    and persists the model artifact. Returns honest out-of-sample metrics.
    """
    candles = fetch_historical_candles(
        instrument=req.instrument,
        granularity=req.granularity,
        lookback_days=req.lookback_days,
    )
    if len(candles) < 200:
        raise HTTPException(
            status_code=400,
            detail="Not enough historical data to train reliably — widen lookback_days.",
        )

    df = pd.DataFrame(candles)
    features_df = build_feature_matrix(df)

    result = train_model(
        features_df,
        model_type=req.model_type,
        instrument=req.instrument,
    )

    return TrainResponse(
        model_id=result.model_id,
        trained_at=datetime.utcnow(),
        train_rows=len(features_df),
        validation_accuracy=result.metrics.accuracy,
        validation_precision=result.metrics.precision,
        validation_recall=result.metrics.recall,
        notes=result.notes,
    )

@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    """
    Loads the latest trained model for this instrument and returns a signal.
    The Node bot's ml-client calls this per new candle and treats the result
    like any other Signal from the rule-based strategy library.
    """
    model = load_latest_model(req.instrument)
    if model is None:
        raise HTTPException(
            status_code=404,
            detail=f"No trained model found for {req.instrument}. Call /train first.",
        )

    df = pd.DataFrame(req.candles)
    if len(df) < model.min_lookback:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least {model.min_lookback} candles for this model's features.",
        )

    features_row = build_feature_matrix(df).iloc[[-1]]
    action, confidence = model.predict(features_row)

    return PredictResponse(
        instrument=req.instrument,
        action=action,
        confidence=confidence,
        model_id=model.model_id,
        predicted_at=datetime.utcnow(),
    )

@app.get("/health")
def health():
    return {"status": "ok"}
