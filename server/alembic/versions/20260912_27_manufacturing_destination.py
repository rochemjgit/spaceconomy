"""Persist the station container that receives a manufactured output.

Revision ID: 20260912_27
Revises: 20260912_26
Create Date: 2026-09-12 12:15:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260912_27"
down_revision: str | Sequence[str] | None = "20260912_26"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Require a durable output container for every manufacturing job."""
    op.add_column(
        "manufacturing_jobs",
        sa.Column("destination_container_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_manufacturing_jobs_destination_container_id",
        "manufacturing_jobs",
        "inventory_containers",
        ["destination_container_id"],
        ["id"],
    )
    op.alter_column("manufacturing_jobs", "destination_container_id", nullable=False)


def downgrade() -> None:
    """Remove the manufacturing output destination."""
    op.drop_constraint(
        "fk_manufacturing_jobs_destination_container_id",
        "manufacturing_jobs",
        type_="foreignkey",
    )
    op.drop_column("manufacturing_jobs", "destination_container_id")