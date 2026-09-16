"""Add lifecycle expiry to dynamic asteroid fields.

Revision ID: 20260914_36
Revises: 20260913_35
Create Date: 2026-09-14 00:00:00
"""

import sqlalchemy as sa
from alembic import op

revision = "20260914_36"
down_revision = "20260913_35"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("asteroid_fields", sa.Column("expires_at", sa.DateTime(timezone=True)))
    op.create_index("ix_asteroid_fields_expires_at", "asteroid_fields", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_asteroid_fields_expires_at", table_name="asteroid_fields")
    op.drop_column("asteroid_fields", "expires_at")