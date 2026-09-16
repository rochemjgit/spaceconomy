import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from spaceconomy import admin
from spaceconomy.config import settings


async def test_station_service_availability_updates_persist() -> None:
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from spaceconomy.models import StationService
    from spaceconomy.seed import KEPLER_STATION_UUID

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(StationService.__table__.create)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions.begin() as session:
            session.add(
                StationService(
                    station_id=KEPLER_STATION_UUID,
                    service_key="market",
                    display_name="Market",
                    available=True,
                )
            )
        async with sessions() as session:
            snapshot = await admin.get_kepler_station_services(session, None)
            assert [(service.display_name, service.available) for service in snapshot.services] == [("Market", True)]
            service_id = snapshot.services[0].id
        async with sessions() as session:
            updated = await admin.update_kepler_station_service(
                service_id, admin.AdminStationServiceUpdate(available=False), session, None
            )
            assert not updated.available
        async with sessions() as session:
            snapshot = await admin.get_kepler_station_services(session, None)
            assert not snapshot.services[0].available
    finally:
        await engine.dispose()


async def test_deleting_an_npc_enables_transaction_scoped_ledger_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pilot_id = uuid4()
    statements: list[str] = []

    class Transaction:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_: object) -> None:
            return None

    class Session:
        def begin(self) -> Transaction:
            return Transaction()

        async def execute(self, statement: object) -> None:
            statements.append(str(statement))

        async def scalar(self, _: object) -> int:
            return 0

    async def npc_row(_: object, __: object) -> tuple[object, object, object]:
        return SimpleNamespace(account_id=uuid4()), object(), object()

    monkeypatch.setattr(admin, "_npc_row", npc_row)

    await admin.delete_npc(pilot_id, Session(), None)

    setting_index = next(index for index, statement in enumerate(statements) if "set_config" in statement)
    ledger_index = next(index for index, statement in enumerate(statements) if "DELETE FROM wallet_transactions" in statement)
    assert setting_index < ledger_index


@pytest.mark.parametrize("payload", [
    {"definition_id": "changed"}, {"version": 2}, {"display_name": "  "},
    {"industrial_role": None}, {"active": None}, {"display_color": "red"},
    {"visual_family": "unknown"},
])
def test_mineral_updates_reject_invalid_metadata(payload) -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        admin.AdminMineralDefinitionUpdate.model_validate(payload)


async def test_mineral_admin_updates_persist_and_keep_identity() -> None:
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from spaceconomy.minerals import load_mineral_catalog
    from spaceconomy.models import MineralDefinition
    from spaceconomy.seed import _upsert_mineral

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(MineralDefinition.__table__.create)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions.begin() as session:
            for mineral in load_mineral_catalog().minerals:
                await _upsert_mineral(session, mineral)
        async with sessions() as session:
            definitions = await admin.list_mineral_definitions(session, None)
            assert len(definitions) == 13
            assert all(definition.in_spawn_catalog for definition in definitions)
        original = definitions[0]
        async with sessions() as session:
            updated = await admin.update_mineral_definition(original.id,
                admin.AdminMineralDefinitionUpdate(display_name=" Revised name ", industrial_role="Revised role", display_color="#123456", visual_family="icy", active=False), session, None)
            assert updated.definition_id == original.definition_id
            assert updated.version == original.version
        async with sessions() as session:
            persisted = await session.get(MineralDefinition, original.id)
            assert persisted.display_name == "Revised name"
            assert persisted.industrial_role == "Revised role"
            assert persisted.display_color == "#123456"
            assert persisted.visual_family == "icy"
            assert not persisted.active
        async with sessions() as session:
            with pytest.raises(HTTPException) as missing:
                await admin.update_mineral_definition(uuid4(), admin.AdminMineralDefinitionUpdate(active=True), session, None)
            assert missing.value.status_code == 404
    finally:
        await engine.dispose()


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