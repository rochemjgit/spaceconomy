"""Add durable system, asteroid field, asteroid, and pilot discovery records.

Revision ID: 20260905_06
Revises: 20260903_05
Create Date: 2026-09-05 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260905_06"
down_revision: str | Sequence[str] | None = "20260903_05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create authoritative mining-world and player discovery tables."""
    op.create_table(
        "solar_systems",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("system_key", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("radius_meters", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("system_key"),
    )
    op.create_table(
        "asteroid_fields",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("system_id", sa.Uuid(), nullable=False),
        sa.Column("field_key", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("position_x", sa.Float(), nullable=False),
        sa.Column("position_y", sa.Float(), nullable=False),
        sa.Column("position_z", sa.Float(), nullable=False),
        sa.Column("discovery_signature", sa.Float(), nullable=False),
        sa.Column("spawn_profile", sa.Text(), nullable=False),
        sa.Column("next_spawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["system_id"], ["solar_systems.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("system_id", "field_key"),
    )
    op.create_index("ix_asteroid_fields_system_id", "asteroid_fields", ["system_id"])
    op.create_table(
        "asteroids",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("field_id", sa.Uuid(), nullable=False),
        sa.Column("spawn_seed", sa.Integer(), nullable=False),
        sa.Column("position_x", sa.Float(), nullable=False),
        sa.Column("position_y", sa.Float(), nullable=False),
        sa.Column("position_z", sa.Float(), nullable=False),
        sa.Column("radius_meters", sa.Float(), nullable=False),
        sa.Column("composition", sa.String(length=64), nullable=False),
        sa.Column("initial_volume_cubic_meters", sa.Float(), nullable=False),
        sa.Column("remaining_volume_cubic_meters", sa.Float(), nullable=False),
        sa.Column("depleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("initial_volume_cubic_meters > 0", name="asteroid_initial_volume_valid"),
        sa.CheckConstraint("remaining_volume_cubic_meters >= 0", name="asteroid_remaining_volume_valid"),
        sa.ForeignKeyConstraint(["field_id"], ["asteroid_fields.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_asteroids_field_id", "asteroids", ["field_id"])
    op.create_table(
        "pilot_discoveries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("pilot_id", sa.Uuid(), nullable=False),
        sa.Column("discoverable_kind", sa.String(length=32), nullable=False),
        sa.Column("discoverable_id", sa.Uuid(), nullable=False),
        sa.Column("scan_quality", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["pilot_id"], ["pilots.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pilot_id", "discoverable_kind", "discoverable_id"),
    )
    op.create_index("ix_pilot_discoveries_pilot_id", "pilot_discoveries", ["pilot_id"])


def downgrade() -> None:
    """Remove mining-world tables."""
    op.drop_index("ix_pilot_discoveries_pilot_id", table_name="pilot_discoveries")
    op.drop_table("pilot_discoveries")
    op.drop_index("ix_asteroids_field_id", table_name="asteroids")
    op.drop_table("asteroids")
    op.drop_index("ix_asteroid_fields_system_id", table_name="asteroid_fields")
    op.drop_table("asteroid_fields")
    op.drop_table("solar_systems")