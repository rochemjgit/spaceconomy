"""Store raw mined ore separately by source asteroid.

Revision ID: 20260905_08
Revises: 20260905_07
Create Date: 2026-09-05 00:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260905_08"
down_revision: str | Sequence[str] | None = "20260905_07"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create raw ore cargo lots keyed by pilot and source asteroid."""
    op.create_table(
        "mined_ore_lots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("pilot_id", sa.Uuid(), nullable=False),
        sa.Column("asteroid_id", sa.Uuid(), nullable=False),
        sa.Column("composition", sa.String(length=64), nullable=False),
        sa.Column("volume_cubic_meters", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("volume_cubic_meters > 0", name="mined_ore_lot_volume_valid"),
        sa.ForeignKeyConstraint(["pilot_id"], ["pilots.id"]),
        sa.ForeignKeyConstraint(["asteroid_id"], ["asteroids.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pilot_id", "asteroid_id"),
    )
    op.create_index("ix_mined_ore_lots_pilot_id", "mined_ore_lots", ["pilot_id"], unique=False)
    op.create_index("ix_mined_ore_lots_asteroid_id", "mined_ore_lots", ["asteroid_id"], unique=False)


def downgrade() -> None:
    """Remove raw ore cargo lots."""
    op.drop_index("ix_mined_ore_lots_asteroid_id", table_name="mined_ore_lots")
    op.drop_index("ix_mined_ore_lots_pilot_id", table_name="mined_ore_lots")
    op.drop_table("mined_ore_lots")