"""Persist pilot-scanned resource map cells.

Revision ID: 20260915_41
Revises: 20260915_40
Create Date: 2026-09-15 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260915_41"
down_revision: str | Sequence[str] | None = "20260915_40"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create private resource-cell survey records."""
    op.create_table(
        "pilot_resource_surveys",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("pilot_id", sa.Uuid(), nullable=False),
        sa.Column("system_id", sa.Uuid(), nullable=False),
        sa.Column("cell_x", sa.Integer(), nullable=False),
        sa.Column("cell_z", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["pilot_id"], ["pilots.id"]),
        sa.ForeignKeyConstraint(["system_id"], ["solar_systems.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pilot_id", "system_id", "cell_x", "cell_z"),
    )
    op.create_index("ix_pilot_resource_surveys_pilot_id", "pilot_resource_surveys", ["pilot_id"])
    op.create_index("ix_pilot_resource_surveys_system_id", "pilot_resource_surveys", ["system_id"])


def downgrade() -> None:
    """Remove private resource-cell survey records."""
    op.drop_index("ix_pilot_resource_surveys_system_id", table_name="pilot_resource_surveys")
    op.drop_index("ix_pilot_resource_surveys_pilot_id", table_name="pilot_resource_surveys")
    op.drop_table("pilot_resource_surveys")