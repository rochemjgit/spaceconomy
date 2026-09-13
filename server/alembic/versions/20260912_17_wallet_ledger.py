"""Harden wallet settlement and ledger integrity.

Revision ID: 20260912_17
Revises: 20260912_16
"""

import sqlalchemy as sa

from alembic import op

revision = "20260912_17"
down_revision = "20260912_16"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("market_listings", sa.Column("command_id", sa.String(128), nullable=True))
    op.execute("UPDATE market_listings SET command_id = 'legacy:' || id::text")
    op.alter_column("market_listings", "command_id", nullable=False)
    op.create_unique_constraint(
        "uq_market_listing_seller_command", "market_listings", ["seller_pilot_id", "command_id"]
    )

    op.add_column("wallet_transactions", sa.Column("command_id", sa.String(128), nullable=True))
    op.add_column("wallet_transactions", sa.Column("settlement_id", sa.Uuid(), nullable=True))
    op.execute(
        "UPDATE wallet_transactions "
        "SET command_id = 'legacy:' || id::text, settlement_id = id"
    )
    op.alter_column("wallet_transactions", "command_id", nullable=False)
    op.alter_column("wallet_transactions", "settlement_id", nullable=False)
    op.alter_column("wallet_transactions", "counterparty_pilot_id", nullable=True)
    op.alter_column("wallet_transactions", "market_listing_id", nullable=True)
    op.drop_constraint("wallet_transaction_kind_valid", "wallet_transactions", type_="check")
    op.create_check_constraint(
        "wallet_transaction_kind_valid",
        "wallet_transactions",
        "transaction_kind IN ('initial_grant', 'market_purchase', 'market_sale', 'refinery_fee')",
    )
    op.create_unique_constraint(
        "uq_wallet_transaction_pilot_command", "wallet_transactions", ["pilot_id", "command_id"]
    )

    op.alter_column(
        "refinery_services",
        "fee_credits",
        existing_type=sa.Float(),
        type_=sa.BigInteger(),
        postgresql_using="ROUND(fee_credits)::BIGINT",
    )
    op.alter_column(
        "refinery_jobs",
        "quoted_fee_credits",
        existing_type=sa.Float(),
        type_=sa.BigInteger(),
        postgresql_using="ROUND(quoted_fee_credits)::BIGINT",
    )

    op.execute(
        "INSERT INTO pilot_wallets (pilot_id, balance_credits, created_at, updated_at) "
        "SELECT id, 10000, NOW(), NOW() FROM pilots "
        "ON CONFLICT (pilot_id) DO NOTHING"
    )
    op.execute(
        "INSERT INTO wallet_transactions "
        "(id, pilot_id, counterparty_pilot_id, amount_credits, transaction_kind, command_id, "
        "settlement_id, created_at, updated_at) "
        "SELECT (substr(md5('initial-grant:' || pilot_id::text), 1, 8) || '-' || "
        "substr(md5('initial-grant:' || pilot_id::text), 9, 4) || '-' || "
        "substr(md5('initial-grant:' || pilot_id::text), 13, 4) || '-' || "
        "substr(md5('initial-grant:' || pilot_id::text), 17, 4) || '-' || "
        "substr(md5('initial-grant:' || pilot_id::text), 21, 12))::uuid, "
        "pilot_id, NULL, balance_credits, 'initial_grant', 'initial-grant:' || pilot_id::text, "
        "pilot_id, NOW(), NOW() "
        "FROM pilot_wallets "
        "ON CONFLICT (pilot_id, command_id) DO NOTHING"
    )
    op.execute(
        "CREATE FUNCTION reject_wallet_transaction_mutation() RETURNS trigger AS $$ "
        "BEGIN RAISE EXCEPTION 'wallet transactions are immutable'; END; $$ LANGUAGE plpgsql"
    )
    op.execute(
        "CREATE TRIGGER wallet_transactions_no_update BEFORE UPDATE ON wallet_transactions "
        "FOR EACH ROW EXECUTE FUNCTION reject_wallet_transaction_mutation()"
    )
    op.execute(
        "CREATE TRIGGER wallet_transactions_no_delete BEFORE DELETE ON wallet_transactions "
        "FOR EACH ROW EXECUTE FUNCTION reject_wallet_transaction_mutation()"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER wallet_transactions_no_delete ON wallet_transactions")
    op.execute("DROP TRIGGER wallet_transactions_no_update ON wallet_transactions")
    op.execute("DROP FUNCTION reject_wallet_transaction_mutation()")
    op.alter_column(
        "refinery_jobs",
        "quoted_fee_credits",
        existing_type=sa.BigInteger(),
        type_=sa.Float(),
        postgresql_using="quoted_fee_credits::DOUBLE PRECISION",
    )
    op.alter_column(
        "refinery_services",
        "fee_credits",
        existing_type=sa.BigInteger(),
        type_=sa.Float(),
        postgresql_using="fee_credits::DOUBLE PRECISION",
    )
    op.drop_constraint("uq_wallet_transaction_pilot_command", "wallet_transactions", type_="unique")
    op.drop_constraint("wallet_transaction_kind_valid", "wallet_transactions", type_="check")
    op.create_check_constraint(
        "wallet_transaction_kind_valid",
        "wallet_transactions",
        "transaction_kind IN ('market_purchase', 'market_sale')",
    )
    op.alter_column("wallet_transactions", "market_listing_id", nullable=False)
    op.alter_column("wallet_transactions", "counterparty_pilot_id", nullable=False)
    op.drop_column("wallet_transactions", "settlement_id")
    op.drop_column("wallet_transactions", "command_id")
    op.drop_constraint("uq_market_listing_seller_command", "market_listings", type_="unique")
    op.drop_column("market_listings", "command_id")