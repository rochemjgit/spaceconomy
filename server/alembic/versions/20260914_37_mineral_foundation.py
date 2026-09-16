"""Add mineral roles and visual metadata; retire the superseded resource roster."""

import sqlalchemy as sa
from alembic import op

revision = "20260914_37"
down_revision = "20260914_36"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("mineral_definitions", sa.Column("industrial_role", sa.String(256), nullable=False, server_default=""))
    op.add_column("mineral_definitions", sa.Column("visual_family", sa.String(16), nullable=False, server_default="rocky"))
    op.add_column("mineral_definitions", sa.Column("display_color", sa.String(7), nullable=False, server_default="#888888"))
    minerals = sa.table("mineral_definitions", sa.column("definition_id", sa.String()), sa.column("active", sa.Boolean()))
    op.execute(minerals.update().where(minerals.c.definition_id.in_(
        ("magnesium", "chromium", "manganese", "platinum_group", "aetherium", "gravimetric_crystal", "nullite")
    )).values(active=False))


def downgrade() -> None:
    op.drop_column("mineral_definitions", "display_color")
    op.drop_column("mineral_definitions", "visual_family")
    op.drop_column("mineral_definitions", "industrial_role")