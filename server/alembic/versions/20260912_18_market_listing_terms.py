"""Add duration, expiration, and fee terms to market listings.

Revision ID: 20260912_18
Revises: 20260912_17
"""

import sqlalchemy as sa

from alembic import op

revision = "20260912_18"
down_revision = "20260912_17"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("market_listings", sa.Column("duration_days", sa.Integer(), nullable=True))
    op.add_column("market_listings", sa.Column("listing_fee_credits", sa.BigInteger(), nullable=True))
    op.add_column("market_listings", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(
        "UPDATE market_listings SET duration_days = 1, listing_fee_credits = 0, "
        "expires_at = created_at + INTERVAL '1 day'"
    )
    op.alter_column("market_listings", "duration_days", nullable=False)
    op.alter_column("market_listings", "listing_fee_credits", nullable=False)
    op.alter_column("market_listings", "expires_at", nullable=False)
    op.create_index("ix_market_listings_expires_at", "market_listings", ["expires_at"])
    op.create_check_constraint(
        "market_listing_duration_valid", "market_listings", "duration_days IN (1, 7, 30)"
    )
    op.drop_constraint("market_listing_state_valid", "market_listings", type_="check")
    op.create_check_constraint(
        "market_listing_state_valid",
        "market_listings",
        "state IN ('active', 'sold', 'cancelled', 'expired')",
    )
    op.drop_constraint("wallet_transaction_kind_valid", "wallet_transactions", type_="check")
    op.create_check_constraint(
        "wallet_transaction_kind_valid",
        "wallet_transactions",
        "transaction_kind IN ('initial_grant', 'market_purchase', 'market_sale', 'refinery_fee', "
        "'market_listing_fee', 'market_purchase_commission')",
    )


def downgrade() -> None:
    op.drop_constraint("wallet_transaction_kind_valid", "wallet_transactions", type_="check")
    op.create_check_constraint(
        "wallet_transaction_kind_valid",
        "wallet_transactions",
        "transaction_kind IN ('initial_grant', 'market_purchase', 'market_sale', 'refinery_fee')",
    )
    op.drop_constraint("market_listing_state_valid", "market_listings", type_="check")
    op.create_check_constraint(
        "market_listing_state_valid", "market_listings", "state IN ('active', 'sold', 'cancelled')"
    )
    op.drop_constraint("market_listing_duration_valid", "market_listings", type_="check")
    op.drop_index("ix_market_listings_expires_at", table_name="market_listings")
    op.drop_column("market_listings", "expires_at")
    op.drop_column("market_listings", "listing_fee_credits")
    op.drop_column("market_listings", "duration_days")