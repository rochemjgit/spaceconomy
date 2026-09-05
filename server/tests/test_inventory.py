"""Isolated HTTP/DB tests; never use the configured application database URL.

Default: in-memory SQLite. Opt in to PostgreSQL using SPACECONOMY_TEST_DATABASE_URL;
each test creates and drops its own scratch schema (requires CREATE permission).
Only PostgreSQL exercises real row-lock contention.
"""

import asyncio
import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, event, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.schema import CreateSchema, DropSchema

from spaceconomy import auth, inventory, mining, world
from spaceconomy.db import Base, get_session
from spaceconomy.models import (
    Account,
    Asteroid,
    AsteroidField,
    HullDefinition,
    InventoryContainer,
    InventoryItem,
    JettisonedItem,
    MinedOreLot,
    ModuleDefinition,
    Pilot,
    PilotDiscovery,
    ShipState,
    SolarSystem,
)

ASSAY = '[{"definition_id":"iron","version":2,"percentage":100}]'
POSITION = {"position_x": 0, "position_y": 0, "position_z": 0}
PREFIX = "/api/v1/inventory"


@dataclass
class Game:
    client: AsyncClient
    sessions: async_sessionmaker
    pilot: UUID
    account: UUID
    asteroid: UUID
    module: UUID
    hull: UUID
    ship: UUID
    station: UUID

    async def post(self, route, payload=None):
        return await self.client.post(PREFIX + route, json=payload)

    async def dock(self, docked):
        async with self.sessions.begin() as session:
            state = await session.get(ShipState, self.pilot)
            state.docked_station_name = "KEPLER STATION" if docked else None

    async def item(self, container=None, quantity=1, volume=1.0, definition="material.test", **kw):
        async with self.sessions.begin() as session:
            row = InventoryItem(
                pilot_id=self.pilot,
                container_id=container or self.ship,
                definition_id=definition,
                definition_version=kw.pop("definition_version", 1),
                quantity=quantity,
                volume_per_unit=volume,
                durability=100,
                **kw,
            )
            session.add(row)
            await session.flush()
            return row.id

    async def ore(self, container=None, volume=1.0, assay=ASSAY, asteroid=None):
        async with self.sessions.begin() as session:
            lot = MinedOreLot(
                pilot_id=self.pilot,
                container_id=container or self.ship,
                asteroid_id=asteroid or self.asteroid,
                composition="ferrous",
                mineral_assay=assay,
                volume_cubic_meters=volume,
            )
            session.add(lot)
            await session.flush()
            return lot.id

    async def cargo(self):
        async with self.sessions() as session:
            return (await session.get(ShipState, self.pilot)).cargo_cubic_meters


@pytest.fixture
async def inventory_engine():
    """Create metadata only in memory or a uniquely named opt-in scratch schema."""
    database_url = os.environ.get("SPACECONOMY_TEST_DATABASE_URL")
    if database_url is None:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")

        @event.listens_for(engine.sync_engine, "connect")
        def foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")

        try:
            async with engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
            yield engine
        finally:
            await engine.dispose()
        return

    try:
        url = make_url(database_url)
    except Exception:
        pytest.fail("SPACECONOMY_TEST_DATABASE_URL must be a PostgreSQL URI", pytrace=False)
    if url.drivername not in {"postgresql", "postgresql+asyncpg"} or not url.database:
        pytest.fail("SPACECONOMY_TEST_DATABASE_URL must name a PostgreSQL database", pytrace=False)
    url = url.set(drivername="postgresql+asyncpg")
    schema = f"inventory_test_{uuid4().hex}"
    admin = create_async_engine(
        url,
        connect_args={"server_settings": {"search_path": "pg_catalog"}},
        hide_parameters=True,
    )
    engine = None
    created = False
    try:
        async with admin.begin() as connection:
            await connection.execute(CreateSchema(schema))
        created = True
        engine = create_async_engine(
            url,
            connect_args={
                "server_settings": {
                    "search_path": schema,
                    "lock_timeout": "10000",
                    "statement_timeout": "20000",
                }
            },
            hide_parameters=True,
        )
        async with engine.begin() as connection:
            assert await connection.scalar(text("SELECT current_schema()")) == schema
            await connection.run_sync(Base.metadata.create_all)
        yield engine
    finally:
        try:
            if engine is not None:
                await engine.dispose()
            if created:
                async with admin.begin() as connection:
                    await connection.execute(DropSchema(schema, cascade=True))
        finally:
            await admin.dispose()


@pytest.fixture
async def game(inventory_engine):
    engine = inventory_engine
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    account_id, pilot_id, hull_id, module_id = (uuid4() for _ in range(4))
    system_id, field_id, asteroid_id = (uuid4() for _ in range(3))
    async with sessions.begin() as session:
        session.add(
            Account(
                id=account_id,
                email="test@example.invalid",
                first_name="Test",
                last_name="Pilot",
                password_hash="unused",
            )
        )
        session.add(
            HullDefinition(
                id=hull_id,
                definition_id="hull.starter_miner",
                version=1,
                display_name="Test",
                universal_hardpoint_count=2,
                core_system_slot_count=2,
                base_statistics='{"cargo_volume":24}',
            )
        )
        session.add(
            ModuleDefinition(
                id=module_id,
                definition_id="module.test",
                version=1,
                display_name="Test module",
                family="mining",
                fit_location="universal",
                cpu_demand=1,
                powergrid_demand=1,
                durability_maximum=100,
                mass_kg=1,
                volume_cubic_meters=1,
            )
        )
        session.add(
            SolarSystem(id=system_id, system_key="kepler", display_name="Kepler", radius_meters=1e6)
        )
        await session.flush()
        session.add(Pilot(id=pilot_id, account_id=account_id, display_name="Test Pilot"))
        session.add(
            AsteroidField(
                id=field_id,
                system_id=system_id,
                field_key="test",
                display_name="Test",
                **POSITION,
                discovery_signature=1,
                spawn_profile="{}",
            )
        )
        await session.flush()
        session.add(ShipState(pilot_id=pilot_id, docked_station_name="KEPLER STATION", **POSITION))
        session.add(
            Asteroid(
                id=asteroid_id,
                field_id=field_id,
                spawn_seed=1,
                **POSITION,
                radius_meters=10,
                composition="ferrous",
                mineral_assay=ASSAY,
                initial_volume_cubic_meters=100,
                remaining_volume_cubic_meters=100,
            )
        )
        session.add(
            PilotDiscovery(
                pilot_id=pilot_id,
                discoverable_kind="asteroid_field",
                discoverable_id=field_id,
                scan_quality=1,
            )
        )
    app = FastAPI()
    app.include_router(inventory.router)
    app.include_router(mining.router)
    app.include_router(auth.router)

    async def isolated_session():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = isolated_session
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {auth._access_token(account_id, pilot_id)}"},
    ) as client:
        snapshot = (await client.get(PREFIX + "/docked")).json()
        game = Game(
            client,
            sessions,
            pilot_id,
            account_id,
            asteroid_id,
            module_id,
            hull_id,
            UUID(snapshot["ship"]["id"]),
            UUID(snapshot["station"]["id"]),
        )
        yield game


def transfer_body(game, item, quantity, reverse=False):
    return {
        "item_id": str(item),
        "quantity": quantity,
        "source_container_id": str(game.ship if reverse else game.station),
        "destination_container_id": str(game.station if reverse else game.ship),
    }


async def test_empty_station_does_not_respawn_modules(game):
    async with game.sessions.begin() as session:
        await session.execute(
            delete(InventoryItem).where(InventoryItem.container_id == game.station)
        )
    for _ in range(2):
        snapshot = (await game.client.get(PREFIX + "/docked")).json()
        assert snapshot["station"]["items"] == []
        assert snapshot["station"]["capacity_cubic_meters"] is None


async def test_pinned_hull_used_when_recreating_cargo(game):
    async with game.sessions.begin() as session:
        session.add(
            HullDefinition(
                definition_id="hull.starter_miner",
                version=2,
                display_name="New",
                universal_hardpoint_count=2,
                core_system_slot_count=2,
                base_statistics='{"cargo_volume":999}',
            )
        )
        await session.execute(delete(InventoryContainer).where(InventoryContainer.id == game.ship))
    response = await game.client.get(PREFIX + "/ship")
    assert response.json()["capacity_cubic_meters"] == 24


async def test_strict_item_transfer_includes_ore_and_rolls_back(game):
    await game.ore(volume=23)
    item = await game.item(container=game.station, quantity=4, volume=0.5)
    response = await game.post("/transfer", transfer_body(game, item, 3))
    assert response.status_code == 422
    async with game.sessions() as session:
        assert (await session.get(InventoryItem, item)).quantity == 4
    response = await game.post("/transfer", transfer_body(game, item, 2))
    assert response.status_code == 200
    assert response.json()["ship"]["used_volume_cubic_meters"] == 24
    assert await game.cargo() == 24


async def test_best_effort_skips_large_moves_partial_and_zero_volume(game):
    # Remove starter module so lexical item ordering and moved volume are explicit.
    async with game.sessions.begin() as session:
        await session.execute(
            delete(InventoryItem).where(InventoryItem.container_id == game.station)
        )
    await game.ore(volume=23)
    await game.item(game.station, volume=2, definition="a.oversize")
    await game.item(game.station, quantity=8, volume=0.2, definition="b.small")
    await game.item(game.station, quantity=7, volume=0, definition="c.zero")
    response = await game.post(
        "/transfer-all",
        {"source_container_id": str(game.station), "destination_container_id": str(game.ship)},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["moved_volume_cubic_meters"] == pytest.approx(1)
    assert body["remaining_stacks"] == 2
    assert {i["definition_id"]: i["quantity"] for i in body["ship"]["items"]} == {
        "b.small": 5,
        "c.zero": 7,
    }
    assert await game.cargo() == pytest.approx(24)


async def test_bulk_moves_partial_ore_and_station_is_unlimited(game):
    await game.item(quantity=23, volume=1)
    await game.ore(game.station, volume=4)
    async with game.sessions.begin() as session:
        await session.execute(
            delete(InventoryItem).where(InventoryItem.container_id == game.station)
        )
    response = await game.post(
        "/transfer-all",
        {"source_container_id": str(game.station), "destination_container_id": str(game.ship)},
    )
    body = response.json()
    assert body["moved_volume_cubic_meters"] == 1
    assert body["remaining_stacks"] == 1
    assert body["station"]["raw_ore_lots"][0]["volume_cubic_meters"] == 3
    response = await game.post(
        "/transfer-all",
        {"source_container_id": str(game.ship), "destination_container_id": str(game.station)},
    )
    assert response.json()["moved_volume_cubic_meters"] == 24
    assert response.json()["remaining_stacks"] == 0
    assert await game.cargo() == 0


async def test_transfer_decimal_roundoff_and_definition_identity(game):
    await game.ore(volume=23.7)
    item = await game.item(game.station, quantity=3, volume=0.1, definition_version=2)
    response = await game.post("/transfer", transfer_body(game, item, 3))
    assert response.status_code == 200
    row = response.json()["ship"]["items"][0]
    assert row["definition_version"] == 2
    assert row["module_definition_id"] is None


async def test_space_split_merge_hides_station_and_rejects_remote(game):
    ship_item = await game.item(quantity=4)
    station_item = await game.item(game.station, quantity=4)
    await game.dock(False)
    response = await game.post(
        "/split", {"item_id": str(station_item), "container_id": str(game.station), "quantity": 1}
    )
    assert response.status_code == 403
    response = await game.post("/merge-all", {"container_id": str(game.station)})
    assert response.status_code == 403
    response = await game.post(
        "/split", {"item_id": str(ship_item), "container_id": str(game.ship), "quantity": 1}
    )
    assert response.status_code == 200
    assert response.json()["station"] is None
    assert len(response.json()["ship"]["items"]) == 2
    # No body remains supported.
    response = await game.client.post(PREFIX + "/merge-all")
    assert response.status_code == 200
    assert response.json()["station"] is None
    assert response.json()["ship"]["items"][0]["quantity"] == 4


async def test_selected_merge_leaves_other_container_and_versions_alone(game):
    for container in (game.ship, game.station):
        await game.item(container, quantity=2)
        await game.item(container, quantity=3)
    await game.item(quantity=1, definition_version=2)
    response = await game.post("/merge-all", {"container_id": str(game.ship)})
    assert response.status_code == 200
    assert sorted(i["quantity"] for i in response.json()["ship"]["items"]) == [1, 5]
    assert len(response.json()["station"]["items"]) == 3


async def test_ore_transfer_split_merge_preserves_assay_and_source(game):
    lot = await game.ore(volume=4)
    response = await game.post(
        "/ore/transfer",
        {
            "lot_id": str(lot),
            "source_container_id": str(game.ship),
            "destination_container_id": str(game.station),
            "volume_cubic_meters": 1.25,
        },
    )
    assert response.status_code == 200
    body = response.json()
    stored = body["station"]["raw_ore_lots"][0]
    assert stored["volume_cubic_meters"] == 1.25
    assert stored["asteroid_id"] == str(game.asteroid)
    assert stored["mineral_assay"] == json.loads(ASSAY)
    assert await game.cargo() == 2.75
    response = await game.post(
        "/ore/split",
        {"lot_id": stored["id"], "container_id": str(game.station), "volume_cubic_meters": 0.25},
    )
    assert response.status_code == 200
    assert len(response.json()["station"]["raw_ore_lots"]) == 2
    await game.ore(game.station, assay="[]")
    response = await game.post("/merge-all", {"container_id": str(game.station)})
    assert len(response.json()["station"]["raw_ore_lots"]) == 2
    await game.dock(False)
    response = await game.post(
        "/ore/split",
        {"lot_id": stored["id"], "container_id": str(game.station), "volume_cubic_meters": 0.1},
    )
    assert response.status_code == 403
    response = await game.post(
        "/ore/split",
        {"lot_id": str(lot), "container_id": str(game.ship), "volume_cubic_meters": 0.25},
    )
    assert response.status_code == 200
    assert response.json()["station"] is None


@pytest.mark.parametrize("volume", [0, -1, 2.5, "NaN", "Infinity"])
async def test_invalid_ore_transfer_is_atomic(game, volume):
    lot = await game.ore(volume=2)
    response = await game.post(
        "/ore/transfer",
        {
            "lot_id": str(lot),
            "source_container_id": str(game.ship),
            "destination_container_id": str(game.station),
            "volume_cubic_meters": volume,
        },
    )
    assert response.status_code == 422
    async with game.sessions() as session:
        assert (await session.get(MinedOreLot, lot)).volume_cubic_meters == 2


async def test_public_ore_can_be_salvaged_by_other_pilot(game):
    lot = await game.ore(volume=2)
    await game.dock(False)
    response = await game.post(
        "/ore/jettison", {"lot_id": str(lot), "volume_cubic_meters": 0.75, **POSITION}
    )
    assert response.status_code == 200
    public_id = response.json()["id"]
    assert response.json()["station"] is None
    assert await game.cargo() == 1.25
    other = uuid4()
    async with game.sessions.begin() as session:
        session.add(Pilot(id=other, account_id=game.account, display_name="Salvager"))
        await session.flush()
        session.add(ShipState(pilot_id=other, docked_station_name=None, **POSITION))
    game.client.headers["Authorization"] = f"Bearer {auth._access_token(game.account, other)}"
    response = await game.post("/jettisoned/pickup", {"jettisoned_item_id": public_id, **POSITION})
    assert response.status_code == 200
    body = response.json()
    assert body["station"] is None
    assert body["raw_ore_lots"] == body["ship"]["raw_ore_lots"]
    assert body["raw_ore_lots"][0]["mineral_assay"] == json.loads(ASSAY)
    assert body["raw_ore_lots"][0]["asteroid_id"] == str(game.asteroid)
    assert body["used_volume_cubic_meters"] == 0.75
    assert (
        await game.post("/jettisoned/pickup", {"jettisoned_item_id": public_id, **POSITION})
    ).status_code == 404
    async with game.sessions() as session:
        assert (await session.get(ShipState, other)).cargo_cubic_meters == 0.75


async def test_module_pickup_never_stacks_and_snapshots_include_ore(game):
    module = await game.item(module_definition_id=game.module, definition="module.test")
    await game.item(module_definition_id=game.module, definition="module.test")
    await game.ore(volume=1.5)
    await game.dock(False)
    response = await game.post("/jettison", {"item_id": str(module), "quantity": 1, **POSITION})
    assert response.status_code == 200
    assert response.json()["ship"]["used_volume_cubic_meters"] == 2.5
    assert await game.cargo() == 2.5
    response = await game.post(
        "/jettisoned/pickup", {"jettisoned_item_id": response.json()["id"], **POSITION}
    )
    assert response.status_code == 200
    assert len(response.json()["items"]) == 2
    assert all(
        i["quantity"] == 1 and i["module_definition_id"] == str(game.module)
        for i in response.json()["items"]
    )
    assert response.json()["used_volume_cubic_meters"] == 3.5
    assert await game.cargo() == 3.5


async def test_pickup_capacity_expiry_and_range(game):
    await game.ore(volume=24)
    await game.dock(False)
    public_id = uuid4()
    async with game.sessions.begin() as session:
        session.add(
            JettisonedItem(
                id=public_id,
                definition_id="test",
                definition_version=1,
                quantity=1,
                durability=100,
                volume_per_unit=1,
                **POSITION,
                expires_at=datetime.now(UTC) + timedelta(minutes=5),
            )
        )
    body = {"jettisoned_item_id": str(public_id), **POSITION}
    assert (await game.post("/jettisoned/pickup", body)).status_code == 409
    async with game.sessions.begin() as session:
        row = await session.get(JettisonedItem, public_id)
        row.volume_per_unit = 0
        row.position_x = 900_000
    assert (await game.post("/jettisoned/pickup", body)).status_code == 409
    async with game.sessions.begin() as session:
        row = await session.get(JettisonedItem, public_id)
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    assert (await game.post("/jettisoned/pickup", body)).status_code == 404


async def test_mining_only_ship_and_exact_assay_source(game):
    await game.ore(game.station, volume=100)
    old = await game.ore(assay="[]")
    await game.dock(False)
    response = await game.client.post(
        "/api/v1/mining/extract", json={"asteroid_id": str(game.asteroid), **POSITION}
    )
    assert response.status_code == 200
    assert response.json()["cargo_cubic_meters"] == 1.5
    assert response.json()["mined_ore_lot_id"] != str(old)
    first = response.json()["mined_ore_lot_id"]
    response = await game.client.post(
        "/api/v1/mining/extract", json={"asteroid_id": str(game.asteroid), **POSITION}
    )
    assert response.json()["mined_ore_lot_id"] == first
    assert response.json()["mined_ore_lot_volume_cubic_meters"] == 1
    response = await game.client.get("/api/v1/mining/ore")
    assert len(response.json()) == 2
    assert sum(lot["volume_cubic_meters"] for lot in response.json()) == 2
    async with game.sessions() as session:
        assert (await session.get(MinedOreLot, old)).mineral_assay == "[]"


async def test_checkpoint_cannot_overwrite_cargo(game):
    await game.ore(volume=2)
    await game.ore(game.station, volume=80)
    await game.item(quantity=3, volume=0.5)
    response = await game.client.put(
        "/api/v1/auth/ship-state",
        json={
            **POSITION,
            "docked_station_name": None,
            "power_megajoules": 100,
            "shields": 100,
            "hull": 100,
            "fuel_liters": 80,
            "cargo_cubic_meters": 999,
        },
    )
    assert response.status_code == 204
    assert await game.cargo() == 3.5


@pytest.mark.parametrize("public", [False, True])
async def test_module_singleton_constraints(game, public):
    async with game.sessions() as session:
        row = dict(
            module_definition_id=game.module,
            quantity=2,
            definition_id="module.test",
            definition_version=1,
            durability=100,
            volume_per_unit=1,
        )
        if public:
            session.add(JettisonedItem(**row, **POSITION, expires_at=datetime.now(UTC)))
        else:
            session.add(InventoryItem(**row, pilot_id=game.pilot, container_id=game.ship))
        with pytest.raises(IntegrityError):
            await session.flush()
        await session.rollback()


async def test_station_unique_and_ore_container_required(game):
    async with game.sessions() as session:
        session.add(
            InventoryContainer(
                pilot_id=game.pilot,
                station_id=inventory.KEPLER_STATION_ID,
                container_type="station_storage",
                capacity_cubic_meters=0,
            )
        )
        with pytest.raises(IntegrityError):
            await session.flush()
        await session.rollback()
        session.add(
            MinedOreLot(
                pilot_id=game.pilot,
                asteroid_id=game.asteroid,
                composition="ferrous",
                volume_cubic_meters=1,
            )
        )
        with pytest.raises(IntegrityError):
            await session.flush()
        await session.rollback()


async def test_foreign_container_and_insufficient_item_quantities_rejected(game):
    item = await game.item(game.station, quantity=2)
    assert (await game.post("/transfer", transfer_body(game, item, 3))).status_code == 422
    payload = transfer_body(game, item, 1)
    payload["destination_container_id"] = str(uuid4())
    assert (await game.post("/transfer", payload)).status_code == 403
    await game.dock(False)
    assert (await game.post("/transfer", transfer_body(game, item, 1))).status_code == 409


async def test_pickup_lock_order_is_pilot_containers_then_public(game, monkeypatch):
    calls = []
    lock = inventory._lock_pilot_state
    ensure = inventory._ensure_containers

    async def traced_lock(*args):
        calls.append("pilot")
        return await lock(*args)

    async def traced_ensure(*args):
        result = await ensure(*args)
        calls.append("containers")
        return result

    monkeypatch.setattr(inventory, "_lock_pilot_state", traced_lock)
    monkeypatch.setattr(inventory, "_ensure_containers", traced_ensure)
    await game.dock(False)
    engine = game.sessions.kw["bind"].sync_engine

    def statement(_conn, _cursor, statement, _params, _context, _many):
        if "FROM jettisoned_items" in statement:
            calls.append("public")

    event.listen(engine, "before_cursor_execute", statement)
    try:
        await game.post("/jettisoned/pickup", {"jettisoned_item_id": str(uuid4()), **POSITION})
    finally:
        event.remove(engine, "before_cursor_execute", statement)
    assert calls.index("pilot") < calls.index("containers") < calls.index("public")


async def test_ore_capacity_is_strict_and_tolerance_cannot_accumulate(game):
    await game.ore(volume=23)
    stored = await game.ore(game.station, volume=2)
    payload = {
        "lot_id": str(stored),
        "source_container_id": str(game.station),
        "destination_container_id": str(game.ship),
        "volume_cubic_meters": 1.5,
    }
    assert (await game.post("/ore/transfer", payload)).status_code == 422
    payload["volume_cubic_meters"] = 1.0
    assert (await game.post("/ore/transfer", payload)).status_code == 200
    payload["volume_cubic_meters"] = inventory.VOLUME_EPSILON * 0.75
    assert (await game.post("/ore/transfer", payload)).status_code == 200
    assert (await game.post("/ore/transfer", payload)).status_code == 422
    assert await game.cargo() <= 24 + inventory.VOLUME_EPSILON


async def test_full_ore_transfer_and_jettison_conserve_volume(game):
    lot = await game.ore(volume=0.3)
    response = await game.post(
        "/ore/transfer",
        {
            "lot_id": str(lot),
            "source_container_id": str(game.ship),
            "destination_container_id": str(game.station),
            "volume_cubic_meters": 0.1 + 0.2,
        },
    )
    assert response.status_code == 200
    assert response.json()["ship"]["raw_ore_lots"] == []
    assert response.json()["station"]["raw_ore_lots"][0]["id"] == str(lot)
    response = await game.post(
        "/ore/transfer",
        {
            "lot_id": str(lot),
            "source_container_id": str(game.station),
            "destination_container_id": str(game.ship),
            "volume_cubic_meters": 0.3,
        },
    )
    assert response.status_code == 200
    await game.dock(False)
    response = await game.post(
        "/ore/jettison", {"lot_id": str(lot), "volume_cubic_meters": 0.3, **POSITION}
    )
    assert response.status_code == 200
    assert response.json()["ship"]["raw_ore_lots"] == []
    assert await game.cargo() == 0
    response = await game.post(
        "/jettisoned/pickup", {"jettisoned_item_id": response.json()["id"], **POSITION}
    )
    assert response.status_code == 200
    assert response.json()["used_volume_cubic_meters"] == 0.3


async def test_invalid_split_and_jettison_permissions(game):
    lot = await game.ore(volume=1)
    for volume in (0, 1, 2):
        response = await game.post(
            "/ore/split",
            {"lot_id": str(lot), "container_id": str(game.ship), "volume_cubic_meters": volume},
        )
        assert response.status_code == 422
    assert (
        await game.post("/ore/jettison", {"lot_id": str(lot), "volume_cubic_meters": 1, **POSITION})
    ).status_code == 409
    module = await game.item(module_definition_id=game.module)
    assert (
        await game.post(
            "/split", {"item_id": str(module), "container_id": str(game.ship), "quantity": 1}
        )
    ).status_code == 422
    await game.dock(False)
    assert (
        await game.post("/ore/jettison", {"lot_id": str(lot), "volume_cubic_meters": 2, **POSITION})
    ).status_code == 422
    assert (
        await game.post(
            "/ore/jettison",
            {"lot_id": str(lot), "volume_cubic_meters": 1, **POSITION, "position_x": 1e20},
        )
    ).status_code == 422


async def test_ore_merge_and_mining_do_not_mix_sources(game):
    second_id = uuid4()
    async with game.sessions.begin() as session:
        original = await session.get(Asteroid, game.asteroid)
        session.add(
            Asteroid(
                id=second_id,
                field_id=original.field_id,
                spawn_seed=2,
                **POSITION,
                radius_meters=10,
                composition="ferrous",
                mineral_assay=ASSAY,
                initial_volume_cubic_meters=100,
                remaining_volume_cubic_meters=100,
            )
        )
    await game.ore(volume=1)
    other = await game.ore(volume=2, asteroid=second_id)
    response = await game.post("/merge-all")
    assert len(response.json()["ship"]["raw_ore_lots"]) == 2
    await game.dock(False)
    response = await game.client.post(
        "/api/v1/mining/extract", json={"asteroid_id": str(game.asteroid), **POSITION}
    )
    assert response.status_code == 200
    assert response.json()["mined_ore_lot_volume_cubic_meters"] == 1.5
    async with game.sessions() as session:
        assert (await session.get(MinedOreLot, other)).volume_cubic_meters == 2


async def test_mining_capacity_counts_items_and_ore_not_station(game):
    await game.item(quantity=23)
    await game.ore(volume=0.75)
    await game.ore(game.station, volume=100)
    await game.dock(False)
    payload = {"asteroid_id": str(game.asteroid), **POSITION}
    response = await game.client.post("/api/v1/mining/extract", json=payload)
    assert response.status_code == 200
    assert response.json()["extracted_ore_cubic_meters"] == 0.25
    assert response.json()["cargo_cubic_meters"] == 24
    assert (await game.client.post("/api/v1/mining/extract", json=payload)).status_code == 409


async def test_replenish_preserves_public_ore_source_and_prunes_unreferenced(game, monkeypatch):
    lot = await game.ore(volume=2)
    await game.dock(False)
    response = await game.post(
        "/ore/jettison", {"lot_id": str(lot), "volume_cubic_meters": 2, **POSITION}
    )
    assert response.status_code == 200
    public_id = UUID(response.json()["id"])
    now = datetime.now(UTC)
    removable_id = uuid4()
    async with game.sessions.begin() as session:
        assert await session.get(MinedOreLot, lot) is None
        source = await session.get(Asteroid, game.asteroid)
        source.created_at = now - timedelta(days=1)
        field = await session.get(AsteroidField, source.field_id)
        field.spawn_profile = '{"maximum_active":1,"batch_size":1}'
        field.next_spawn_at = None
        session.add(
            Asteroid(
                id=removable_id,
                field_id=field.id,
                spawn_seed=2,
                **POSITION,
                radius_meters=10,
                composition="ferrous",
                mineral_assay=ASSAY,
                initial_volume_cubic_meters=100,
                remaining_volume_cubic_meters=100,
                created_at=now,
            )
        )
        # A NULL ore source must not poison a NOT IN subquery and disable pruning.
        session.add(
            JettisonedItem(
                definition_id="material.test",
                definition_version=1,
                quantity=1,
                durability=100,
                volume_per_unit=1,
                **POSITION,
                expires_at=now + timedelta(minutes=5),
            )
        )
    monkeypatch.setattr(world, "session_factory", game.sessions)
    assert await world.replenish_asteroid_fields(now) == 0
    async with game.sessions() as session:
        assert await session.get(Asteroid, game.asteroid) is not None
        assert await session.get(Asteroid, removable_id) is None
        public = await session.get(JettisonedItem, public_id)
        assert public.ore_asteroid_id == game.asteroid
        assert public.ore_mineral_assay == ASSAY
        field = await session.get(AsteroidField, field.id)
        assert field.next_spawn_at is not None
    response = await game.post(
        "/jettisoned/pickup", {"jettisoned_item_id": str(public_id), **POSITION}
    )
    assert response.status_code == 200
    recovered = response.json()["raw_ore_lots"]
    assert len(recovered) == 1
    assert recovered[0]["asteroid_id"] == str(game.asteroid)
    assert recovered[0]["mineral_assay"] == json.loads(ASSAY)
    assert recovered[0]["volume_cubic_meters"] == 2


@pytest.fixture
async def postgres_game(inventory_engine, game):
    if inventory_engine.dialect.name != "postgresql":
        pytest.skip("Requires SPACECONOMY_TEST_DATABASE_URL and PostgreSQL row locks")
    return game


@pytest.fixture
def concurrent_requests(monkeypatch):
    """Synchronize two independent HTTP transactions before their first pilot lock."""
    original = inventory._lock_pilot_state
    barrier = asyncio.Barrier(2)
    entered = set()

    async def synchronized_lock(session, pilot_id):
        if session not in entered:
            entered.add(session)
            await barrier.wait()
        return await original(session, pilot_id)

    async def run(*requests):
        with monkeypatch.context() as patch:
            patch.setattr(inventory, "_lock_pilot_state", synchronized_lock)
            async with asyncio.TaskGroup() as group:
                async with asyncio.timeout(30):
                    tasks = [group.create_task(request) for request in requests]
                    results = await asyncio.gather(*tasks)
            return results

    return run


async def test_postgres_concurrent_transfer_same_stack_no_duplicates(
    postgres_game, concurrent_requests
):
    game = postgres_game
    item = await game.item(game.station, quantity=4)
    body = transfer_body(game, item, 4)
    responses = await concurrent_requests(
        game.post("/transfer", body), game.post("/transfer", body)
    )
    assert sorted(response.status_code for response in responses) == [200, 404]
    async with game.sessions() as session:
        rows = list(
            await session.scalars(
                select(InventoryItem).where(InventoryItem.definition_id == "material.test")
            )
        )
        assert len(rows) == 1
        assert rows[0].id == item
        assert rows[0].container_id == game.ship
        assert rows[0].quantity == 4
    assert await game.cargo() == 4


async def test_postgres_concurrent_item_and_ore_transfers_do_not_overfill(
    postgres_game, concurrent_requests
):
    game = postgres_game
    await game.ore(volume=23)
    item = await game.item(game.station)
    lot = await game.ore(game.station)
    responses = await concurrent_requests(
        game.post("/transfer", transfer_body(game, item, 1)),
        game.post(
            "/ore/transfer",
            {
                "lot_id": str(lot),
                "source_container_id": str(game.station),
                "destination_container_id": str(game.ship),
                "volume_cubic_meters": 1,
            },
        ),
    )
    assert sorted(response.status_code for response in responses) == [200, 422]
    async with game.sessions() as session:
        assert await inventory._used_volume(session, game.ship) == 24
        # Includes the seeded station module: all 26 m³ remain accounted for.
        assert await inventory._used_volume(session, game.station) == 2
        assert (await session.get(InventoryItem, item)).quantity == 1
        assert (await session.get(MinedOreLot, lot)).volume_cubic_meters == 1
    assert await game.cargo() == 24


@pytest.mark.parametrize("ore", [False, True])
async def test_postgres_concurrent_pickup_two_pilots_no_duplicates(
    postgres_game, concurrent_requests, ore
):
    game = postgres_game
    await game.dock(False)
    if ore:
        lot = await game.ore(volume=2)
        response = await game.post(
            "/ore/jettison", {"lot_id": str(lot), "volume_cubic_meters": 2, **POSITION}
        )
    else:
        item = await game.item(quantity=2)
        response = await game.post("/jettison", {"item_id": str(item), "quantity": 2, **POSITION})
    assert response.status_code == 200
    public_id = UUID(response.json()["id"])
    other = uuid4()
    async with game.sessions.begin() as session:
        session.add(Pilot(id=other, account_id=game.account, display_name="Concurrent Salvager"))
        await session.flush()
        session.add(ShipState(pilot_id=other, docked_station_name=None, **POSITION))
    headers = {"Authorization": f"Bearer {auth._access_token(game.account, other)}"}
    body = {"jettisoned_item_id": str(public_id), **POSITION}
    responses = await concurrent_requests(
        game.post("/jettisoned/pickup", body),
        game.client.post(PREFIX + "/jettisoned/pickup", json=body, headers=headers),
    )
    assert sorted(response.status_code for response in responses) == [200, 404]
    winner = game.pilot if responses[0].status_code == 200 else other
    async with game.sessions() as session:
        assert await session.get(JettisonedItem, public_id) is None
        if ore:
            rows = list(await session.scalars(select(MinedOreLot)))
            assert len(rows) == 1
            assert rows[0].pilot_id == winner
            assert rows[0].asteroid_id == game.asteroid
            assert rows[0].mineral_assay == ASSAY
            assert rows[0].volume_cubic_meters == 2
        else:
            rows = list(
                await session.scalars(
                    select(InventoryItem).where(InventoryItem.definition_id == "material.test")
                )
            )
            assert len(rows) == 1
            assert rows[0].pilot_id == winner
            assert rows[0].quantity == 2
        states = list(await session.scalars(select(ShipState)))
        assert sorted(state.cargo_cubic_meters for state in states) == [0, 2]


async def test_postgres_concurrent_pickups_do_not_overfill(postgres_game, concurrent_requests):
    game = postgres_game
    await game.dock(False)
    await game.ore(volume=23)
    public_ids = [uuid4(), uuid4()]
    async with game.sessions.begin() as session:
        for public_id in public_ids:
            session.add(
                JettisonedItem(
                    id=public_id,
                    definition_id="material.test",
                    definition_version=1,
                    quantity=1,
                    durability=100,
                    volume_per_unit=1,
                    **POSITION,
                    expires_at=datetime.now(UTC) + timedelta(minutes=5),
                )
            )
    responses = await concurrent_requests(
        *(
            game.post("/jettisoned/pickup", {"jettisoned_item_id": str(public_id), **POSITION})
            for public_id in public_ids
        )
    )
    assert sorted(response.status_code for response in responses) == [200, 409]
    async with game.sessions() as session:
        assert await inventory._used_volume(session, game.ship) == 24
        remaining = list(await session.scalars(select(JettisonedItem)))
        assert len(remaining) == 1
        assert remaining[0].quantity == 1
        items = list(
            await session.scalars(
                select(InventoryItem).where(InventoryItem.container_id == game.ship)
            )
        )
        assert len(items) == 1
        assert items[0].quantity == 1
    assert await game.cargo() == 24
