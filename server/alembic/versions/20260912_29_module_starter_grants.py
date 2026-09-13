"""Mark whether an active module is granted to a new pilot.

Revision ID: 20260912_29
Revises: 20260912_27
Create Date: 2026-09-12 12:45:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260912_29"
down_revision: str | Sequence[str] | None = "20260912_27"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Default existing catalog modules to starter grants."""
    op.add_column(
        "module_definitions",
        sa.Column("starter_grant", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    """Remove the catalog starter entitlement flag."""
    op.drop_column("module_definitions", "starter_grant")