import sqlite3
import os
import json
from contextlib import contextmanager

# The Node app initializes forex_bot.db in the parent directory.
# We respect the DB_PATH env var if provided.
DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "..", "forex_bot.db"))

@contextmanager
def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    with get_db_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ml_models (
                model_id TEXT PRIMARY KEY,
                instrument TEXT NOT NULL,
                trained_at DATETIME NOT NULL,
                metrics TEXT,
                shap_importance TEXT,
                is_active BOOLEAN DEFAULT 0
            )
        """)
        conn.commit()

# Automatically initialize schema on import
init_db()
