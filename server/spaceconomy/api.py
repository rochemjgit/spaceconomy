"""FastAPI application entrypoint for HTTP and realtime endpoints."""

from typing import Final

from fastapi import FastAPI
from pydantic import BaseModel

from .config import settings

API_VERSION: Final = "v1"


class HealthResponse(BaseModel):
    """Minimal health payload used by local orchestration."""

    status: str
    api_version: str
    simulation_tick_hz: int
    snapshot_tick_hz: int


app = FastAPI(title=settings.app_name, version="0.1.0")


@app.get(f"/api/{API_VERSION}/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    """Report the API process status without exposing sensitive configuration."""
    return HealthResponse(
        status="ok",
        api_version=API_VERSION,
        simulation_tick_hz=settings.simulation_tick_hz,
        snapshot_tick_hz=settings.snapshot_tick_hz,
    )
