"""Add durable manufacturing recipes, reservations, jobs, and item ledger entries.

Revision ID: 20260912_26
Revises: 20260912_25
Create Date: 2026-09-12 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260912_26"
down_revision: str | Sequence[str] | None = "20260912_25"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the durable data model for station manufacturing."""
    op.create_table(
        "manufacturing_services",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("station_id", sa.Uuid(), nullable=False),
        sa.Column("service_key", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("seconds_per_run", sa.Float(), nullable=False),
        sa.Column("fee_credits", sa.BigInteger(), nullable=False),
        sa.Column("active_job_capacity", sa.Integer(), nullable=False),
        sa.Column("queue_capacity", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("seconds_per_run > 0", name="manufacturing_service_duration_valid"),
        sa.CheckConstraint("fee_credits >= 0", name="manufacturing_service_fee_valid"),
        sa.CheckConstraint("active_job_capacity > 0", name="manufacturing_service_active_capacity_valid"),
        sa.CheckConstraint("queue_capacity > 0", name="manufacturing_service_queue_capacity_valid"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("station_id", "service_key", name="uq_manufacturing_service_station_key"),
    )
    op.create_index("ix_manufacturing_services_station_id", "manufacturing_services", ["station_id"])
    op.create_table(
        "manufacturing_recipes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("recipe_id", sa.String(length=128), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("service_key", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("output_module_definition_id", sa.Uuid(), nullable=False),
        sa.Column("output_quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("output_quantity > 0", name="manufacturing_recipe_output_quantity_valid"),
        sa.ForeignKeyConstraint(["output_module_definition_id"], ["module_definitions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("recipe_id", "version", name="uq_manufacturing_recipe_version"),
    )
    op.create_table(
        "manufacturing_recipe_inputs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("manufacturing_recipe_id", sa.Uuid(), nullable=False),
        sa.Column("input_index", sa.Integer(), nullable=False),
        sa.Column("definition_id", sa.String(length=128), nullable=False),
        sa.Column("definition_version", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("input_index >= 0", name="manufacturing_recipe_input_index_valid"),
        sa.CheckConstraint("quantity > 0", name="manufacturing_recipe_input_quantity_valid"),
        sa.ForeignKeyConstraint(["manufacturing_recipe_id"], ["manufacturing_recipes.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("manufacturing_recipe_id", "input_index"),
    )
    op.create_index("ix_manufacturing_recipe_inputs_manufacturing_recipe_id", "manufacturing_recipe_inputs", ["manufacturing_recipe_id"])
    op.create_table(
        "manufacturing_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("pilot_id", sa.Uuid(), nullable=False),
        sa.Column("manufacturing_service_id", sa.Uuid(), nullable=False),
        sa.Column("manufacturing_recipe_id", sa.Uuid(), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("queue_sequence", sa.Integer(), nullable=False),
        sa.Column("quoted_duration_seconds", sa.Float(), nullable=False),
        sa.Column("quoted_fee_credits", sa.BigInteger(), nullable=False),
        sa.Column("expected_output", sa.Text(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completes_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_reason", sa.String(length=256), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("state IN ('queued', 'processing', 'completed', 'cancelled', 'failed')", name="manufacturing_job_state_valid"),
        sa.CheckConstraint("queue_sequence >= 0", name="manufacturing_job_sequence_valid"),
        sa.CheckConstraint("quoted_duration_seconds > 0", name="manufacturing_job_duration_valid"),
        sa.CheckConstraint("quoted_fee_credits >= 0", name="manufacturing_job_fee_valid"),
        sa.ForeignKeyConstraint(["pilot_id"], ["pilots.id"]),
        sa.ForeignKeyConstraint(["manufacturing_service_id"], ["manufacturing_services.id"]),
        sa.ForeignKeyConstraint(["manufacturing_recipe_id"], ["manufacturing_recipes.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pilot_id", "idempotency_key", name="uq_manufacturing_job_pilot_idempotency"),
    )
    op.create_index("ix_manufacturing_jobs_pilot_id", "manufacturing_jobs", ["pilot_id"])
    op.create_index("ix_manufacturing_jobs_manufacturing_service_id", "manufacturing_jobs", ["manufacturing_service_id"])
    op.create_index("ix_manufacturing_jobs_state", "manufacturing_jobs", ["state"])
    op.create_index("ix_manufacturing_jobs_completes_at", "manufacturing_jobs", ["completes_at"])
    op.create_table(
        "manufacturing_job_inputs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("manufacturing_job_id", sa.Uuid(), nullable=False),
        sa.Column("inventory_item_id", sa.Uuid(), nullable=True),
        sa.Column("input_index", sa.Integer(), nullable=False),
        sa.Column("definition_id", sa.String(length=128), nullable=False),
        sa.Column("definition_version", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("input_index >= 0", name="manufacturing_job_input_index_valid"),
        sa.CheckConstraint("quantity > 0", name="manufacturing_job_input_quantity_valid"),
        sa.ForeignKeyConstraint(["manufacturing_job_id"], ["manufacturing_jobs.id"]),
        sa.ForeignKeyConstraint(["inventory_item_id"], ["inventory_items.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("manufacturing_job_id", "input_index"),
        sa.UniqueConstraint("inventory_item_id", name="uq_manufacturing_job_input_item"),
    )
    op.create_index("ix_manufacturing_job_inputs_manufacturing_job_id", "manufacturing_job_inputs", ["manufacturing_job_id"])
    op.create_table(
        "inventory_ledger_entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("pilot_id", sa.Uuid(), nullable=False),
        sa.Column("manufacturing_job_id", sa.Uuid(), nullable=True),
        sa.Column("inventory_item_id", sa.Uuid(), nullable=True),
        sa.Column("event_kind", sa.String(length=32), nullable=False),
        sa.Column("definition_id", sa.String(length=128), nullable=False),
        sa.Column("definition_version", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("source_container_id", sa.Uuid(), nullable=True),
        sa.Column("destination_container_id", sa.Uuid(), nullable=True),
        sa.Column("command_id", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("event_kind IN ('manufacturing_reserved', 'manufacturing_completed', 'manufacturing_cancelled')", name="inventory_ledger_event_kind_valid"),
        sa.CheckConstraint("quantity > 0", name="inventory_ledger_quantity_valid"),
        sa.ForeignKeyConstraint(["pilot_id"], ["pilots.id"]),
        sa.ForeignKeyConstraint(["manufacturing_job_id"], ["manufacturing_jobs.id"]),
        sa.ForeignKeyConstraint(["inventory_item_id"], ["inventory_items.id"]),
        sa.ForeignKeyConstraint(["source_container_id"], ["inventory_containers.id"]),
        sa.ForeignKeyConstraint(["destination_container_id"], ["inventory_containers.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_inventory_ledger_entries_pilot_id", "inventory_ledger_entries", ["pilot_id"])
    op.create_index("ix_inventory_ledger_entries_manufacturing_job_id", "inventory_ledger_entries", ["manufacturing_job_id"])


def downgrade() -> None:
    """Remove manufacturing records before their recipe and facility parents."""
    op.drop_index("ix_inventory_ledger_entries_manufacturing_job_id", table_name="inventory_ledger_entries")
    op.drop_index("ix_inventory_ledger_entries_pilot_id", table_name="inventory_ledger_entries")
    op.drop_table("inventory_ledger_entries")
    op.drop_index("ix_manufacturing_job_inputs_manufacturing_job_id", table_name="manufacturing_job_inputs")
    op.drop_table("manufacturing_job_inputs")
    op.drop_index("ix_manufacturing_jobs_completes_at", table_name="manufacturing_jobs")
    op.drop_index("ix_manufacturing_jobs_state", table_name="manufacturing_jobs")
    op.drop_index("ix_manufacturing_jobs_manufacturing_service_id", table_name="manufacturing_jobs")
    op.drop_index("ix_manufacturing_jobs_pilot_id", table_name="manufacturing_jobs")
    op.drop_table("manufacturing_jobs")
    op.drop_index("ix_manufacturing_recipe_inputs_manufacturing_recipe_id", table_name="manufacturing_recipe_inputs")
    op.drop_table("manufacturing_recipe_inputs")
    op.drop_table("manufacturing_recipes")
    op.drop_index("ix_manufacturing_services_station_id", table_name="manufacturing_services")
    op.drop_table("manufacturing_services")