"""Exercise migration 12 on isolated populated legacy SQLite schema.

SQLite batch rebuilds need foreign keys disabled during migration; integrity is
checked explicitly afterward. No Alembic environment or configured DB is used.
"""

import importlib.util
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from spaceconomy.db import Base
from spaceconomy.inventory import KEPLER_STATION_ID
from spaceconomy.models import (  # noqa: F401 -- ensure the complete metadata is registered
    Account,
    Asteroid,
    AsteroidField,
    FittedModule,
    HullDefinition,
    InventoryContainer,
    InventoryItem,
    JettisonedItem,
    MinedOreLot,
    ModuleDefinition,
    Pilot,
    Ship,
    ShipState,
    SolarSystem,
)


def load_migration():
    path = Path(__file__).parents[1] / "alembic/versions/20260905_12_inventory_ore_containers.py"
    spec = importlib.util.spec_from_file_location("inventory_migration_12", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def legacy_schema(connection):
    Base.metadata.create_all(connection)
    ops = Operations(MigrationContext.configure(connection))
    with ops.batch_alter_table("inventory_items") as batch:
        batch.drop_constraint("inventory_module_singleton", type_="check")
    with ops.batch_alter_table("inventory_containers") as batch:
        batch.drop_constraint("uq_pilot_station_container", type_="unique")
    with ops.batch_alter_table(
        "mined_ore_lots",
        naming_convention={
            "fk": "fk_%(table_name)s_%(column_0_name)s",
        },
    ) as batch:
        batch.drop_constraint("fk_mined_ore_lots_container_id", type_="foreignkey")
        batch.drop_index("ix_mined_ore_lots_container_id")
        batch.drop_column("container_id")
        batch.create_unique_constraint("old_pilot_asteroid", ["pilot_id", "asteroid_id"])
    with ops.batch_alter_table(
        "jettisoned_items",
        naming_convention={
            "fk": "fk_%(table_name)s_%(column_0_name)s",
        },
    ) as batch:
        batch.drop_constraint("jettisoned_module_singleton", type_="check")
        batch.drop_constraint("jettisoned_ore_metadata_valid", type_="check")
        batch.drop_constraint("fk_jettisoned_items_ore_asteroid_id", type_="foreignkey")
        batch.drop_column("ore_asteroid_id")
        batch.drop_column("ore_composition")
        batch.drop_column("ore_mineral_assay")
    metadata = load_migration()._reflection_metadata()
    metadata.reflect(connection)
    return metadata.tables, ops


def populate(connection, tables, cargo_exists):
    ids = {
        name: uuid4()
        for name in (
            "account",
            "pilot",
            "hull",
            "module",
            "system",
            "field",
            "asteroid",
            "ship",
            "cargo",
            "station",
            "duplicate",
            "item",
            "fitted_item",
            "public",
            "lot",
        )
    }

    def add(table_name, **values):
        connection.execute(tables[table_name].insert().values(**values))

    add(
        "accounts",
        id=ids["account"],
        email="migration@example.invalid",
        first_name="A",
        last_name="B",
        password_hash="unused",
        status="active",
    )
    add("pilots", id=ids["pilot"], account_id=ids["account"], display_name="Migration Pilot")
    add(
        "ship_states",
        pilot_id=ids["pilot"],
        position_x=0,
        position_y=0,
        position_z=0,
        power_megajoules=100,
        shields=100,
        hull=100,
        fuel_liters=80,
        cargo_cubic_meters=4,
    )
    add(
        "hull_definitions",
        id=ids["hull"],
        definition_id="custom.hull",
        version=3,
        display_name="Pinned Hull",
        universal_hardpoint_count=2,
        core_system_slot_count=2,
        base_statistics='{"cargo_volume":37}',
        active=True,
    )
    add(
        "module_definitions",
        id=ids["module"],
        definition_id="module.test",
        version=7,
        display_name="Test",
        family="test",
        fit_location="universal",
        cpu_demand=1,
        powergrid_demand=1,
        durability_maximum=100,
        mass_kg=2,
        volume_cubic_meters=0.5,
        active=True,
    )
    add(
        "solar_systems",
        id=ids["system"],
        system_key="kepler",
        display_name="Kepler",
        radius_meters=1e6,
    )
    add(
        "asteroid_fields",
        id=ids["field"],
        system_id=ids["system"],
        field_key="test",
        display_name="Test",
        position_x=0,
        position_y=0,
        position_z=0,
        discovery_signature=1,
        spawn_profile="{}",
        active=True,
    )
    add(
        "asteroids",
        id=ids["asteroid"],
        field_id=ids["field"],
        spawn_seed=1,
        position_x=0,
        position_y=0,
        position_z=0,
        radius_meters=10,
        composition="ferrous",
        mineral_assay='[{"mineral":"iron","percentage":100}]',
        initial_volume_cubic_meters=100,
        remaining_volume_cubic_meters=96,
    )
    add(
        "ships",
        id=ids["ship"],
        pilot_id=ids["pilot"],
        hull_definition_id=ids["hull"],
        name="Test",
        status="active",
    )
    if cargo_exists:
        add(
            "inventory_containers",
            id=ids["cargo"],
            pilot_id=ids["pilot"],
            ship_id=ids["ship"],
            container_type="ship_cargo",
            capacity_cubic_meters=37,
        )
    for name in ("station", "duplicate"):
        add(
            "inventory_containers",
            id=ids[name],
            pilot_id=ids["pilot"],
            station_id=KEPLER_STATION_ID,
            container_type="station_storage",
            capacity_cubic_meters=0,
        )
    for name, container in (("item", ids["duplicate"]), ("fitted_item", None)):
        add(
            "inventory_items",
            id=ids[name],
            pilot_id=ids["pilot"],
            container_id=container,
            module_definition_id=ids["module"],
            definition_id="module.test",
            definition_version=7,
            quantity=3,
            durability=71.5,
            volume_per_unit=0.5,
        )
    add(
        "fitted_modules",
        id=uuid4(),
        ship_id=ids["ship"],
        inventory_item_id=ids["fitted_item"],
        module_definition_id=ids["module"],
        slot_location="universal",
        slot_index=0,
        durability=71.5,
    )
    add(
        "jettisoned_items",
        id=ids["public"],
        module_definition_id=ids["module"],
        definition_id="module.test",
        definition_version=7,
        quantity=4,
        durability=52,
        volume_per_unit=0.5,
        position_x=1,
        position_y=2,
        position_z=3,
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )
    add(
        "mined_ore_lots",
        id=ids["lot"],
        pilot_id=ids["pilot"],
        asteroid_id=ids["asteroid"],
        composition="ferrous",
        mineral_assay='[{"mineral":"iron","percentage":100}]',
        volume_cubic_meters=4,
    )
    return ids


@pytest.mark.parametrize("cargo_exists", [True, False])
def test_upgrade_preserves_ore_modules_fitting_and_public_cargo(cargo_exists):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        tables, ops = legacy_schema(connection)
        ids = populate(connection, tables, cargo_exists)
        migration = load_migration()
        migration.op = ops
        migration.upgrade()
        metadata = migration._reflection_metadata()
        metadata.reflect(connection)
        tables = metadata.tables
        rows = connection.execute(sa.select(tables["inventory_items"])).mappings().all()
        assert len(rows) == 6
        assert all(
            row["quantity"] == 1 and row["durability"] == 71.5 and row["definition_version"] == 7
            for row in rows
        )
        fitted = next(row for row in rows if row["id"] == ids["fitted_item"])
        assert fitted["container_id"] is None
        assert all(
            row["container_id"] is not None for row in rows if row["id"] != ids["fitted_item"]
        )
        public = connection.execute(sa.select(tables["jettisoned_items"])).mappings().all()
        assert len(public) == 4
        assert all(
            row["quantity"] == 1 and row["durability"] == 52 and row["position_x"] == 1
            for row in public
        )
        assert len({row["expires_at"] for row in public}) == 1
        cargo = (
            connection.execute(
                sa.select(tables["inventory_containers"]).where(
                    tables["inventory_containers"].c.ship_id == ids["ship"]
                )
            )
            .mappings()
            .one()
        )
        assert cargo["capacity_cubic_meters"] == 37
        ore = connection.execute(sa.select(tables["mined_ore_lots"])).mappings().one()
        assert ore["container_id"] == cargo["id"]
        assert ore["volume_cubic_meters"] == 4
        assert ore["asteroid_id"] == ids["asteroid"]
        assert ore["mineral_assay"] == '[{"mineral":"iron","percentage":100}]'
        assert not sa.inspect(connection).get_unique_constraints("mined_ore_lots")
        assert "inventory_module_singleton" in {
            c["name"] for c in sa.inspect(connection).get_check_constraints("inventory_items")
        }
        assert connection.execute(sa.text("PRAGMA foreign_key_check")).all() == []
        # The migrated schema really allows split lots in the same source asteroid.
        connection.execute(tables["mined_ore_lots"].insert().values(**{**ore, "id": uuid4()}))
        with pytest.raises(sa.exc.IntegrityError):
            connection.execute(tables["inventory_items"].update().values(quantity=2))
        with pytest.raises(sa.exc.IntegrityError):
            connection.execute(tables["jettisoned_items"].update().values(quantity=2))
    engine.dispose()


def test_downgrade_refuses_lossy_rollback():
    with pytest.raises(RuntimeError, match="losslessly"):
        load_migration().downgrade()
