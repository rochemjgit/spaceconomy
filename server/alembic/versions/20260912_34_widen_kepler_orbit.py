"""Widen Kepler Station's orbit around Starter World.

Revision ID: 20260912_34
Revises: 20260912_33
Create Date: 2026-09-13 01:00:00
"""

from alembic import op

revision = "20260912_34"
down_revision = "20260912_33"
branch_labels = None
depends_on = None

STATION_X = 3_000_000_000
STATION_Y = 480
STATION_Z = -50_000
FORMER_STATION_X = 3_000_003_400
FORMER_STATION_Z = -3_400
RELOCATION_RADIUS_METERS = 100_000


def upgrade() -> None:
    op.execute(
        f"UPDATE ship_states SET position_x = {STATION_X}, position_y = {STATION_Y}, "
        f"position_z = {STATION_Z}, docked_station_name = 'KEPLER STATION' "
        f"WHERE docked_station_name = 'KEPLER STATION' "
        f"OR (ABS(position_x - {FORMER_STATION_X}) <= {RELOCATION_RADIUS_METERS} "
        f"AND ABS(position_z - {FORMER_STATION_Z}) <= {RELOCATION_RADIUS_METERS})"
    )


def downgrade() -> None:
    pass