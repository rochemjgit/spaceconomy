"""Relocate Meridian and Meridian Exchange to cell 10, -39.

Revision ID: 20260915_33
Revises: 20260915_32
Create Date: 2026-09-15 13:15:00
"""

from alembic import op

revision = "20260915_33"
down_revision = "20260915_32"
branch_labels = None
depends_on = None

STATION_X = 1_000_000_000
STATION_Y = 480
STATION_Z = -3_900_050_000


def upgrade() -> None:
    op.execute(
        f"UPDATE ship_states SET position_x = {STATION_X}, position_y = {STATION_Y}, "
        f"position_z = {STATION_Z} WHERE docked_station_name = 'MERIDIAN EXCHANGE'"
    )
    op.execute(
        f"UPDATE ship_locations SET position_x = {STATION_X}, position_y = {STATION_Y}, "
        f"position_z = {STATION_Z} FROM ships, ship_states "
        "WHERE ship_locations.ship_id = ships.id AND ships.pilot_id = ship_states.pilot_id "
        "AND ship_states.docked_station_name = 'MERIDIAN EXCHANGE'"
    )


def downgrade() -> None:
    pass