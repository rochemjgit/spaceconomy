"""Add physical attributes to module definitions.

Revision ID: 20260905_10
Revises: 20260905_09
Create Date: 2026-09-05 10:50:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260905_10"
down_revision: str | Sequence[str] | None = "20260905_09"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Store immutable mass and physical volume for every module definition."""
    op.add_column(
        "module_definitions",
        sa.Column("mass_kg", sa.Float(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "module_definitions",
        sa.Column("volume_cubic_meters", sa.Float(), server_default=sa.text("0"), nullable=False),
    )
    op.create_check_constraint(
        "module_definition_mass_valid",
        "module_definitions",
        "mass_kg >= 0",
    )
    op.create_check_constraint(
        "module_definition_volume_valid",
        "module_definitions",
        "volume_cubic_meters >= 0",
    )
    op.alter_column("module_definitions", "mass_kg", server_default=None)
    op.alter_column("module_definitions", "volume_cubic_meters", server_default=None)


def downgrade() -> None:
    """Remove module physical attributes."""
    op.drop_constraint("module_definition_volume_valid", "module_definitions", type_="check")
    op.drop_constraint("module_definition_mass_valid", "module_definitions", type_="check")
    op.drop_column("module_definitions", "volume_cubic_meters")
    op.drop_column("module_definitions", "mass_kg")
