"""Add the mineral catalog and immutable raw ore assays.

Revision ID: 20260905_09
Revises: 20260905_08
Create Date: 2026-09-05 01:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260905_09"
down_revision: str | Sequence[str] | None = "20260905_08"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create versioned minerals and snapshot existing asteroids as empty assays."""
    op.create_table(
        "mineral_definitions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("definition_id", sa.String(length=64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("classification", sa.String(length=16), nullable=False),
        sa.Column("rarity_tier", sa.String(length=16), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("definition_id", "version"),
    )
    op.add_column("asteroids", sa.Column("mineral_assay", sa.Text(), server_default="[]", nullable=False))
    op.add_column("mined_ore_lots", sa.Column("mineral_assay", sa.Text(), server_default="[]", nullable=False))


def downgrade() -> None:
    """Remove mineral catalog and assay snapshots."""
    op.drop_column("mined_ore_lots", "mineral_assay")
    op.drop_column("asteroids", "mineral_assay")
    op.drop_table("mineral_definitions")