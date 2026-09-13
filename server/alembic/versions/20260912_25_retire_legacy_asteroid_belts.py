"""Retire static asteroid fields superseded by procedural exploration.

Revision ID: 20260912_25
Revises: 20260912_24
Create Date: 2026-09-12 01:00:00
"""

from alembic import op

revision = "20260912_25"
down_revision = "20260912_24"
branch_labels = None
depends_on = None

LEGACY_FIELD_KEYS = ("asterion", "vesper", "nadir", "kepler_test")


def upgrade() -> None:
    op.execute(
        "UPDATE asteroid_fields SET active = FALSE, next_spawn_at = NULL "
        "WHERE field_key IN ('asterion', 'vesper', 'nadir', 'kepler_test')"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE asteroid_fields SET active = TRUE "
        "WHERE field_key IN ('asterion', 'vesper', 'nadir', 'kepler_test')"
    )