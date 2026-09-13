"""Relocate Kepler and dock all existing pilots.

Revision ID: 20260912_31
Revises: 20260912_30
Create Date: 2026-09-12 13:45:00
"""

from alembic import op

revision = "20260912_31"
down_revision = "20260912_30"
branch_labels = None
depends_on = None

STATION_X = 30_000_003_400
STATION_Y = 480
STATION_Z = -3_400
SYSTEM_RADIUS_METERS = 30_100_000_000


def upgrade() -> None:
    op.execute(
        f"UPDATE solar_systems SET radius_meters = {SYSTEM_RADIUS_METERS} "
        "WHERE system_key = 'kepler'"
    )
    op.execute(
        f"UPDATE ship_states SET position_x = {STATION_X}, position_y = {STATION_Y}, "
        f"position_z = {STATION_Z}, docked_station_name = 'KEPLER STATION'"
    )


def downgrade() -> None:
    op.execute("UPDATE solar_systems SET radius_meters = 50100000000 WHERE system_key = 'kepler'")