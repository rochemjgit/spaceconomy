"""Backfill the module-owned S1 survey range for existing pilots.

Revision ID: 20260913_35
Revises: 20260912_34
Create Date: 2026-09-13 20:45:00
"""

import json
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "20260913_35"
down_revision = "20260912_34"
branch_labels = None
depends_on = None

SENSOR_DEFINITION_ID = "module.sensor_array.s1"
SENSOR_VERSION = 1
SENSOR_RANGE_METERS = 500_000.0


def upgrade() -> None:
    """Replace legacy hull sensors with a fitted S1 array for active ships."""
    connection = op.get_bind()

    hulls = connection.execute(sa.text("SELECT id, base_statistics FROM hull_definitions")).mappings()
    for hull in hulls:
        statistics = json.loads(hull["base_statistics"])
        if "sensor_range_meters" not in statistics:
            continue
        statistics.pop("sensor_range_meters")
        connection.execute(
            sa.text("UPDATE hull_definitions SET base_statistics = :statistics WHERE id = :id"),
            {"id": hull["id"], "statistics": json.dumps(statistics, sort_keys=True)},
        )

    sensor_id = connection.scalar(
        sa.text(
            "SELECT id FROM module_definitions "
            "WHERE definition_id = :definition_id AND version = :version"
        ),
        {"definition_id": SENSOR_DEFINITION_ID, "version": SENSOR_VERSION},
    )
    sensor_values = {
        "display_name": "S1 Survey Array",
        "family": "sensor_array",
        "fit_location": "core_system",
        "cpu_demand": 8.0,
        "powergrid_demand": 10.0,
        "durability_maximum": 100.0,
        "mass_kg": 350.0,
        "volume_cubic_meters": 2.0,
        "effective_range_meters": SENSOR_RANGE_METERS,
        "starter_grant": True,
        "active": True,
    }
    if sensor_id is None:
        sensor_id = uuid4()
        connection.execute(
            sa.text(
                "INSERT INTO module_definitions "
                "(id, definition_id, version, display_name, family, fit_location, cpu_demand, "
                "powergrid_demand, durability_maximum, mass_kg, volume_cubic_meters, "
                "effective_range_meters, starter_grant, active) "
                "VALUES (:id, :definition_id, :version, :display_name, :family, :fit_location, "
                ":cpu_demand, :powergrid_demand, :durability_maximum, :mass_kg, "
                ":volume_cubic_meters, :effective_range_meters, :starter_grant, :active)"
            ),
            {"id": sensor_id, "definition_id": SENSOR_DEFINITION_ID, "version": SENSOR_VERSION, **sensor_values},
        )
    else:
        assignments = ", ".join(f"{name} = :{name}" for name in sensor_values)
        connection.execute(
            sa.text(f"UPDATE module_definitions SET {assignments} WHERE id = :id"),
            {"id": sensor_id, **sensor_values},
        )
    connection.execute(
        sa.text("DELETE FROM module_effects WHERE module_definition_id = :module_definition_id"),
        {"module_definition_id": sensor_id},
    )
    connection.execute(
        sa.text(
            "INSERT INTO module_effects "
            "(id, module_definition_id, effect_index, statistic, operation, value) "
            "VALUES (:id, :module_definition_id, 0, 'sensor_range_meters', 'flat', :value)"
        ),
        {"id": uuid4(), "module_definition_id": sensor_id, "value": SENSOR_RANGE_METERS},
    )

    ships = connection.execute(
        sa.text(
            "SELECT ships.id, ships.pilot_id, hull_definitions.core_system_slot_count "
            "FROM ships JOIN hull_definitions ON hull_definitions.id = ships.hull_definition_id "
            "WHERE ships.status = 'active'"
        )
    ).mappings()
    for ship in ships:
        fitted_sensor = connection.scalar(
            sa.text(
                "SELECT 1 FROM fitted_modules "
                "WHERE ship_id = :ship_id AND module_definition_id = :module_definition_id"
            ),
            {"ship_id": ship["id"], "module_definition_id": sensor_id},
        )
        if fitted_sensor is not None:
            continue
        available_slot = connection.scalar(
            sa.text(
                "SELECT slot_index FROM generate_series(0, :slot_count - 1) AS slot_index "
                "WHERE NOT EXISTS (SELECT 1 FROM fitted_modules "
                "WHERE ship_id = :ship_id AND slot_location = 'core_system' "
                "AND fitted_modules.slot_index = slot_index) "
                "ORDER BY slot_index LIMIT 1"
            ),
            {"ship_id": ship["id"], "slot_count": ship["core_system_slot_count"]},
        )
        if available_slot is None:
            continue
        item_id = connection.scalar(
            sa.text(
                "SELECT inventory_items.id FROM inventory_items "
                "WHERE pilot_id = :pilot_id AND module_definition_id = :module_definition_id "
                "ORDER BY created_at LIMIT 1"
            ),
            {"pilot_id": ship["pilot_id"], "module_definition_id": sensor_id},
        )
        if item_id is None:
            station_container_id = connection.scalar(
                sa.text(
                    "SELECT id FROM inventory_containers "
                    "WHERE pilot_id = :pilot_id AND station_id IS NOT NULL ORDER BY created_at LIMIT 1"
                ),
                {"pilot_id": ship["pilot_id"]},
            )
            if station_container_id is None:
                continue
            item_id = uuid4()
            connection.execute(
                sa.text(
                    "INSERT INTO inventory_items "
                    "(id, pilot_id, container_id, module_definition_id, definition_id, "
                    "definition_version, quantity, durability, volume_per_unit) "
                    "VALUES (:id, :pilot_id, :container_id, :module_definition_id, "
                    ":definition_id, :definition_version, 1, 100, 2)"
                ),
                {
                    "id": item_id,
                    "pilot_id": ship["pilot_id"],
                    "container_id": station_container_id,
                    "module_definition_id": sensor_id,
                    "definition_id": SENSOR_DEFINITION_ID,
                    "definition_version": SENSOR_VERSION,
                },
            )
        connection.execute(
            sa.text(
                "INSERT INTO fitted_modules "
                "(id, ship_id, inventory_item_id, module_definition_id, slot_location, "
                "slot_index, durability) "
                "VALUES (:id, :ship_id, :inventory_item_id, :module_definition_id, "
                "'core_system', :slot_index, 100)"
            ),
            {
                "id": uuid4(),
                "ship_id": ship["id"],
                "inventory_item_id": item_id,
                "module_definition_id": sensor_id,
                "slot_index": available_slot,
            },
        )


def downgrade() -> None:
    pass
