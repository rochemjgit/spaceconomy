"""Add configurable station service availability.

Revision ID: 20260915_29
Revises: 20260914_37
Create Date: 2026-09-15 09:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260915_29"
down_revision: str | Sequence[str] | None = "20260914_37"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the station-level service availability registry."""
    op.create_table(
        "station_services",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("station_id", sa.Uuid(), nullable=False),
        sa.Column("service_key", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("available", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("station_id", "service_key", name="uq_station_service_station_key"),
    )
    op.create_index("ix_station_services_station_id", "station_services", ["station_id"])


def downgrade() -> None:
    """Remove station service availability records."""
    op.drop_index("ix_station_services_station_id", table_name="station_services")
    op.drop_table("station_services")