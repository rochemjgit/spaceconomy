"""Relocate Emberfall and Emberfall Forge to cell -45, -5.

Revision ID: 20260915_35
Revises: 20260915_34
Create Date: 2026-09-15 13:45:00
"""

from alembic import op

revision = "20260915_35"
down_revision = "20260915_34"
branch_labels = None
depends_on = None

STATION_X = -4_500_000_000
STATION_Y = 480
STATION_Z = -500_050_000


def upgrade() -> None:
    op.execute(
        f"UPDATE ship_states SET position_x = {STATION_X}, position_y = {STATION_Y}, "
        f"position_z = {STATION_Z} WHERE docked_station_name = 'EMBERFALL FORGE'"
    )
    op.execute(
        f"UPDATE ship_locations SET position_x = {STATION_X}, position_y = {STATION_Y}, "
        f"position_z = {STATION_Z} FROM ships, ship_states "
        "WHERE ship_locations.ship_id = ships.id AND ships.pilot_id = ship_states.pilot_id "
        "AND ship_states.docked_station_name = 'EMBERFALL FORGE'"
    )


def downgrade() -> None:
    pass