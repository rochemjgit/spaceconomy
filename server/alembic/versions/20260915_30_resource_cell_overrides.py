"""Persist administrator resource-zone class overrides by map cell.

Revision ID: 20260915_30
Revises: 20260915_29
Create Date: 2026-09-15 12:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "20260915_30"
down_revision = "20260915_29"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "resource_cell_overrides",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("system_id", sa.Uuid(), nullable=False),
        sa.Column("cell_x", sa.Integer(), nullable=False),
        sa.Column("cell_z", sa.Integer(), nullable=False),
        sa.Column("zone_class", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["system_id"], ["solar_systems.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("system_id", "cell_x", "cell_z", name="uq_resource_cell_override"),
    )
    op.create_index("ix_resource_cell_overrides_system_id", "resource_cell_overrides", ["system_id"])


def downgrade() -> None:
    op.drop_index("ix_resource_cell_overrides_system_id", table_name="resource_cell_overrides")
    op.drop_table("resource_cell_overrides")