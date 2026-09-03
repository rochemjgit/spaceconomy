"""Redis adapters for disposable sessions, snapshots, and realtime events."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from redis.asyncio import Redis
from redis.exceptions import RedisError

from .config import settings

client = Redis.from_url(
    settings.redis_url,
    decode_responses=False,
    socket_connect_timeout=settings.redis_connect_timeout_seconds,
    socket_timeout=settings.redis_operation_timeout_seconds,
)


def _key(*parts: str) -> str:
    return f"spaceconomy:{settings.environment}:{':'.join(parts)}"


def session_key(pilot_id: str) -> str:
    """Return the namespaced session key for a pilot."""
    return _key("session", pilot_id)


def snapshot_key(snapshot_type: str, entity_id: str) -> str:
    """Return the namespaced snapshot key for an entity."""
    return _key("snapshot", snapshot_type, entity_id)


def event_channel(channel_type: str, entity_id: str) -> str:
    """Return the namespaced pub/sub channel for an entity."""
    return _key("events", channel_type, entity_id)


async def get_session(pilot_id: str) -> dict[str, Any] | None:
    """Read a session payload, treating Redis failures as a cache miss."""
    try:
        value = await client.get(session_key(pilot_id))
    except RedisError:
        return None
    if value is None:
        return None
    decoded = json.loads(value)
    return decoded if isinstance(decoded, dict) else None


async def set_session(pilot_id: str, payload: Mapping[str, Any]) -> bool:
    """Store connected-pilot metadata with the configured bounded TTL."""
    try:
        await client.set(
            session_key(pilot_id),
            json.dumps(payload, separators=(",", ":")),
            ex=settings.redis_session_ttl_seconds,
        )
    except RedisError:
        return False
    return True


async def delete_session(pilot_id: str) -> bool:
    """Remove session metadata during logout or WebSocket disconnect."""
    try:
        await client.delete(session_key(pilot_id))
    except RedisError:
        return False
    return True


async def get_snapshot(snapshot_type: str, entity_id: str) -> dict[str, Any] | None:
    """Read a rebuildable snapshot, treating Redis failures as a cache miss."""
    try:
        value = await client.get(snapshot_key(snapshot_type, entity_id))
    except RedisError:
        return None
    if value is None:
        return None
    decoded = json.loads(value)
    return decoded if isinstance(decoded, dict) else None


async def set_snapshot(
    snapshot_type: str, entity_id: str, payload: Mapping[str, Any]
) -> bool:
    """Cache an entity snapshot after its authoritative transaction commits."""
    try:
        await client.set(
            snapshot_key(snapshot_type, entity_id),
            json.dumps(payload, separators=(",", ":")),
            ex=settings.redis_snapshot_ttl_seconds,
        )
    except RedisError:
        return False
    return True


async def invalidate_snapshot(snapshot_type: str, entity_id: str) -> bool:
    """Invalidate a derived snapshot after an authoritative mutation."""
    try:
        await client.delete(snapshot_key(snapshot_type, entity_id))
    except RedisError:
        return False
    return True


async def publish_event(
    channel_type: str, entity_id: str, event_type: str, payload: Mapping[str, Any]
) -> bool:
    """Publish a versioned event after an authoritative transaction commits."""
    event = {"version": 1, "type": event_type, "payload": dict(payload)}
    try:
        await client.publish(
            event_channel(channel_type, entity_id), json.dumps(event, separators=(",", ":"))
        )
    except RedisError:
        return False
    return True


async def close_redis() -> None:
    """Close the Redis client during application shutdown."""
    await client.aclose()