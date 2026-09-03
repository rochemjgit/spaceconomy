import json

import pytest
from redis.exceptions import ConnectionError

from spaceconomy import redis


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, bytes] = {}
        self.expirations: dict[str, int] = {}
        self.published: list[tuple[str, str]] = []

    async def get(self, key: str) -> bytes | None:
        return self.values.get(key)

    async def set(self, key: str, value: str, ex: int) -> None:
        self.values[key] = value.encode()
        self.expirations[key] = ex

    async def delete(self, key: str) -> None:
        self.values.pop(key, None)

    async def publish(self, channel: str, message: str) -> None:
        self.published.append((channel, message))


@pytest.mark.asyncio
async def test_session_snapshot_and_event_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeRedis()
    monkeypatch.setattr(redis, "client", fake)

    assert await redis.set_session("pilot-1", {"active_ship_id": "ship-1"})
    assert await redis.get_session("pilot-1") == {"active_ship_id": "ship-1"}
    assert fake.expirations[redis.session_key("pilot-1")] == 300

    assert await redis.set_snapshot("fitting", "ship-1", {"cpu_used": 18.0})
    assert await redis.get_snapshot("fitting", "ship-1") == {"cpu_used": 18.0}
    assert await redis.invalidate_snapshot("fitting", "ship-1")
    assert await redis.get_snapshot("fitting", "ship-1") is None

    assert await redis.publish_event("ship", "ship-1", "fitting_changed", {"revision": 1})
    channel, message = fake.published[0]
    assert channel == redis.event_channel("ship", "ship-1")
    assert json.loads(message) == {
        "version": 1,
        "type": "fitting_changed",
        "payload": {"revision": 1},
    }


@pytest.mark.asyncio
async def test_redis_failure_is_a_cache_miss(monkeypatch: pytest.MonkeyPatch) -> None:
    class FailingRedis:
        async def get(self, key: str) -> None:
            raise ConnectionError()

    monkeypatch.setattr(redis, "client", FailingRedis())

    assert await redis.get_session("pilot-1") is None