"""Add account enrollment and email activation state.

Revision ID: 20260903_04
Revises: 20260903_03
Create Date: 2026-09-03 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260903_04"
down_revision: str | Sequence[str] | None = "20260903_03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add names, pending account support, and one-time activation tokens."""
    op.add_column(
        "accounts", sa.Column("first_name", sa.String(length=128), server_default="", nullable=False)
    )
    op.add_column(
        "accounts", sa.Column("last_name", sa.String(length=128), server_default="", nullable=False)
    )
    op.alter_column("accounts", "first_name", server_default=None)
    op.alter_column("accounts", "last_name", server_default=None)
    op.drop_constraint("account_status_valid", "accounts", type_="check")
    op.create_check_constraint(
        "account_status_valid", "accounts", "status IN ('pending', 'active', 'suspended', 'deleted')"
    )
    op.create_table(
        "account_activations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_account_activations_account_id", "account_activations", ["account_id"])


def downgrade() -> None:
    """Remove enrollment additions."""
    op.drop_index("ix_account_activations_account_id", table_name="account_activations")
    op.drop_table("account_activations")
    op.drop_constraint("account_status_valid", "accounts", type_="check")
    op.create_check_constraint(
        "account_status_valid", "accounts", "status IN ('active', 'suspended', 'deleted')"
    )
    op.drop_column("accounts", "last_name")
    op.drop_column("accounts", "first_name")