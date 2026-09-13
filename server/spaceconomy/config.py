"""Application configuration loaded from the environment."""

from typing import Literal

from pydantic import SecretStr
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
    system_radius_meters: float = 18_000_000
    system_crossing_seconds: float = 1_800
    object_render_radius_meters: float = 40_000
    asteroid_spawn_interval_seconds: int = 300
    asteroid_spawn_batch_size: int = 6
    asteroid_field_maximum_active_asteroids: int = 36
    asteroid_system_maximum_active_fields: int = 10
    world_spawn_tick_seconds: int = 30
    refinery_tick_seconds: float = 1
    manufacturing_recipe_catalog_path: str = "catalog/manufacturing_recipes.json"
    sensor_default_range_meters: float = 1_500_000
    sensor_default_power_cost_megajoules: float = 35
    sensor_default_cooldown_seconds: float = 20
    jettison_expiry_seconds: int = 300
    jettison_pickup_range_meters: float = 250
    admin_auth_required: bool = False
    llm_provider: Literal["ollama", "azure_foundry"] = "ollama"
    ollama_url: str = "http://host.docker.internal:11434"
    ollama_model: str = "qwen2.5:1.5b"
    ollama_timeout_seconds: float = 120
    azure_foundry_endpoint: str | None = None
    azure_foundry_api_key: SecretStr | None = None
    azure_foundry_model: str = "gpt-4.1-mini"
    azure_foundry_timeout_seconds: float = 30

    model_config = SettingsConfigDict(
        env_file=".env", env_prefix="SPACECONOMY_", env_ignore_empty=True
    )


settings = Settings()
