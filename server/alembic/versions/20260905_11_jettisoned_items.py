"""Add public expiring in-space jettisoned item stacks.

Revision ID: 20260905_11
Revises: 20260905_10
Create Date: 2026-09-05 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260905_11"
down_revision: str | Sequence[str] | None = "20260905_10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create durable public cargo snapshots with expiry lookup support."""
    op.create_table(
        "jettisoned_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("definition_id", sa.String(length=128), nullable=False),
        sa.Column("definition_version", sa.Integer(), nullable=False),
        sa.Column("module_definition_id", sa.Uuid(), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("durability", sa.Float(), nullable=False),
        sa.Column("volume_per_unit", sa.Float(), nullable=False),
        sa.Column("position_x", sa.Float(), nullable=False),
        sa.Column("position_y", sa.Float(), nullable=False),
        sa.Column("position_z", sa.Float(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("quantity > 0", name="jettisoned_item_quantity_valid"),
        sa.CheckConstraint("volume_per_unit >= 0", name="jettisoned_item_volume_valid"),
        sa.ForeignKeyConstraint(["module_definition_id"], ["module_definitions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_jettisoned_items_expires_at", "jettisoned_items", ["expires_at"])


def downgrade() -> None:
    """Remove public jettisoned item snapshots."""
    op.drop_index("ix_jettisoned_items_expires_at", table_name="jettisoned_items")
    op.drop_table("jettisoned_items")