"""PostgreSQL engine and request-scoped session lifecycle."""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import settings


class Base(DeclarativeBase):
    """Base metadata registry for durable Spaceconomy models."""


engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=settings.database_pool_size,
    max_overflow=settings.database_max_overflow,
)
session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """Yield a session whose transaction is controlled by the application service."""
    async with session_factory() as session:
        yield session


async def close_database() -> None:
    """Release pooled database connections during application shutdown."""
    await engine.dispose()