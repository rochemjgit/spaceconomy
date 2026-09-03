"""Persist per-pilot launch position and runtime ship state.

Revision ID: 20260903_05
Revises: 20260903_04
Create Date: 2026-09-03 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260903_05"
down_revision: str | Sequence[str] | None = "20260903_04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the durable runtime state checkpoint for every pilot."""
    op.create_table(
        "ship_states",
        sa.Column("pilot_id", sa.Uuid(), nullable=False),
        sa.Column("position_x", sa.Float(), nullable=False),
        sa.Column("position_y", sa.Float(), nullable=False),
        sa.Column("position_z", sa.Float(), nullable=False),
        sa.Column("docked_station_name", sa.String(length=128), nullable=True),
        sa.Column("power_megajoules", sa.Float(), nullable=False),
        sa.Column("shields", sa.Float(), nullable=False),
        sa.Column("hull", sa.Float(), nullable=False),
        sa.Column("fuel_liters", sa.Float(), nullable=False),
        sa.Column("cargo_cubic_meters", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["pilot_id"], ["pilots.id"]),
        sa.PrimaryKeyConstraint("pilot_id"),
    )


def downgrade() -> None:
    """Remove runtime ship-state checkpoints."""
    op.drop_table("ship_states")