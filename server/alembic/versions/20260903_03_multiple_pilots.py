"""Allow accounts to own multiple pilots.

Revision ID: 20260903_03
Revises: 20260902_02
Create Date: 2026-09-03 00:00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260903_03"
down_revision: str | Sequence[str] | None = "20260902_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Remove the one-pilot-per-account uniqueness constraint."""
    op.drop_constraint("pilots_account_id_key", "pilots", type_="unique")
    op.create_index("ix_pilots_account_id", "pilots", ["account_id"], unique=False)


def downgrade() -> None:
    """Restore the initial one-pilot-per-account rule."""
    op.drop_index("ix_pilots_account_id", table_name="pilots")
    op.create_unique_constraint("pilots_account_id_key", "pilots", ["account_id"])