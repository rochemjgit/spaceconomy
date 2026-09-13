"""Persist NPC asteroid target lock state.

Revision ID: 20260912_20
Revises: 20260912_19
"""

import sqlalchemy as sa

from alembic import op

revision = "20260912_20"
down_revision = "20260912_19"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("npc_runtimes", sa.Column("mining_target_asteroid_id", sa.Uuid()))
    op.add_column("npc_runtimes", sa.Column("mining_lock_started_at", sa.DateTime(timezone=True)))
    op.add_column("npc_runtimes", sa.Column("mining_locked_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("npc_runtimes", "mining_locked_at")
    op.drop_column("npc_runtimes", "mining_lock_started_at")
    op.drop_column("npc_runtimes", "mining_target_asteroid_id")