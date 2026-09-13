"""Relocate Kepler to 30 system-grid cells from the primary star.

Revision ID: 20260912_32
Revises: 20260912_31
Create Date: 2026-09-13 00:30:00
"""

from alembic import op

revision = "20260912_32"
down_revision = "20260912_31"
branch_labels = None
depends_on = None

STATION_X = 3_000_003_400
STATION_Y = 480
STATION_Z = -3_400
SYSTEM_RADIUS_METERS = 3_100_000_000


def upgrade() -> None:
    op.execute(
        f"UPDATE solar_systems SET radius_meters = {SYSTEM_RADIUS_METERS} "
        "WHERE system_key = 'kepler'"
    )
    op.execute(
        f"UPDATE ship_states SET position_x = {STATION_X}, position_y = {STATION_Y}, "
        f"position_z = {STATION_Z} WHERE docked_station_name = 'KEPLER STATION'"
    )


def downgrade() -> None:
    op.execute("UPDATE solar_systems SET radius_meters = 30100000000 WHERE system_key = 'kepler'")
    op.execute(
        "UPDATE ship_states SET position_x = 30000003400, position_y = 480, position_z = -3400 "
        "WHERE docked_station_name = 'KEPLER STATION'"
    )