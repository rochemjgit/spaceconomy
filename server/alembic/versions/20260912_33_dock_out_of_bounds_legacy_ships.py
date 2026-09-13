"""Dock legacy ships outside the relocated Kepler system boundary.

Revision ID: 20260912_33
Revises: 20260912_32
Create Date: 2026-09-13 00:45:00
"""

from alembic import op

revision = "20260912_33"
down_revision = "20260912_32"
branch_labels = None
depends_on = None

STATION_X = 3_000_003_400
STATION_Y = 480
STATION_Z = -3_400
SYSTEM_RADIUS_METERS = 3_100_000_000


def upgrade() -> None:
    op.execute(
        f"UPDATE ship_states SET position_x = {STATION_X}, position_y = {STATION_Y}, "
        f"position_z = {STATION_Z}, docked_station_name = 'KEPLER STATION' "
        f"WHERE ABS(position_x) > {SYSTEM_RADIUS_METERS} "
        f"OR ABS(position_y) > {SYSTEM_RADIUS_METERS} "
        f"OR ABS(position_z) > {SYSTEM_RADIUS_METERS}"
    )


def downgrade() -> None:
    pass