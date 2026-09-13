"""Persist NPC mining extraction cadence.

Revision ID: 20260912_23
Revises: 20260912_22
"""

import sqlalchemy as sa

from alembic import op

revision = "20260912_23"
down_revision = "20260912_22"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("npc_runtimes", sa.Column("mining_next_cycle_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("npc_runtimes", "mining_next_cycle_at")