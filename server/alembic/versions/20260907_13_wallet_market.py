"""Wallets and station market listings.

Revision ID: 20260907_13
Revises: 20260906_14
"""

import sqlalchemy as sa

from alembic import op

revision = "20260907_13"
down_revision = "20260906_14"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pilot_wallets",
        sa.Column("pilot_id", sa.Uuid(), sa.ForeignKey("pilots.id"), primary_key=True),
        sa.Column("balance_credits", sa.BigInteger(), nullable=False, server_default="10000"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("balance_credits >= 0", name="wallet_balance_valid"),
    )
    op.create_table(
        "market_listings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("station_id", sa.Uuid(), nullable=False),
        sa.Column("seller_pilot_id", sa.Uuid(), sa.ForeignKey("pilots.id"), nullable=False),
        sa.Column(
            "inventory_item_id",
            sa.Uuid(),
            sa.ForeignKey("inventory_items.id"),
            nullable=False,
            unique=True,
        ),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit_price_credits", sa.BigInteger(), nullable=False),
        sa.Column("state", sa.String(16), nullable=False, server_default="active"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("quantity > 0", name="market_listing_quantity_valid"),
        sa.CheckConstraint("unit_price_credits > 0", name="market_listing_price_valid"),
        sa.CheckConstraint(
            "state IN ('active', 'sold', 'cancelled')", name="market_listing_state_valid"
        ),
    )
    op.create_index("ix_market_listings_station_id", "market_listings", ["station_id"])
    op.create_index("ix_market_listings_seller_pilot_id", "market_listings", ["seller_pilot_id"])
    op.create_table(
        "wallet_transactions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("pilot_id", sa.Uuid(), sa.ForeignKey("pilots.id"), nullable=False),
        sa.Column("counterparty_pilot_id", sa.Uuid(), sa.ForeignKey("pilots.id"), nullable=False),
        sa.Column("amount_credits", sa.BigInteger(), nullable=False),
        sa.Column("transaction_kind", sa.String(32), nullable=False),
        sa.Column("market_listing_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("amount_credits <> 0", name="wallet_transaction_amount_valid"),
        sa.CheckConstraint(
            "transaction_kind IN ('market_purchase', 'market_sale')",
            name="wallet_transaction_kind_valid",
        ),
    )
    op.create_index("ix_wallet_transactions_pilot_id", "wallet_transactions", ["pilot_id"])
    op.create_index(
        "ix_wallet_transactions_market_listing_id",
        "wallet_transactions",
        ["market_listing_id"],
    )


def downgrade() -> None:
    op.drop_table("wallet_transactions")
    op.drop_table("market_listings")
    op.drop_table("pilot_wallets")