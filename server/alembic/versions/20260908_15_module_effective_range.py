"""Add effective range to module definitions.

Revision ID: 20260908_15
Revises: 20260907_13
Create Date: 2026-09-08 09:00:00
"""

import sqlalchemy as sa

from alembic import op

revision = "20260908_15"
down_revision = "20260907_13"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "module_definitions",
        sa.Column("effective_range_meters", sa.Float(), nullable=False, server_default=sa.text("0")),
    )
    op.execute(
        "UPDATE module_definitions SET effective_range_meters = 500 "
        "WHERE definition_id = 'module.mining_laser.m1' AND version = 1"
    )
    op.create_check_constraint(
        "module_definition_effective_range_valid",
        "module_definitions",
        "effective_range_meters >= 0",
    )
    op.alter_column("module_definitions", "effective_range_meters", server_default=None)


def downgrade() -> None:
    op.drop_constraint(
        "module_definition_effective_range_valid",
        "module_definitions",
        type_="check",
    )
    op.drop_column("module_definitions", "effective_range_meters")