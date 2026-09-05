"""Persist sensor cooldown state for each pilot ship.

Revision ID: 20260905_07
Revises: 20260905_06
Create Date: 2026-09-05 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260905_07"
down_revision: str | Sequence[str] | None = "20260905_06"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the durable sensor cooldown timestamp."""
    op.add_column("ship_states", sa.Column("sensor_last_scan_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Remove the sensor cooldown timestamp."""
    op.drop_column("ship_states", "sensor_last_scan_at")