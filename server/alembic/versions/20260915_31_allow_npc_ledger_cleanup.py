"""Permit transaction-scoped NPC ledger cleanup.

Revision ID: 20260915_31
Revises: 20260915_30
Create Date: 2026-09-15 12:30:00
"""

from alembic import op

revision = "20260915_31"
down_revision = "20260915_30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE OR REPLACE FUNCTION reject_wallet_transaction_mutation() RETURNS trigger AS $$ "
        "BEGIN "
        "IF current_setting('spaceconomy.allow_wallet_transaction_delete', true) = 'on' THEN "
        "IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; "
        "RETURN NEW; "
        "END IF; "
        "RAISE EXCEPTION 'wallet transactions are immutable'; "
        "END; $$ LANGUAGE plpgsql"
    )


def downgrade() -> None:
    op.execute(
        "CREATE OR REPLACE FUNCTION reject_wallet_transaction_mutation() RETURNS trigger AS $$ "
        "BEGIN RAISE EXCEPTION 'wallet transactions are immutable'; END; $$ LANGUAGE plpgsql"
    )