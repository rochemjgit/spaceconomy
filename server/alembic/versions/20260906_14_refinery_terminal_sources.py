"""Allow refinery jobs to release consumed source records.

Revision ID: 20260906_14
Revises: 20260906_13
Create Date: 2026-09-06 09:15:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260906_14"
down_revision: str | Sequence[str] | None = "20260906_13"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SOURCE_CONSTRAINT = (
    "(state IN ('queued', 'processing') AND "
    "((source_ore_lot_id IS NOT NULL AND source_inventory_item_id IS NULL AND stage = 'crush') "
    "OR (source_ore_lot_id IS NULL AND source_inventory_item_id IS NOT NULL AND stage = 'purify'))) "
    "OR state IN ('completed', 'cancelled', 'failed')"
)


def upgrade() -> None:
    """Permit terminal jobs to clear a source reference after consumption."""
    op.drop_constraint("refinery_job_source_valid", "refinery_jobs", type_="check")
    op.create_check_constraint("refinery_job_source_valid", "refinery_jobs", SOURCE_CONSTRAINT)


def downgrade() -> None:
    """Restore the original active-source constraint."""
    op.drop_constraint("refinery_job_source_valid", "refinery_jobs", type_="check")
    op.create_check_constraint(
        "refinery_job_source_valid",
        "refinery_jobs",
        "(source_ore_lot_id IS NOT NULL AND source_inventory_item_id IS NULL AND stage = 'crush') "
        "OR (source_ore_lot_id IS NULL AND source_inventory_item_id IS NOT NULL AND stage = 'purify')",
    )
