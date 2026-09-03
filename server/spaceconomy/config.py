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
    jwt_refresh_days: int = 30
    account_activation_hours: int = 24
    public_api_url: str = "http://127.0.0.1:8000"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str = "no-reply@spaceconomy.local"
    smtp_use_tls: bool = True
    database_pool_size: int = 10
    database_max_overflow: int = 10
    redis_connect_timeout_seconds: float = 1.0
    redis_operation_timeout_seconds: float = 1.0
    redis_session_ttl_seconds: int = 300
    redis_idempotency_ttl_seconds: int = 86_400
    redis_snapshot_ttl_seconds: int = 30
    client_origin: str = "http://127.0.0.1:5173"
    simulation_tick_hz: int = 20
    snapshot_tick_hz: int = 10

    model_config = SettingsConfigDict(
        env_file=".env", env_prefix="SPACECONOMY_", env_ignore_empty=True
    )


settings = Settings()
