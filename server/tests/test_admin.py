import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from spaceconomy import admin
from spaceconomy.config import settings


@pytest.mark.asyncio
async def test_foundry_test_prompt_uses_selected_model(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_request: dict[str, object] = {}

    def fake_foundry_request(payload: bytes) -> str:
        captured_request.update(json.loads(payload))
        return "A cautious miner holds position."

    monkeypatch.setattr(settings, "llm_provider", "azure_foundry")
    monkeypatch.setattr(settings, "azure_foundry_model", "gpt-4.1-mini")
    monkeypatch.setattr(admin, "_foundry_request", fake_foundry_request)

    response = await admin._test_prompt(admin.TestPromptRequest(prompt="Assess a mining route."))

    assert response.response == "A cautious miner holds position."
    assert captured_request == {
        "model": "gpt-4.1-mini",
        "messages": [{"role": "user", "content": "Assess a mining route."}],
        "max_tokens": 64,
    }


@pytest.mark.asyncio
async def test_foundry_stream_request_includes_runtime_parameters(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_request: dict[str, object] = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def __iter__(self):
            return iter([b"data: [DONE]\n\n"])

    def fake_foundry_stream(payload: bytes) -> FakeResponse:
        captured_request.update(json.loads(payload))
        return FakeResponse()

    monkeypatch.setattr(settings, "azure_foundry_model", "gpt-4.1-mini")
    monkeypatch.setattr(admin, "_foundry_stream", fake_foundry_stream)
    response = await admin.stream_foundry_prompt(
        admin.FoundryStreamPromptRequest(
            prompt="Assess the asteroid field.",
            system_instruction="You are a cautious prospector.",
            temperature=0.4,
            max_tokens=128,
        ),
        None,
    )

    assert response.media_type == "text/event-stream"
    chunks = [chunk async for chunk in response.body_iterator]
    assert chunks == [b"data: [DONE]\n\n"]
    assert captured_request == {
        "model": "gpt-4.1-mini",
        "messages": [
            {"role": "system", "content": "You are a cautious prospector."},
            {"role": "user", "content": "Assess the asteroid field."},
        ],
        "temperature": 0.4,
        "max_tokens": 128,
        "stream": True,
    }


async def test_admin_access_allows_local_development_and_blocks_unconfigured_auth() -> None:
    original = settings.admin_auth_required
    try:
        settings.admin_auth_required = False
        await admin.require_admin_access()
        settings.admin_auth_required = True
        with pytest.raises(HTTPException, match="not configured") as error:
            await admin.require_admin_access()
        assert error.value.status_code == 503
    finally:
        settings.admin_auth_required = original


@pytest.mark.asyncio
async def test_system_state_uses_live_redis_position_for_connected_player(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pilot_id = uuid4()

    class FakeTransaction:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_: object) -> None:
            return None

    class FakeScalars:
        def __init__(self, rows: list[object]) -> None:
            self.rows = rows

        def all(self) -> list[object]:
            return self.rows

    class FakeResult:
        def __init__(self, rows: list[tuple[object, ...]]) -> None:
            self.rows = rows

        def all(self) -> list[tuple[object, ...]]:
            return self.rows

        def scalars(self) -> FakeScalars:
            return FakeScalars(self.rows)

    class FakeSession:
        def begin(self) -> FakeTransaction:
            return FakeTransaction()

        async def scalar(self, _: object) -> float:
            return 18_000_000.0

        async def execute(self, _: object) -> FakeResult:
            calls = getattr(self, "calls", 0)
            self.calls = calls + 1
            if calls == 0:
                return FakeResult([])
            if calls == 1:
                return FakeResult([(
                SimpleNamespace(id=pilot_id, display_name="Live Pilot"),
                SimpleNamespace(
                    docked_station_name=None,
                    position_x=1.0,
                    position_y=2.0,
                    position_z=3.0,
                    cargo_cubic_meters=4.0,
                ),
            )])
            return FakeResult([SimpleNamespace(
                id=uuid4(),
                display_name="UNSURVEYED ASTEROID FIELD A1B2C3D4",
                position_x=12_345.0,
                position_y=678.0,
                position_z=-98_765.0,
            )])

    async def fake_assets(_: object, __: object) -> tuple[list[object], int, list[object], list[object]]:
        return [], 0, [], []

    async def fake_presence(_: str) -> dict[str, dict[str, float]]:
        return {str(pilot_id): {"x": 101.0, "y": 202.0, "z": 303.0}}

    monkeypatch.setattr(admin, "get_system_presence", fake_presence)
    monkeypatch.setattr(admin, "_pilot_assets", fake_assets)

    state = await admin.get_system_state(FakeSession(), None)

    assert state.players[0].position_x == 101.0
    assert state.players[0].position_y == 202.0
    assert state.players[0].position_z == 303.0
    assert state.system_radius_meters == 3_100_000_000.0
    assert state.asteroid_fields[0].display_name == "UNSURVEYED ASTEROID FIELD A1B2C3D4"
    assert state.asteroid_fields[0].position_x == 12_345.0
    assert state.asteroid_fields[0].position_z == -98_765.0


async def test_profile_generation_uses_a_structured_foundry_response(monkeypatch) -> None:
    captured_payload: dict[str, object] = {}

    def fake_foundry_request(payload: bytes) -> str:
        captured_payload.update(json.loads(payload))
        return json.dumps(
            {
                "display_name": "Nia Vesper",
                "creative_direction": "A cautious independent prospector.",
                "backstory": "A careful surveyor rebuilding a mining business.",
                "motivations": ["find rare deposits", "repay an old debt"],
            }
        )

    monkeypatch.setattr(admin, "_foundry_request", fake_foundry_request)

    profile = await admin._generate_profile(
        admin.ProfileGenerationRequest(
            display_name="Nia Vesper",
            archetype_key="economic_miner",
            prompt="cautious and independent",
        )
    )

    assert profile.display_name == "Nia Vesper"
    assert profile.creative_direction == "A cautious independent prospector."
    assert profile.motivations == ["find rare deposits", "repay an old debt"]
    assert captured_payload["model"] == settings.azure_foundry_model
    assert captured_payload["response_format"] == {"type": "json_object"}
    assert captured_payload["max_tokens"] == 400


async def test_prompt_test_returns_raw_local_llm_text(monkeypatch) -> None:
    captured_payload: dict[str, object] = {}

    def fake_ollama_request(payload: bytes) -> str:
        captured_payload.update(json.loads(payload))
        return "local LLM works"

    monkeypatch.setattr(admin, "_ollama_request", fake_ollama_request)

    result = await admin._test_prompt(
        admin.TestPromptRequest(prompt="Reply with exactly: local LLM works", num_predict=16)
    )

    assert result.response == "local LLM works"
    assert result.elapsed_seconds >= 0
    assert captured_payload["model"] == settings.ollama_model
    assert "format" not in captured_payload
    assert captured_payload["options"] == {"num_predict": 16}