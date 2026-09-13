from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from spaceconomy import world
from spaceconomy.db import Base
from spaceconomy.inventory import KEPLER_STATION_ID, _ensure_containers
from spaceconomy.models import (
    Account,
    Asteroid,
    AsteroidField,
    HullDefinition,
    InventoryItem,
    MarketListing,
    ModuleDefinition,
    NpcProfile,
    NpcRuntime,
    Pilot,
    PilotDiscovery,
    ShipState,
    SolarSystem,
)
from spaceconomy.npc import (
    _advance_warp,
    _npc_listing_price,
    _select_mining_asteroid,
    ensure_miner_equipment,
    run_economic_miner,
)


@pytest.mark.asyncio
async def test_npc_tick_persists_active_npc_and_publishes_remote_pilot(monkeypatch) -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    account_id, pilot_id = uuid4(), uuid4()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions.begin() as session:
        hull = HullDefinition(
            definition_id="hull.starter_miner", version=1, display_name="Starter Miner",
            universal_hardpoint_count=3, core_system_slot_count=2,
            base_statistics='{"cargo_volume": 24}',
        )
        session.add(hull)
        await session.flush()
        session.add(ModuleDefinition(
            definition_id="module.mining_laser.m1", version=1, display_name="M1 Mining Laser",
            family="mining_laser", fit_location="universal_hardpoint", cpu_demand=1,
            powergrid_demand=1, durability_maximum=100, mass_kg=1, volume_cubic_meters=1,
        ))
        session.add(
            SolarSystem(system_key="kepler", display_name="Kepler", radius_meters=18_000_000)
        )
        session.add(
            Account(
                id=account_id,
                email="jorin@npc.invalid",
                first_name="NPC",
                last_name="Jorin",
                password_hash="unused",
            )
        )
        session.add(Pilot(id=pilot_id, account_id=account_id, display_name="Jorin Veilstone"))
        session.add(ShipState(pilot_id=pilot_id, docked_station_name="KEPLER STATION"))
        session.add(
            NpcProfile(
                pilot_id=pilot_id,
                archetype_key="economic_miner",
                backstory="Prospector.",
                motivations='["mine"]',
                capabilities='["mine"]',
            )
        )
        session.add(NpcRuntime(pilot_id=pilot_id))
    presences: list[dict[str, object]] = []
    events: list[dict[str, object]] = []

    async def set_presence(_system_id: str, _pilot: str, payload: dict[str, object]) -> bool:
        presences.append(payload)
        return True

    async def publish(
        _channel: str, _system_id: str, event_type: str, payload: dict[str, object]
    ) -> bool:
        events.append({"type": event_type, "payload": payload})
        return True

    monkeypatch.setattr(world, "session_factory", sessions)
    monkeypatch.setattr(world, "set_system_presence", set_presence)
    monkeypatch.setattr(world, "publish_event", publish)
    try:
        now = datetime(2026, 9, 12, tzinfo=UTC)
        assert await world.tick_npc_simulation(now) == 1
        assert presences[0]["display_name"] == "Jorin Veilstone"
        assert events[0] == {"type": "pilot_moved", "payload": presences[0]}
        assert events[1]["type"] == "pilot_mining"
        assert events[1]["payload"]["active"] is False
        assert events[2]["type"] == "pilot_activity"
        assert events[2]["payload"]["behavior_state"] == "undocking"
        assert events[2]["payload"]["docked"] is False
        async with sessions() as session:
            state = await session.get(ShipState, pilot_id)
            runtime = await session.get(NpcRuntime, pilot_id)
            assert state is not None and state.docked_station_name is None
            assert runtime is not None and runtime.behavior_state == "undocking"
            assert runtime.decision_source == "deterministic"
            assert runtime.decision_due_at is not None
            assert runtime.decision_due_at.replace(tzinfo=UTC) > now
            assert (
                runtime.target_x is not None
                and runtime.target_y is not None
                and runtime.target_z is not None
            )
            first_target = (runtime.target_x, runtime.target_y, runtime.target_z)
            pilot = (await session.scalars(select(Pilot).where(Pilot.id == pilot_id))).one()
            assert pilot.display_name == "Jorin Veilstone"
        assert await world.tick_npc_simulation(now + world.timedelta(seconds=1)) == 1
        async with sessions() as session:
            state = await session.get(ShipState, pilot_id)
            runtime = await session.get(NpcRuntime, pilot_id)
            assert state is not None
            assert runtime is not None and runtime.behavior_state == "exploring"
            assert (runtime.target_x, runtime.target_y, runtime.target_z) != first_target
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_docked_npc_is_removed_from_system_presence(monkeypatch) -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    account_id, pilot_id = uuid4(), uuid4()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions.begin() as session:
        session.add(Account(
            id=account_id, email="docked@npc.invalid", first_name="Docked", last_name="NPC",
            password_hash="unused",
        ))
        session.add(Pilot(id=pilot_id, account_id=account_id, display_name="Docked Miner"))
        session.add(ShipState(pilot_id=pilot_id, docked_station_name="KEPLER STATION"))
        session.add(NpcProfile(
            pilot_id=pilot_id, archetype_key="patrol", backstory="Docked.",
            motivations="[]", capabilities="[]",
        ))
        session.add(NpcRuntime(pilot_id=pilot_id))
    removed: list[str] = []
    events: list[str] = []

    async def remove_presence(_system_id: str, npc_id: str) -> bool:
        removed.append(npc_id)
        return True

    async def publish(
        _channel: str, _system_id: str, event_type: str, _payload: dict[str, object]
    ) -> bool:
        events.append(event_type)
        return True

    monkeypatch.setattr(world, "session_factory", sessions)
    monkeypatch.setattr(world, "remove_system_presence", remove_presence)
    monkeypatch.setattr(world, "publish_event", publish)
    try:
        assert await world.tick_npc_simulation(datetime(2026, 9, 12, tzinfo=UTC)) == 1
        assert removed == [str(pilot_id)]
        assert events == ["pilot_left"]
    finally:
        await engine.dispose()


def test_npc_warp_advances_through_player_like_entry_and_exit_phases() -> None:
    now = datetime(2026, 9, 12, tzinfo=UTC)
    runtime = NpcRuntime(
        pilot_id=uuid4(),
        warp_phase="aligning",
        warp_capacity=90,
        warp_phase_started_at=now,
    )
    origin = (0.0, 0.0, 0.0)
    destination = (200_000.0, 0.0, 0.0)

    aligned_motion = _advance_warp(
        runtime, origin, destination, now + world.timedelta(seconds=1), "travelling"
    )
    assert aligned_motion.position[0] == 100
    _advance_warp(
        runtime,
        aligned_motion.position,
        destination,
        now + world.timedelta(seconds=2),
        "travelling",
    )
    assert runtime.warp_phase == "accelerating"
    _advance_warp(runtime, origin, destination, now + world.timedelta(seconds=7), "travelling")
    assert runtime.warp_phase == "warping"
    _advance_warp(runtime, origin, destination, now + world.timedelta(seconds=8), "travelling")
    assert runtime.warp_phase == "cruising"

    motion = _advance_warp(
        runtime,
        origin,
        destination,
        now + world.timedelta(seconds=9),
        "travelling",
    )
    assert motion.position[0] == 10_000
    assert runtime.warp_capacity == 88


def test_npc_mining_target_selection_avoids_claimed_local_asteroids() -> None:
    field_id = uuid4()
    asteroid_one = Asteroid(
        id=uuid4(), field_id=field_id, spawn_seed=1, position_x=0, position_y=0, position_z=0,
        radius_meters=10, composition="Ore", mineral_assay="[]",
        initial_volume_cubic_meters=10, remaining_volume_cubic_meters=10,
    )
    asteroid_two = Asteroid(
        id=uuid4(), field_id=field_id, spawn_seed=2, position_x=100, position_y=0, position_z=0,
        radius_meters=10, composition="Ore", mineral_assay="[]",
        initial_volume_cubic_meters=10, remaining_volume_cubic_meters=10,
    )
    chosen = _select_mining_asteroid(
        (0, 0, 0), uuid4(), [asteroid_one, asteroid_two], set()
    )
    assert chosen is not None
    replacement = _select_mining_asteroid(
        (0, 0, 0), uuid4(), [asteroid_one, asteroid_two], {chosen.id}
    )
    assert replacement is not None and replacement.id != chosen.id


@pytest.mark.asyncio
async def test_npc_market_price_undercuts_or_stockpiles_against_competition() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    miner_account_id, miner_id = uuid4(), uuid4()
    competitor_account_id, competitor_id = uuid4(), uuid4()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions.begin() as session:
        session.add_all([
            Account(
                id=miner_account_id, email="market-miner@npc.invalid", first_name="Market",
                last_name="Miner", password_hash="unused",
            ),
            Account(
                id=competitor_account_id, email="market-rival@npc.invalid", first_name="Market",
                last_name="Rival", password_hash="unused",
            ),
            Pilot(id=miner_id, account_id=miner_account_id, display_name="Market Miner"),
            Pilot(id=competitor_id, account_id=competitor_account_id, display_name="Market Rival"),
        ])
        material = InventoryItem(
            pilot_id=miner_id, definition_id="material.pure.carbon", definition_version=1,
            quantity=3, durability=100, volume_per_unit=1,
        )
        competing_material = InventoryItem(
            pilot_id=competitor_id, definition_id="material.pure.carbon", definition_version=1,
            quantity=3, durability=100, volume_per_unit=1,
        )
        session.add_all([material, competing_material])
        await session.flush()
        competing_listing = MarketListing(
            station_id=KEPLER_STATION_ID, seller_pilot_id=competitor_id,
            inventory_item_id=competing_material.id, quantity=3, unit_price_credits=90,
            duration_days=7, listing_fee_credits=1,
            expires_at=datetime(2026, 9, 19, tzinfo=UTC), command_id="competitor-listing",
        )
        session.add(competing_listing)
        assert await _npc_listing_price(session, miner_id, material) == 89
        competing_listing.unit_price_credits = 75
        assert await _npc_listing_price(session, miner_id, material) is None
    await engine.dispose()


@pytest.mark.asyncio
async def test_npc_miner_locks_asteroid_before_consuming_power_to_extract() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    account_id, pilot_id = uuid4(), uuid4()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions.begin() as session:
        hull = HullDefinition(
            definition_id="hull.starter_miner", version=1, display_name="Starter Miner",
            universal_hardpoint_count=3, core_system_slot_count=2,
            base_statistics='{"cargo_volume": 24}',
        )
        session.add(hull)
        session.add(ModuleDefinition(
            definition_id="module.mining_laser.m1", version=1, display_name="M1 Mining Laser",
            family="mining_laser", fit_location="universal_hardpoint", cpu_demand=1,
            powergrid_demand=1, durability_maximum=100, mass_kg=1, volume_cubic_meters=1,
        ))
        system = SolarSystem(system_key="kepler", display_name="Kepler", radius_meters=1_000_000)
        session.add(system)
        await session.flush()
        field = AsteroidField(
            system_id=system.id, field_key="test", display_name="Test Belt",
            position_x=0, position_y=0, position_z=0, discovery_signature=1,
            spawn_profile="{}",
        )
        session.add(field)
        await session.flush()
        distant_field = AsteroidField(
            system_id=system.id, field_key="distant", display_name="Distant Belt",
            position_x=100_000, position_y=0, position_z=0, discovery_signature=1,
            spawn_profile="{}",
        )
        session.add(distant_field)
        await session.flush()
        asteroid = Asteroid(
            field_id=field.id, spawn_seed=1, position_x=0, position_y=0, position_z=0,
            radius_meters=10, composition="Ore", mineral_assay="[]",
            initial_volume_cubic_meters=10, remaining_volume_cubic_meters=10,
        )
        session.add(asteroid)
        session.add(Asteroid(
            field_id=field.id, spawn_seed=3, position_x=-1, position_y=0, position_z=0,
            radius_meters=10, composition="Ore", mineral_assay="[]",
            initial_volume_cubic_meters=10, remaining_volume_cubic_meters=0.06,
        ))
        session.add(Asteroid(
            field_id=distant_field.id, spawn_seed=2,
            position_x=100_000, position_y=0, position_z=0,
            radius_meters=10, composition="Ore", mineral_assay="[]",
            initial_volume_cubic_meters=10, remaining_volume_cubic_meters=10,
        ))
        session.add(Account(
            id=account_id, email="miner@npc.invalid", first_name="NPC", last_name="Miner",
            password_hash="unused",
        ))
        session.add(Pilot(id=pilot_id, account_id=account_id, display_name="Targeting Miner"))
        session.add(PilotDiscovery(
            pilot_id=pilot_id,
            discoverable_kind="asteroid_field",
            discoverable_id=distant_field.id,
            scan_quality=1,
        ))
        session.add(ShipState(
            pilot_id=pilot_id, position_x=0, position_y=0, position_z=0,
            docked_station_name=None, power_megajoules=100,
        ))
        session.add(NpcRuntime(pilot_id=pilot_id))

    now = datetime(2026, 9, 12, tzinfo=UTC)
    async with sessions.begin() as session:
        await ensure_miner_equipment(session, pilot_id)
        runtime = await session.get(NpcRuntime, pilot_id)
        state = await session.get(ShipState, pilot_id)
        assert runtime is not None and state is not None
        motion = await run_economic_miner(session, pilot_id, runtime, state, now)
        assert motion.behavior_state == "locking_asteroid"
        assert runtime.mining_target_asteroid_id == asteroid.id
        assert state.power_megajoules == 65
        assert state.sensor_last_scan_at == now
        discovery = await session.scalar(
            select(PilotDiscovery).where(
                PilotDiscovery.pilot_id == pilot_id,
                PilotDiscovery.discoverable_id == field.id,
            )
        )
        assert discovery is not None
        session.add(NpcRuntime(pilot_id=uuid4(), mining_target_asteroid_id=asteroid.id))
    async with sessions.begin() as session:
        runtime = await session.get(NpcRuntime, pilot_id)
        state = await session.get(ShipState, pilot_id)
        assert runtime is not None and state is not None
        motion = await run_economic_miner(
            session, pilot_id, runtime, state, now + world.timedelta(seconds=2)
        )
        assert motion.behavior_state == "target_locked"
        assert runtime.mining_target_asteroid_id == asteroid.id
        assert state.power_megajoules == 73
    async with sessions.begin() as session:
        runtime = await session.get(NpcRuntime, pilot_id)
        state = await session.get(ShipState, pilot_id)
        assert runtime is not None and state is not None
        motion = await run_economic_miner(
            session, pilot_id, runtime, state, now + world.timedelta(seconds=3)
        )
        assert motion.behavior_state == "mining"
        assert state.power_megajoules == 69
        assert (await session.scalar(select(Asteroid.remaining_volume_cubic_meters))) == 9
        assert runtime.mining_next_cycle_at is not None
    async with sessions.begin() as session:
        runtime = await session.get(NpcRuntime, pilot_id)
        state = await session.get(ShipState, pilot_id)
        assert runtime is not None and state is not None
        motion = await run_economic_miner(
            session, pilot_id, runtime, state, now + world.timedelta(seconds=4)
        )
        assert motion.behavior_state == "mining_cycle_wait"
        assert state.power_megajoules == 65
        assert (await session.scalar(select(Asteroid.remaining_volume_cubic_meters))) == 9
    await engine.dispose()


@pytest.mark.asyncio
async def test_npc_miner_undocks_after_listing_its_only_pure_material() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    account_id, pilot_id = uuid4(), uuid4()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions.begin() as session:
        hull = HullDefinition(
            definition_id="hull.starter_miner", version=1, display_name="Starter Miner",
            universal_hardpoint_count=3, core_system_slot_count=2,
            base_statistics='{"cargo_volume": 24}',
        )
        session.add(hull)
        await session.flush()
        session.add(Account(
            id=account_id, email="seller@npc.invalid", first_name="Seller", last_name="NPC",
            password_hash="unused",
        ))
        session.add(Pilot(id=pilot_id, account_id=account_id, display_name="Selling Miner"))
        session.add(ShipState(pilot_id=pilot_id, docked_station_name="KEPLER STATION"))
        session.add(NpcRuntime(pilot_id=pilot_id))
        _, station = await _ensure_containers(session, pilot_id)
        material = InventoryItem(
            pilot_id=pilot_id, container_id=station.id, definition_id="material.pure.carbon",
            definition_version=1, quantity=3, durability=100, volume_per_unit=1,
        )
        session.add(material)
        await session.flush()
        session.add(MarketListing(
            station_id=KEPLER_STATION_ID, seller_pilot_id=pilot_id,
            inventory_item_id=material.id, quantity=3, unit_price_credits=100,
            duration_days=7, listing_fee_credits=1,
            expires_at=datetime(2026, 9, 19, tzinfo=UTC), command_id="listed-material",
        ))
    async with sessions.begin() as session:
        runtime = await session.get(NpcRuntime, pilot_id)
        state = await session.get(ShipState, pilot_id)
        assert runtime is not None and state is not None
        motion = await run_economic_miner(
            session, pilot_id, runtime, state, datetime(2026, 9, 12, tzinfo=UTC)
        )
        assert motion.behavior_state == "undocking"
        assert state.docked_station_name is None
    await engine.dispose()