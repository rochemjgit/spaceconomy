"""Persist NPC profile and runtime state.

Revision ID: 20260912_15
Revises: 20260907_13
"""

import sqlalchemy as sa

from alembic import op

revision = "20260912_15"
down_revision = "20260907_13"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "npc_profiles",
        sa.Column("pilot_id", sa.Uuid(), sa.ForeignKey("pilots.id"), primary_key=True),
        sa.Column("archetype_key", sa.String(64), nullable=False),
        sa.Column("backstory", sa.Text(), nullable=False),
        sa.Column("motivations", sa.Text(), nullable=False),
        sa.Column("capabilities", sa.Text(), nullable=False),
        sa.Column("lifecycle_state", sa.String(16), nullable=False, server_default="active"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "lifecycle_state IN ('active', 'paused', 'retired')",
            name="npc_profile_lifecycle_state_valid",
        ),
    )
    op.create_table(
        "npc_runtimes",
        sa.Column("pilot_id", sa.Uuid(), sa.ForeignKey("pilots.id"), primary_key=True),
        sa.Column("behavior_state", sa.Text(), nullable=False, server_default="idle"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )


def downgrade() -> None:
    op.drop_table("npc_runtimes")
    op.drop_table("npc_profiles")