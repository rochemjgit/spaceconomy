"""Relocate Verdance and Verdance Haven to cell -20, 46.

Revision ID: 20260915_36
Revises: 20260915_35
Create Date: 2026-09-15 14:00:00
"""

from alembic import op

revision = "20260915_36"
down_revision = "20260915_35"
branch_labels = None
depends_on = None

STATION_X = -2_000_000_000
STATION_Y = 480
STATION_Z = 4_599_950_000


def upgrade() -> None:
    op.execute(
        f"UPDATE ship_states SET position_x = {STATION_X}, position_y = {STATION_Y}, "
        f"position_z = {STATION_Z} WHERE docked_station_name = 'VERDANCE HAVEN'"
    )
    op.execute(
        f"UPDATE ship_locations SET position_x = {STATION_X}, position_y = {STATION_Y}, "
        f"position_z = {STATION_Z} FROM ships, ship_states "
        "WHERE ship_locations.ship_id = ships.id AND ships.pilot_id = ship_states.pilot_id "
        "AND ship_states.docked_station_name = 'VERDANCE HAVEN'"
    )


def downgrade() -> None:
    pass