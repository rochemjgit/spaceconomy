"""Add station refinery services and durable queued jobs.

Revision ID: 20260906_13
Revises: 20260905_12
Create Date: 2026-09-06 09:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260906_13"
down_revision: str | Sequence[str] | None = "20260905_12"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create durable station refinery configuration and queued job records."""
    op.create_table(
        "refinery_services",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("station_id", sa.Uuid(), nullable=False),
        sa.Column("service_key", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("first_pass_seconds_per_cubic_meter", sa.Float(), nullable=False),
        sa.Column("second_pass_seconds_per_cubic_meter", sa.Float(), nullable=False),
        sa.Column("first_pass_efficiency", sa.Float(), nullable=False),
        sa.Column("second_pass_efficiency", sa.Float(), nullable=False),
        sa.Column("fee_credits", sa.Float(), nullable=False),
        sa.Column("active_job_capacity", sa.Integer(), nullable=False),
        sa.Column("queue_capacity", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "first_pass_seconds_per_cubic_meter > 0", name="refinery_first_pass_rate_valid"
        ),
        sa.CheckConstraint(
            "second_pass_seconds_per_cubic_meter > 0", name="refinery_second_pass_rate_valid"
        ),
        sa.CheckConstraint(
            "first_pass_efficiency >= 0 AND first_pass_efficiency <= 1",
            name="refinery_first_pass_efficiency_valid",
        ),
        sa.CheckConstraint(
            "second_pass_efficiency >= 0 AND second_pass_efficiency <= 1",
            name="refinery_second_pass_efficiency_valid",
        ),
        sa.CheckConstraint("fee_credits >= 0", name="refinery_fee_valid"),
        sa.CheckConstraint("active_job_capacity > 0", name="refinery_active_capacity_valid"),
        sa.CheckConstraint("queue_capacity > 0", name="refinery_queue_capacity_valid"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("station_id", "service_key", name="uq_refinery_service_station_key"),
    )
    op.create_index("ix_refinery_services_station_id", "refinery_services", ["station_id"])
    op.create_table(
        "refinery_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("pilot_id", sa.Uuid(), nullable=False),
        sa.Column("refinery_service_id", sa.Uuid(), nullable=False),
        sa.Column("source_ore_lot_id", sa.Uuid(), nullable=True),
        sa.Column("source_inventory_item_id", sa.Uuid(), nullable=True),
        sa.Column("stage", sa.String(length=16), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("queue_sequence", sa.Integer(), nullable=False),
        sa.Column("quoted_duration_seconds", sa.Float(), nullable=False),
        sa.Column("quoted_efficiency", sa.Float(), nullable=False),
        sa.Column("quoted_fee_credits", sa.Float(), nullable=False),
        sa.Column("expected_outputs", sa.Text(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completes_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_reason", sa.String(length=256), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("stage IN ('crush', 'purify')", name="refinery_job_stage_valid"),
        sa.CheckConstraint(
            "state IN ('queued', 'processing', 'completed', 'cancelled', 'failed')",
            name="refinery_job_state_valid",
        ),
        sa.CheckConstraint("queue_sequence >= 0", name="refinery_job_sequence_valid"),
        sa.CheckConstraint("quoted_duration_seconds > 0", name="refinery_job_duration_valid"),
        sa.CheckConstraint(
            "quoted_efficiency >= 0 AND quoted_efficiency <= 1",
            name="refinery_job_efficiency_valid",
        ),
        sa.CheckConstraint("quoted_fee_credits >= 0", name="refinery_job_fee_valid"),
        sa.CheckConstraint(
            "(source_ore_lot_id IS NOT NULL AND source_inventory_item_id IS NULL AND stage = 'crush') "
            "OR (source_ore_lot_id IS NULL AND source_inventory_item_id IS NOT NULL AND stage = 'purify')",
            name="refinery_job_source_valid",
        ),
        sa.ForeignKeyConstraint(["pilot_id"], ["pilots.id"]),
        sa.ForeignKeyConstraint(["refinery_service_id"], ["refinery_services.id"]),
        sa.ForeignKeyConstraint(["source_ore_lot_id"], ["mined_ore_lots.id"]),
        sa.ForeignKeyConstraint(["source_inventory_item_id"], ["inventory_items.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "pilot_id", "idempotency_key", name="uq_refinery_job_pilot_idempotency"
        ),
        sa.UniqueConstraint("source_ore_lot_id"),
        sa.UniqueConstraint("source_inventory_item_id"),
    )
    op.create_index("ix_refinery_jobs_pilot_id", "refinery_jobs", ["pilot_id"])
    op.create_index(
        "ix_refinery_jobs_refinery_service_id", "refinery_jobs", ["refinery_service_id"]
    )
    op.create_index("ix_refinery_jobs_state", "refinery_jobs", ["state"])
    op.create_index("ix_refinery_jobs_completes_at", "refinery_jobs", ["completes_at"])


def downgrade() -> None:
    """Remove refinery tables before their dependent station configuration."""
    op.drop_index("ix_refinery_jobs_completes_at", table_name="refinery_jobs")
    op.drop_index("ix_refinery_jobs_state", table_name="refinery_jobs")
    op.drop_index("ix_refinery_jobs_refinery_service_id", table_name="refinery_jobs")
    op.drop_index("ix_refinery_jobs_pilot_id", table_name="refinery_jobs")
    op.drop_table("refinery_jobs")
    op.drop_index("ix_refinery_services_station_id", table_name="refinery_services")
    op.drop_table("refinery_services")
