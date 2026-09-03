"""Create initial identity and fitting catalog tables.

Revision ID: 20260902_01
Revises:
Create Date: 2026-09-02 00:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260902_01"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create authentication and catalog persistence tables."""
    op.create_table(
        "accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('active', 'suspended', 'deleted')", name="account_status_valid"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_accounts_email", "accounts", ["email"], unique=False)
    op.create_table(
        "hull_definitions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("definition_id", sa.String(length=128), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("universal_hardpoint_count", sa.Integer(), nullable=False),
        sa.Column("core_system_slot_count", sa.Integer(), nullable=False),
        sa.Column("base_statistics", sa.Text(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("universal_hardpoint_count >= 0", name="hull_hardpoint_count_valid"),
        sa.CheckConstraint("core_system_slot_count >= 0", name="hull_core_slot_count_valid"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("definition_id", "version"),
    )
    op.create_table(
        "module_definitions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("definition_id", sa.String(length=128), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("family", sa.String(length=64), nullable=False),
        sa.Column("fit_location", sa.String(length=32), nullable=False),
        sa.Column("cpu_demand", sa.Float(), nullable=False),
        sa.Column("powergrid_demand", sa.Float(), nullable=False),
        sa.Column("durability_maximum", sa.Float(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("cpu_demand >= 0", name="module_cpu_demand_valid"),
        sa.CheckConstraint("powergrid_demand >= 0", name="module_powergrid_demand_valid"),
        sa.CheckConstraint("durability_maximum > 0", name="module_durability_valid"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("definition_id", "version"),
    )
    op.create_table(
        "pilots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("display_name", sa.String(length=32), nullable=False),
        sa.Column("home_station_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id"),
        sa.UniqueConstraint("display_name"),
    )
    op.create_table(
        "refresh_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "ix_refresh_sessions_account_id", "refresh_sessions", ["account_id"], unique=False
    )
    op.create_table(
        "module_effects",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("module_definition_id", sa.Uuid(), nullable=False),
        sa.Column("effect_index", sa.Integer(), nullable=False),
        sa.Column("statistic", sa.String(length=128), nullable=False),
        sa.Column("operation", sa.String(length=16), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["module_definition_id"], ["module_definitions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("module_definition_id", "effect_index"),
    )


def downgrade() -> None:
    """Remove the initial identity and catalog persistence tables."""
    op.drop_table("module_effects")
    op.drop_index("ix_refresh_sessions_account_id", table_name="refresh_sessions")
    op.drop_table("refresh_sessions")
    op.drop_table("pilots")
    op.drop_table("module_definitions")
    op.drop_table("hull_definitions")
    op.drop_index("ix_accounts_email", table_name="accounts")
    op.drop_table("accounts")
