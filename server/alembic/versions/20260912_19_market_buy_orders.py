"""Add station market buy orders.

Revision ID: 20260912_21
Revises: 20260912_20
"""
import sqlalchemy as sa
from alembic import op

revision = "20260912_21"
down_revision = "20260912_20"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table("market_buy_orders", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("station_id", sa.Uuid(), nullable=False), sa.Column("buyer_pilot_id", sa.Uuid(), sa.ForeignKey("pilots.id"), nullable=False), sa.Column("definition_id", sa.String(128), nullable=False), sa.Column("definition_version", sa.Integer(), nullable=False), sa.Column("quantity", sa.Integer(), nullable=False), sa.Column("unit_price_credits", sa.BigInteger(), nullable=False), sa.Column("duration_days", sa.Integer(), nullable=False), sa.Column("listing_fee_credits", sa.BigInteger(), nullable=False), sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False), sa.Column("state", sa.String(16), nullable=False, server_default="active"), sa.Column("command_id", sa.String(128), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()), sa.CheckConstraint("quantity > 0", name="market_buy_order_quantity_valid"), sa.CheckConstraint("unit_price_credits > 0", name="market_buy_order_price_valid"), sa.CheckConstraint("duration_days IN (1, 7, 30)", name="market_buy_order_duration_valid"), sa.CheckConstraint("state IN ('active', 'filled', 'cancelled', 'expired')", name="market_buy_order_state_valid"), sa.UniqueConstraint("buyer_pilot_id", "command_id", name="uq_market_buy_order_buyer_command"))
    op.create_index("ix_market_buy_orders_station_id", "market_buy_orders", ["station_id"])
    op.create_index("ix_market_buy_orders_buyer_pilot_id", "market_buy_orders", ["buyer_pilot_id"])
    op.create_index("ix_market_buy_orders_expires_at", "market_buy_orders", ["expires_at"])
    op.drop_constraint("wallet_transaction_kind_valid", "wallet_transactions", type_="check")
    op.create_check_constraint("wallet_transaction_kind_valid", "wallet_transactions", "transaction_kind IN ('initial_grant', 'market_purchase', 'market_sale', 'refinery_fee', 'market_listing_fee', 'market_purchase_commission', 'market_buy_order_fee', 'market_buy_order_fill', 'market_buy_order_sale')")

def downgrade() -> None:
    op.drop_table("market_buy_orders")