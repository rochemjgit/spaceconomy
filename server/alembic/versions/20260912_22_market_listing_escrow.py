"""Move active listing inventory into market escrow.

Revision ID: 20260912_22
Revises: 20260912_21
"""

import sqlalchemy as sa

from alembic import op

revision = "20260912_22"
down_revision = "20260912_21"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE inventory_items SET container_id = NULL "
            "WHERE id IN ("
            "SELECT inventory_item_id FROM market_listings WHERE state = 'active'"
            ")"
        )
    )


def downgrade() -> None:
    # Escrow inventory must return through its listing lifecycle, not a lossy bulk downgrade.
    pass