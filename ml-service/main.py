import uvicorn
import os
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    host: str = "127.0.0.1"
    port: int = 8000
    db_path: str = "../forex_bot.db"
    
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()

if __name__ == "__main__":
    # Ensure correct DB path env var
    os.environ["DB_PATH"] = settings.db_path
    uvicorn.run("api.main:app", host=settings.host, port=settings.port, reload=True)
