"""Move planet-bound stations to 100 km above their world surfaces.

Revision ID: 20260915_41
Revises: 20260915_40
Create Date: 2026-09-15 15:15:00
"""

from alembic import op

revision = "20260915_41"
down_revision = "20260915_40"
branch_labels = None
depends_on = None

STATION_POSITIONS = {
    "KEPLER STATION": (-2_600_000_000, 480, -4_510_100_000),
    "CINDER GATE": (420_000_000, 480, 156_000_000),
    "MERIDIAN EXCHANGE": (1_000_000_000, 480, -3_906_700_000),
    "VERDANCE HAVEN": (-2_000_000_000, 480, 4_591_500_000),
    "PELAGOS ANCHORAGE": (-3_900_000_000, 480, 2_890_100_000),
    "EMBERFALL FORGE": (-4_500_000_000, 480, -505_800_000),
    "NACRE RELAY": (2_220_000_000, 480, 1_362_350_000),
    "HELIOS CROWN": (2_510_000_000, 480, -1_584_100_000),
    "UMBRA WATCH": (3_100_000_000, 480, 2_292_900_000),
    "AURORA SPIRE": (-2_530_000_000, 480, -1_507_600_000),
}


def upgrade() -> None:
    for station_name, (position_x, position_y, position_z) in STATION_POSITIONS.items():
        op.execute(
            f"UPDATE ship_states SET position_x = {position_x}, position_y = {position_y}, "
            f"position_z = {position_z} WHERE docked_station_name = '{station_name}'"
        )
        op.execute(
            f"UPDATE ship_locations SET position_x = {position_x}, position_y = {position_y}, "
            f"position_z = {position_z} FROM ships, ship_states "
            "WHERE ship_locations.ship_id = ships.id AND ships.pilot_id = ship_states.pilot_id "
            f"AND ship_states.docked_station_name = '{station_name}'"
        )


def downgrade() -> None:
    pass