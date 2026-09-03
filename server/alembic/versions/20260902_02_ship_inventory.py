"""Create durable ship and inventory tables.

Revision ID: 20260902_02
Revises: 20260902_01
Create Date: 2026-09-02 01:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260902_02"
down_revision: str | Sequence[str] | None = "20260902_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column[object]]:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    ]


def upgrade() -> None:
    """Create authoritative player ship, checkpoint, and item state."""
    op.create_table(
        "ships",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("pilot_id", sa.Uuid(), nullable=False),
        sa.Column("hull_definition_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("docked_station_id", sa.Uuid(), nullable=True),
        *_timestamps(),
        sa.CheckConstraint("status IN ('active', 'destroyed')", name="ship_status_valid"),
        sa.ForeignKeyConstraint(["pilot_id"], ["pilots.id"]),
        sa.ForeignKeyConstraint(["hull_definition_id"], ["hull_definitions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ships_pilot_id", "ships", ["pilot_id"], unique=False)
    op.create_index("ix_ships_docked_station_id", "ships", ["docked_station_id"], unique=False)
    op.create_table(
        "ship_locations",
        sa.Column("ship_id", sa.Uuid(), nullable=False),
        sa.Column("position_x", sa.Float(), nullable=False),
        sa.Column("position_y", sa.Float(), nullable=False),
        sa.Column("position_z", sa.Float(), nullable=False),
        sa.Column("heading_x", sa.Float(), nullable=False),
        sa.Column("heading_y", sa.Float(), nullable=False),
        sa.Column("heading_z", sa.Float(), nullable=False),
        sa.Column("velocity_x", sa.Float(), nullable=False),
        sa.Column("velocity_y", sa.Float(), nullable=False),
        sa.Column("velocity_z", sa.Float(), nullable=False),
        sa.Column("navigation_destination_id", sa.Uuid(), nullable=True),
        sa.Column("checkpointed_at", sa.DateTime(timezone=True), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["ship_id"], ["ships.id"]),
        sa.PrimaryKeyConstraint("ship_id"),
    )
    op.create_table(
        "inventory_containers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("pilot_id", sa.Uuid(), nullable=False),
        sa.Column("ship_id", sa.Uuid(), nullable=True),
        sa.Column("station_id", sa.Uuid(), nullable=True),
        sa.Column("container_type", sa.String(length=32), nullable=False),
        sa.Column("capacity_cubic_meters", sa.Float(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            "(ship_id IS NULL) <> (station_id IS NULL)", name="container_has_one_location"
        ),
        sa.CheckConstraint("capacity_cubic_meters >= 0", name="container_capacity_valid"),
        sa.ForeignKeyConstraint(["pilot_id"], ["pilots.id"]),
        sa.ForeignKeyConstraint(["ship_id"], ["ships.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ship_id"),
    )
    op.create_index(
        "ix_inventory_containers_pilot_id", "inventory_containers", ["pilot_id"], unique=False
    )
    op.create_index(
        "ix_inventory_containers_station_id", "inventory_containers", ["station_id"], unique=False
    )
    op.create_table(
        "inventory_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("pilot_id", sa.Uuid(), nullable=False),
        sa.Column("container_id", sa.Uuid(), nullable=True),
        sa.Column("module_definition_id", sa.Uuid(), nullable=True),
        sa.Column("definition_id", sa.String(length=128), nullable=False),
        sa.Column("definition_version", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("durability", sa.Float(), nullable=False),
        sa.Column("volume_per_unit", sa.Float(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint("quantity > 0", name="inventory_item_quantity_valid"),
        sa.CheckConstraint("durability >= 0", name="inventory_item_durability_valid"),
        sa.CheckConstraint("volume_per_unit >= 0", name="inventory_item_volume_valid"),
        sa.ForeignKeyConstraint(["pilot_id"], ["pilots.id"]),
        sa.ForeignKeyConstraint(["container_id"], ["inventory_containers.id"]),
        sa.ForeignKeyConstraint(["module_definition_id"], ["module_definitions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_inventory_items_pilot_id", "inventory_items", ["pilot_id"], unique=False)
    op.create_index(
        "ix_inventory_items_container_id", "inventory_items", ["container_id"], unique=False
    )
    op.create_table(
        "fitted_modules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("ship_id", sa.Uuid(), nullable=False),
        sa.Column("inventory_item_id", sa.Uuid(), nullable=False),
        sa.Column("module_definition_id", sa.Uuid(), nullable=False),
        sa.Column("slot_location", sa.String(length=32), nullable=False),
        sa.Column("slot_index", sa.Integer(), nullable=False),
        sa.Column("durability", sa.Float(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint("slot_index >= 0", name="fitted_module_slot_index_valid"),
        sa.CheckConstraint("durability >= 0", name="fitted_module_durability_valid"),
        sa.ForeignKeyConstraint(["ship_id"], ["ships.id"]),
        sa.ForeignKeyConstraint(["inventory_item_id"], ["inventory_items.id"]),
        sa.ForeignKeyConstraint(["module_definition_id"], ["module_definitions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("inventory_item_id"),
        sa.UniqueConstraint("ship_id", "slot_location", "slot_index"),
    )
    op.create_index("ix_fitted_modules_ship_id", "fitted_modules", ["ship_id"], unique=False)


def downgrade() -> None:
    """Remove durable player ship and inventory state."""
    op.drop_index("ix_fitted_modules_ship_id", table_name="fitted_modules")
    op.drop_table("fitted_modules")
    op.drop_index("ix_inventory_items_container_id", table_name="inventory_items")
    op.drop_index("ix_inventory_items_pilot_id", table_name="inventory_items")
    op.drop_table("inventory_items")
    op.drop_index("ix_inventory_containers_station_id", table_name="inventory_containers")
    op.drop_index("ix_inventory_containers_pilot_id", table_name="inventory_containers")
    op.drop_table("inventory_containers")
    op.drop_table("ship_locations")
    op.drop_index("ix_ships_docked_station_id", table_name="ships")
    op.drop_index("ix_ships_pilot_id", table_name="ships")
    op.drop_table("ships")