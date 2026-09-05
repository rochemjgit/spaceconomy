"""Transient Redis-backed pilot presence and movement relay."""

from __future__ import annotations

import asyncio
import json
import math
from typing import Any
from uuid import UUID

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from redis.exceptions import RedisError

from .config import settings
from .db import session_factory
from .models import Pilot
from .redis import client, event_channel, publish_event

router = APIRouter(tags=["realtime"])
SYSTEM_ID = "kepler"


def _presence_key() -> str:
    return f"spaceconomy:{settings.environment}:presence:{SYSTEM_ID}"


def _pilot_id(token: str | None) -> UUID | None:
    if token is None:
        return None
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        return UUID(claims["pilot_id"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


async def _forward_events(websocket: WebSocket, pilot_id: str) -> None:
    pubsub = client.pubsub()
    await pubsub.subscribe(event_channel("system", SYSTEM_ID))
    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                event = json.loads(message["data"])
                if event.get("payload", {}).get("pilot_id") != pilot_id:
                    await websocket.send_text(message["data"].decode())
    finally:
        await pubsub.unsubscribe()
        await pubsub.aclose()


@router.websocket("/api/v1/realtime")
async def realtime(websocket: WebSocket) -> None:
    """Relay nearby pilot movement for a single local system."""
    pilot_id = _pilot_id(websocket.query_params.get("token"))
    if pilot_id is None:
        await websocket.close(code=1008)
        return
    async with session_factory() as session:
        pilot_record = await session.get(Pilot, pilot_id)
    if pilot_record is None:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    pilot_key = str(pilot_id)
    pilot_name = pilot_record.display_name
    presence_key = _presence_key()
    try:
        raw_pilots = await client.hgetall(presence_key)
        pilots = [json.loads(value) for key, value in raw_pilots.items() if key.decode() != pilot_key]
        await websocket.send_json({"type": "snapshot", "payload": {"pilots": pilots}})
        pilot = {"pilot_id": pilot_key, "display_name": pilot_name, "ship_type": "starter-corvette", "x": 123_078, "y": 480, "z": -2_691, "yaw": 0, "pitch": 0, "roll": 0}
        await client.hset(presence_key, pilot_key, json.dumps(pilot, separators=(",", ":")))
        await publish_event("system", SYSTEM_ID, "pilot_joined", pilot)
        event_task = asyncio.create_task(_forward_events(websocket, pilot_key))
        try:
            while True:
                message = json.loads(await websocket.receive_text())
                message_type = message.get("type")
                payload = message.get("payload", {})
                if message_type == "targeting":
                    try:
                        target_pilot_id = str(UUID(payload["target_pilot_id"]))
                    except (KeyError, TypeError, ValueError):
                        continue
                    if target_pilot_id != pilot_key and isinstance(payload.get("active"), bool):
                        await publish_event("system", SYSTEM_ID, "pilot_targeting", {"pilot_id": pilot_key, "target_pilot_id": target_pilot_id, "active": payload["active"]})
                    continue
                if message_type == "mining":
                    source = [payload.get(axis) for axis in ("source_x", "source_y", "source_z")]
                    target = [payload.get(axis) for axis in ("target_x", "target_y", "target_z")]
                    if not isinstance(payload.get("active"), bool) or not all(isinstance(value, (int, float)) and math.isfinite(value) and abs(value) <= 1_000_000 for value in source + target):
                        continue
                    await publish_event("system", SYSTEM_ID, "pilot_mining", {"pilot_id": pilot_key, "active": payload["active"], "source_x": source[0], "source_y": source[1], "source_z": source[2], "target_x": target[0], "target_y": target[1], "target_z": target[2]})
                    continue
                if message_type != "movement":
                    continue
                coordinates = [payload.get(axis) for axis in ("x", "y", "z")]
                if not all(isinstance(value, (int, float)) and math.isfinite(value) and abs(value) <= 1_000_000 for value in coordinates):
                    continue
                attitude = [payload.get(axis) for axis in ("yaw", "pitch", "roll")]
                if not all(isinstance(value, (int, float)) and math.isfinite(value) and abs(value) <= math.tau for value in attitude):
                    continue
                pilot = {"pilot_id": pilot_key, "display_name": pilot_name, "ship_type": "starter-corvette", "x": coordinates[0], "y": coordinates[1], "z": coordinates[2], "yaw": attitude[0], "pitch": attitude[1], "roll": attitude[2]}
                await client.hset(presence_key, pilot_key, json.dumps(pilot, separators=(",", ":")))
                await publish_event("system", SYSTEM_ID, "pilot_moved", pilot)
        finally:
            event_task.cancel()
            await asyncio.gather(event_task, return_exceptions=True)
    except (WebSocketDisconnect, RedisError, json.JSONDecodeError):
        pass
    finally:
        try:
            await client.hdel(presence_key, pilot_key)
            await publish_event("system", SYSTEM_ID, "pilot_left", {"pilot_id": pilot_key})
        except RedisError:
            pass