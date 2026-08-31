"""Application configuration loaded from the environment."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration with safe local-development defaults."""

    app_name: str = "Spaceconomy API"
    environment: str = "development"
    database_url: str = "postgresql+asyncpg://spaceconomy:spaceconomy@postgres:5432/spaceconomy"
    redis_url: str = "redis://redis:6379/0"
    jwt_secret: str = "change-this-local-development-secret"
    jwt_access_minutes: int = 15
    simulation_tick_hz: int = 20
    snapshot_tick_hz: int = 10

    model_config = SettingsConfigDict(env_file=".env", env_prefix="SPACECONOMY_")


settings = Settings()
