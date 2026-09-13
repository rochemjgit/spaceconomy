"""Persist per-NPC navigation decisions.

Revision ID: 20260912_16
Revises: 20260912_15
"""

import sqlalchemy as sa

from alembic import op

revision = "20260912_16"
down_revision = "20260912_15"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "npc_runtimes",
        sa.Column("decision_source", sa.String(32), nullable=False, server_default="deterministic"),
    )
    op.add_column("npc_runtimes", sa.Column("target_x", sa.Float()))
    op.add_column("npc_runtimes", sa.Column("target_y", sa.Float()))
    op.add_column("npc_runtimes", sa.Column("target_z", sa.Float()))
    op.add_column("npc_runtimes", sa.Column("decision_due_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("npc_runtimes", "decision_due_at")
    op.drop_column("npc_runtimes", "target_z")
    op.drop_column("npc_runtimes", "target_y")
    op.drop_column("npc_runtimes", "target_x")
    op.drop_column("npc_runtimes", "decision_source")