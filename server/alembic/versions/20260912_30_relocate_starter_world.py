"""Relocate Starter World and Kepler Station to the outer system.

Revision ID: 20260912_30
Revises: 20260912_29
Create Date: 2026-09-12 13:15:00
"""

from alembic import op

revision = "20260912_30"
down_revision = "20260912_29"
branch_labels = None
depends_on = None

NEW_STATION_X = 50_000_003_400
NEW_STATION_Y = 480
NEW_STATION_Z = -3_400
NEW_SYSTEM_RADIUS_METERS = 50_100_000_000


def upgrade() -> None:
    op.execute(
        f"UPDATE solar_systems SET radius_meters = {NEW_SYSTEM_RADIUS_METERS} "
        "WHERE system_key = 'kepler'"
    )
    op.execute(
        f"UPDATE ship_states SET position_x = {NEW_STATION_X}, "
        f"position_y = {NEW_STATION_Y}, position_z = {NEW_STATION_Z} "
        "WHERE docked_station_name = 'KEPLER STATION'"
    )


def downgrade() -> None:
    op.execute("UPDATE solar_systems SET radius_meters = 18000000 WHERE system_key = 'kepler'")
    op.execute(
        "UPDATE ship_states SET position_x = 123078, position_y = 480, position_z = -2691 "
        "WHERE docked_station_name = 'KEPLER STATION'"
    )