"""FastAPI application entrypoint for HTTP and realtime endpoints."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Final

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .auth import router as auth_router
from .config import settings
from .db import close_database
from .redis import close_redis
from .realtime import router as realtime_router

API_VERSION: Final = "v1"


class HealthResponse(BaseModel):
    """Minimal health payload used by local orchestration."""

    status: str
    api_version: str
    simulation_tick_hz: int
    snapshot_tick_hz: int


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Release lazy infrastructure clients without making startup depend on a request."""
    yield
    await close_redis()
    await close_database()


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.client_origin],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["authorization", "content-type"],
)
app.include_router(auth_router)
app.include_router(realtime_router)


@app.get(f"/api/{API_VERSION}/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    """Report the API process status without exposing sensitive configuration."""
    return HealthResponse(
        status="ok",
        api_version=API_VERSION,
        simulation_tick_hz=settings.simulation_tick_hz,
        snapshot_tick_hz=settings.snapshot_tick_hz,
    )
