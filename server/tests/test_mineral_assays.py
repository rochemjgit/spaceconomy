import json
import math
import random

import pytest

from spaceconomy import world
from spaceconomy.minerals import MineralCatalog, generate_assay, load_mineral_catalog, resource_zone_classes, resource_zones, zone_for_position

from spaceconomy.world import (
    SYSTEM_POINTS_OF_INTEREST,
    SYSTEM_MAP_CELL_SIZE_METERS,
    KEPLER_STATION_POSITION,
    LOCAL_BELT_MAXIMUM_DISTANCE_METERS,
    LOCAL_BELT_MINIMUM_DISTANCE_METERS,
    asteroid_field_cell,
    eligible_asteroid_field_cells,
    poi_field_cells,
    random_local_belt_position,
    random_poi_field_position,
)


@pytest.mark.asyncio
async def test_disabled_spawning_does_not_touch_world_data(monkeypatch) -> None:
    from contextlib import asynccontextmanager
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    session = object()

    @asynccontextmanager
    async def begin():
        yield session

    monkeypatch.setattr(world.settings, "asteroid_spawning_enabled", False)
    monkeypatch.setattr(world, "session_factory", SimpleNamespace(begin=begin))
    jettison_cleanup = AsyncMock()
    market_cleanup = AsyncMock()
    monkeypatch.setattr(world, "expire_jettisoned_items", jettison_cleanup)
    monkeypatch.setattr(world, "expire_market_listings", market_cleanup)
    assert await world.replenish_asteroid_fields() == 0
    jettison_cleanup.assert_awaited_once()
    market_cleanup.assert_awaited_once()


def test_foundation_catalog_has_approved_resources_and_ten_classes() -> None:
    catalog = load_mineral_catalog()
    assert {mineral.definition_id for mineral in catalog.minerals} == {
        "iron", "nickel", "aluminum", "titanium", "silicon", "cobalt", "carbon",
        "sulfur", "water_ice", "calcium", "platinum", "gold", "silver",
    }
    for zone_class in range(1, 11):
        assert all(weight > 0 for weight in catalog.weights(zone_class).values())
    for mineral_id in ("platinum", "gold", "silver", "cobalt", "titanium"):
        shares = [
            catalog.weights(zone_class)[mineral_id] / sum(catalog.weights(zone_class).values())
            for zone_class in range(1, 11)
        ]
        assert shares == sorted(shares)


def test_class_assays_preserve_versions_percentages_and_distribution() -> None:
    catalog = load_mineral_catalog()
    versions = {mineral.definition_id: 2 for mineral in catalog.minerals}
    counts = {}
    for zone_class in range(1, 11):
        observed = set()
        complexities = []
        for seed in range(2000):
            entries = generate_assay(catalog, zone_class, seed, versions)
            assert entries == generate_assay(catalog, zone_class, seed, versions)
            assert 1 <= len(entries) <= 6
            assert len({entry["definition_id"] for entry in entries}) == len(entries)
            assert sum(round(entry["percentage"] * 1000) for entry in entries) == 100_000
            assert all(entry["definition_version"] == 2 for entry in entries)
            assert all(entry["percentage"] > 0 for entry in entries)
            observed.update(entry["definition_id"] for entry in entries)
            complexities.append(len(entries))
        assert observed == set(versions)
        counts[zone_class] = complexities
    assert sum(count <= 2 for count in counts[1]) > 1800
    assert sum(count >= 4 for count in counts[10]) > 1400


def test_invalid_catalog_and_unpinned_assays_are_rejected() -> None:
    catalog = load_mineral_catalog()
    data = catalog.model_dump()
    data["minerals"] += (data["minerals"][0],)
    with pytest.raises(ValueError, match="unique"):
        MineralCatalog.model_validate(data)
    with pytest.raises(ValueError, match="pinned"):
        generate_assay(catalog, 1, 42, {})
    with pytest.raises(ValueError, match="Zone class"):
        catalog.weights(11)


def test_zone_grid_covers_every_cell_and_has_consecutive_neighbors() -> None:
    zones = resource_zones(load_mineral_catalog(), 3_100_000_000, 3_000_000_000, 0)
    assert zones == resource_zones(load_mineral_catalog(), 1_000_000, 0, 0)
    assert zones != resource_zones(load_mineral_catalog(), 1_000_000, 0, 0, seed=42)
    assert all(zone.regions for zone in zones)
    regions = [(zone.zone_class, region) for zone in zones for region in zone.regions]
    for cell_x in range(-50, 50):
        for cell_z in range(-50, 50):
            position_x, position_z = (cell_x + .5) * 100_000_000, (cell_z + .5) * 100_000_000
            matches = [zone_class for zone_class, region in regions if region.min_x <= position_x < region.max_x and region.min_z <= position_z < region.max_z]
            assert len(matches) == 1
            assert zone_for_position(zones, position_x, position_z).zone_class == matches[0]
    classes = {
        (cell_x, cell_z): zone_for_position(
            zones,
            (cell_x + .5) * 100_000_000,
            (cell_z + .5) * 100_000_000,
        ).zone_class
        for cell_x in range(-50, 50)
        for cell_z in range(-50, 50)
    }
    assert set(classes.values()) == set(range(1, 11))
    assert all(
        abs(zone_class - classes[neighbor]) <= 1
        for (cell_x, cell_z), zone_class in classes.items()
        for neighbor in ((cell_x + 1, cell_z), (cell_x, cell_z + 1))
        if neighbor in classes
    )
    for corner_x in (-5_000_000_000, 5_000_000_000):
        for corner_z in (-5_000_000_000, 5_000_000_000):
            assert zone_for_position(zones, corner_x, corner_z)
    with pytest.raises(ValueError):
        zone_for_position(zones, 5_000_000_001, 0)


def test_primary_star_classes_step_down_before_resuming_blended_space() -> None:
    classes = resource_zone_classes()
    assert classes[(0, 0)] == 10
    assert classes[(3, 0)] == 9
    assert classes[(5, 0)] == 8
    assert classes[(7, 0)] == 7
    assert classes[(9, 0)] == 6
    alternate_seed_classes = resource_zone_classes(seed=42)
    assert any(
        classes[cell] != alternate_seed_classes[cell]
        for cell in classes
        if math.hypot(cell[0] + 0.5, cell[1] + 0.5) >= 10
    )


@pytest.mark.asyncio
async def test_mineral_seeding_preserves_admin_edits(monkeypatch) -> None:
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from spaceconomy.models import MineralDefinition
    from spaceconomy import seed

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(MineralDefinition.__table__.create)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        monkeypatch.setattr(seed, "session_factory", sessions)
        await seed.seed_mineral_catalog()
        async with sessions.begin() as session:
            rows = list(await session.scalars(select(MineralDefinition)))
            assert len(rows) == 13
            iron = next(row for row in rows if row.definition_id == "iron")
            iron.display_name = "Edited iron"
            iron.industrial_role = "Edited role"
            iron.display_color = "#123456"
            iron.active = False
        await seed.seed_mineral_catalog()
        async with sessions() as session:
            iron = await session.scalar(select(MineralDefinition).where(MineralDefinition.definition_id == "iron"))
            assert iron.display_name == "Edited iron"
            assert iron.industrial_role == "Edited role"
            assert iron.display_color == "#123456"
            assert not iron.active
    finally:
        await engine.dispose()


def test_asteroid_fields_spawn_in_cells_bordering_fixed_points_of_interest() -> None:
    poi_cells = {
        cell
        for _, position in SYSTEM_POINTS_OF_INTEREST
        for cell in poi_field_cells(position)
    }
    spawned_cells = {
        (
            int(position[0] // SYSTEM_MAP_CELL_SIZE_METERS),
            int(position[2] // SYSTEM_MAP_CELL_SIZE_METERS),
        )
        for seed in range(1_000)
        for position in [random_poi_field_position(random.Random(seed))]
    }

    assert spawned_cells <= poi_cells
    assert spawned_cells == poi_cells


def test_asteroid_field_cells_match_the_100_thousand_kilometre_map_grid() -> None:
    assert asteroid_field_cell(0, 0) == (0, 0)
    assert asteroid_field_cell(-1, -1) == (-1, -1)
    assert asteroid_field_cell(SYSTEM_MAP_CELL_SIZE_METERS, SYSTEM_MAP_CELL_SIZE_METERS) == (1, 1)


def test_eligible_asteroid_field_cells_are_unique_poi_adjacent_cells() -> None:
    cells = eligible_asteroid_field_cells()

    assert len(cells) > len(SYSTEM_POINTS_OF_INTEREST) * 4
    assert (0, 0) in cells
    assert (30, 0) in cells
    assert all(
        math.hypot(
            (cell_x + 0.5) * SYSTEM_MAP_CELL_SIZE_METERS,
            (cell_z + 0.5) * SYSTEM_MAP_CELL_SIZE_METERS,
        ) <= 3_100_000_000
        for cell_x, cell_z in cells
    )


def test_station_local_belts_spawn_in_a_condensed_shell_outside_station_visibility() -> None:
    for seed in range(100):
        distance = math.dist(
            random_local_belt_position(random.Random(seed)), KEPLER_STATION_POSITION
        )
        assert LOCAL_BELT_MINIMUM_DISTANCE_METERS <= distance <= LOCAL_BELT_MAXIMUM_DISTANCE_METERS


async def test_catalog_spawning_persists_class_and_pinned_assays(monkeypatch) -> None:
    from unittest.mock import AsyncMock

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from spaceconomy.models import Asteroid, AsteroidField, MineralDefinition, SolarSystem
    from spaceconomy.seed import _upsert_mineral

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            for table in (SolarSystem.__table__, MineralDefinition.__table__, AsteroidField.__table__, Asteroid.__table__):
                await connection.run_sync(table.create)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        catalog = load_mineral_catalog()
        async with sessions.begin() as session:
            session.add(SolarSystem(system_key="kepler", display_name="Kepler", radius_meters=100_000_000))
            for mineral in catalog.minerals:
                await _upsert_mineral(session, mineral)
            definitions = list(await session.scalars(select(MineralDefinition)))
            for definition in definitions:
                definition.version = 3
        monkeypatch.setattr(world, "session_factory", sessions)
        monkeypatch.setattr(world, "expire_jettisoned_items", AsyncMock())
        monkeypatch.setattr(world, "expire_market_listings", AsyncMock())
        monkeypatch.setattr(world.settings, "asteroid_spawning_enabled", True)
        monkeypatch.setattr(world.settings, "asteroid_spawn_batch_size", 1)
        monkeypatch.setattr(world.settings, "asteroid_field_maximum_active_asteroids", 6)
        monkeypatch.setattr(world, "random_cell_field_position", lambda cell, generator: (0, 0, 0))
        assert await world.replenish_asteroid_fields() == 6
        async with sessions() as session:
            field = await session.scalar(select(AsteroidField))
            profile = json.loads(field.spawn_profile)
            zone_class = zone_for_position(resource_zones(catalog, 100_000_000, 0, 0), 0, 0).zone_class
            assert profile == {"catalog_version": 1, "zone_class": zone_class, "zone_id": f"kepler-class-{zone_class}"}
            asteroids = list(await session.scalars(select(Asteroid)))
            for asteroid in asteroids:
                assay = json.loads(asteroid.mineral_assay)
                assert assay == generate_assay(catalog, zone_class, asteroid.spawn_seed, {mineral.definition_id: 3 for mineral in catalog.minerals})
                assert asteroid.composition == assay[0]["definition_id"]
        async with sessions.begin() as session:
            definition = await session.scalar(select(MineralDefinition).where(MineralDefinition.definition_id == "gold"))
            definition.active = False
        with pytest.raises(ValueError, match="all configured mineral definitions"):
            await world.replenish_asteroid_fields()
    finally:
        await engine.dispose()


def test_mineral_foundation_migration_retains_legacy_identity() -> None:
    import importlib.util
    from pathlib import Path

    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    path = Path(__file__).parents[1] / "alembic/versions/20260914_37_mineral_foundation.py"
    spec = importlib.util.spec_from_file_location("mineral_foundation_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine("sqlite:///:memory:")
    try:
        with engine.begin() as connection:
            metadata = sa.MetaData()
            minerals = sa.Table("mineral_definitions", metadata,
                sa.Column("id", sa.String(), primary_key=True),
                sa.Column("definition_id", sa.String()), sa.Column("version", sa.Integer()),
                sa.Column("display_name", sa.String()), sa.Column("active", sa.Boolean()))
            metadata.create_all(connection)
            connection.execute(minerals.insert(), [
                {"id": "iron-2", "definition_id": "iron", "version": 2, "display_name": "Edited iron", "active": False},
                {"id": "legacy-1", "definition_id": "platinum_group", "version": 1, "display_name": "Legacy metal", "active": True},
            ])
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
            upgraded = sa.Table("mineral_definitions", sa.MetaData(), autoload_with=connection)
            rows = {row.id: row for row in connection.execute(sa.select(upgraded))}
            assert len(rows) == 2
            assert rows["iron-2"].version == 2
            assert rows["iron-2"].display_name == "Edited iron"
            assert not rows["iron-2"].active
            assert not rows["legacy-1"].active
            assert rows["legacy-1"].definition_id == "platinum_group"
            assert rows["iron-2"].industrial_role == ""
            assert rows["iron-2"].visual_family == "rocky"
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
            assert "industrial_role" not in {column["name"] for column in sa.inspect(connection).get_columns("mineral_definitions")}
    finally:
        engine.dispose()