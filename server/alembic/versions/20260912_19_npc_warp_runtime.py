"""Persist server-authoritative NPC warp transit state.

Revision ID: 20260912_19
Revises: 20260912_18
"""

import sqlalchemy as sa

from alembic import op

revision = "20260912_19"
down_revision = "20260912_18"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("npc_runtimes", sa.Column("warp_phase", sa.String(32)))
    op.add_column(
        "npc_runtimes",
        sa.Column("warp_capacity", sa.Float(), nullable=False, server_default="100"),
    )
    op.add_column("npc_runtimes", sa.Column("warp_phase_started_at", sa.DateTime(timezone=True)))
    op.add_column("npc_runtimes", sa.Column("warp_destination_x", sa.Float()))
    op.add_column("npc_runtimes", sa.Column("warp_destination_y", sa.Float()))
    op.add_column("npc_runtimes", sa.Column("warp_destination_z", sa.Float()))


def downgrade() -> None:
    op.drop_column("npc_runtimes", "warp_destination_z")
    op.drop_column("npc_runtimes", "warp_destination_y")
    op.drop_column("npc_runtimes", "warp_destination_x")
    op.drop_column("npc_runtimes", "warp_phase_started_at")
    op.drop_column("npc_runtimes", "warp_capacity")
    op.drop_column("npc_runtimes", "warp_phase")