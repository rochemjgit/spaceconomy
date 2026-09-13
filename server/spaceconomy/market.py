"""Docked player market and wallet settlement APIs."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from math import ceil
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import _pilot_id_from_authorization
from .db import get_session
from .inventory import KEPLER_STATION_ID, DockedInventoryResponse, _ensure_containers, _snapshot
from .models import InventoryItem, MarketBuyOrder, MarketListing, Pilot, PilotWallet, WalletTransaction

router = APIRouter(prefix="/api/v1/market", tags=["market"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]


class MarketListingResponse(BaseModel):
    id: UUID
    seller_pilot_id: UUID
    seller_display_name: str
    inventory_item_id: UUID
    definition_id: str
    definition_version: int
    quantity: int
    unit_price_credits: int
    volume_per_unit: float
    duration_days: int
    listing_fee_credits: int
    expires_at: datetime


class MarketSnapshotResponse(BaseModel):
    wallet_balance_credits: int
    listings: list[MarketListingResponse]
    my_listings: list[MarketListingResponse]
    buy_orders: list["MarketBuyOrderResponse"]
    my_buy_orders: list["MarketBuyOrderResponse"]


class MarketBuyOrderResponse(BaseModel):
    id: UUID
    buyer_display_name: str
    definition_id: str
    definition_version: int
    quantity: int
    unit_price_credits: int
    duration_days: int
    listing_fee_credits: int
    expires_at: datetime


class WalletSnapshotResponse(BaseModel):
    wallet_balance_credits: int


class MarketMutationResponse(MarketSnapshotResponse):
    inventory: DockedInventoryResponse


class CreateListingRequest(BaseModel):
    inventory_item_id: UUID
    quantity: int = Field(gt=0)
    unit_price_credits: int = Field(gt=0)
    duration_days: Literal[1, 7, 30] = 1
    idempotency_key: str = Field(min_length=1, max_length=96)


class BuyListingRequest(BaseModel):
    quantity: int = Field(gt=0)
    idempotency_key: str = Field(min_length=1, max_length=96)


class CreateBuyOrderRequest(BaseModel):
    definition_id: str = Field(min_length=1, max_length=128)
    definition_version: int = Field(ge=1)
    quantity: int = Field(gt=0)
    unit_price_credits: int = Field(gt=0)
    duration_days: Literal[1, 7, 30] = 1
    idempotency_key: str = Field(min_length=1, max_length=96)


MARKET_FEE_RATE_PER_DAY = 0.001


def _market_fee_credits(quantity: int, unit_price_credits: int, duration_days: int) -> int:
    return max(1, ceil(quantity * unit_price_credits * duration_days * MARKET_FEE_RATE_PER_DAY))


async def _require_docked_market_pilot(
    session: AsyncSession, authorization: str | None
) -> UUID:
    pilot_id = _pilot_id_from_authorization(authorization)
    _, _ = await _ensure_containers(session, pilot_id)
    from .inventory import _lock_pilot_state

    state = await _lock_pilot_state(session, pilot_id)
    if state.docked_station_name is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "ship must be docked to use the market")
    return pilot_id


async def _wallet(session: AsyncSession, pilot_id: UUID) -> PilotWallet:
    wallet = await session.get(PilotWallet, pilot_id, with_for_update=True)
    if wallet is None:
        wallet = PilotWallet(pilot_id=pilot_id)
        session.add(wallet)
        await session.flush()
        session.add(
            WalletTransaction(
                pilot_id=pilot_id,
                counterparty_pilot_id=None,
                amount_credits=wallet.balance_credits,
                transaction_kind="initial_grant",
                command_id=f"initial-grant:{pilot_id}",
                settlement_id=pilot_id,
            )
        )
    return wallet


async def _listing_rows(
    session: AsyncSession, pilot_id: UUID
) -> list[tuple[MarketListing, InventoryItem, Pilot]]:
    return list(
        await session.execute(
            select(MarketListing, InventoryItem, Pilot)
            .join(InventoryItem, MarketListing.inventory_item_id == InventoryItem.id)
            .join(Pilot, MarketListing.seller_pilot_id == Pilot.id)
            .where(MarketListing.station_id == KEPLER_STATION_ID, MarketListing.state == "active")
            .order_by(MarketListing.created_at.desc(), MarketListing.id)
        )
    )


def _listing_response(
    listing: MarketListing, item: InventoryItem, seller: Pilot
) -> MarketListingResponse:
    return MarketListingResponse(
        id=listing.id,
        seller_pilot_id=listing.seller_pilot_id,
        seller_display_name=seller.display_name,
        inventory_item_id=item.id,
        definition_id=item.definition_id,
        definition_version=item.definition_version,
        quantity=listing.quantity,
        unit_price_credits=listing.unit_price_credits,
        volume_per_unit=item.volume_per_unit,
        duration_days=listing.duration_days,
        listing_fee_credits=listing.listing_fee_credits,
        expires_at=listing.expires_at,
    )


async def expire_market_listings(session: AsyncSession, now: datetime | None = None) -> int:
    """Release expired station inventory reservations without refunding placement fees."""
    expired = list(
        await session.scalars(
            select(MarketListing)
            .where(
                MarketListing.state == "active",
                MarketListing.expires_at <= (now or datetime.now(UTC)),
            )
            .with_for_update(skip_locked=True)
        )
    )
    for listing in expired:
        listing.state = "expired"
        await _release_listing_inventory(session, listing)
    return len(expired)


async def _release_listing_inventory(session: AsyncSession, listing: MarketListing) -> None:
    """Return escrowed inventory to its seller's station after a listing closes."""
    item = await session.get(InventoryItem, listing.inventory_item_id, with_for_update=True)
    if item is None or item.container_id is not None:
        return
    _, station = await _ensure_containers(session, listing.seller_pilot_id)
    item.container_id = station.id


async def _buy_order_rows(session: AsyncSession) -> list[tuple[MarketBuyOrder, Pilot]]:
    return list(await session.execute(select(MarketBuyOrder, Pilot).join(Pilot, MarketBuyOrder.buyer_pilot_id == Pilot.id).where(MarketBuyOrder.station_id == KEPLER_STATION_ID, MarketBuyOrder.state == "active").order_by(MarketBuyOrder.created_at.desc())))


async def expire_market_buy_orders(session: AsyncSession, now: datetime | None = None) -> int:
    expired = list(await session.scalars(select(MarketBuyOrder).where(MarketBuyOrder.state == "active", MarketBuyOrder.expires_at <= (now or datetime.now(UTC))).with_for_update(skip_locked=True)))
    for order in expired:
        wallet = await _wallet(session, order.buyer_pilot_id)
        wallet.balance_credits += order.quantity * order.unit_price_credits
        order.state = "expired"
    return len(expired)


async def _market_snapshot(session: AsyncSession, pilot_id: UUID) -> MarketSnapshotResponse:
    await expire_market_listings(session)
    await expire_market_buy_orders(session)
    wallet = await _wallet(session, pilot_id)
    rows = await _listing_rows(session, pilot_id)
    listings = [_listing_response(listing, item, seller) for listing, item, seller in rows]
    buy_orders = [MarketBuyOrderResponse(id=order.id, buyer_display_name=buyer.display_name, definition_id=order.definition_id, definition_version=order.definition_version, quantity=order.quantity, unit_price_credits=order.unit_price_credits, duration_days=order.duration_days, listing_fee_credits=order.listing_fee_credits, expires_at=order.expires_at) for order, buyer in await _buy_order_rows(session)]
    return MarketSnapshotResponse(
        wallet_balance_credits=wallet.balance_credits,
        listings=listings,
        my_listings=[listing for listing in listings if listing.seller_pilot_id == pilot_id],
        buy_orders=buy_orders,
        my_buy_orders=[order for order in buy_orders if order.id in {row.id for row, _ in await _buy_order_rows(session) if row.buyer_pilot_id == pilot_id}],
    )


@router.get("/docked", response_model=MarketSnapshotResponse)
async def docked_market(
    session: SessionDependency, authorization: Annotated[str | None, Header()] = None
) -> MarketSnapshotResponse:
    """Show the Kepler market and the caller's active listings."""
    async with session.begin():
        pilot_id = await _require_docked_market_pilot(session, authorization)
        return await _market_snapshot(session, pilot_id)


@router.get("/wallet", response_model=WalletSnapshotResponse)
async def wallet_snapshot(
    session: SessionDependency, authorization: Annotated[str | None, Header()] = None
) -> WalletSnapshotResponse:
    """Return the authenticated pilot's spendable credits from any ship state."""
    pilot_id = _pilot_id_from_authorization(authorization)
    async with session.begin():
        wallet = await _wallet(session, pilot_id)
        return WalletSnapshotResponse(wallet_balance_credits=wallet.balance_credits)


@router.post("/listings", response_model=MarketMutationResponse)
async def create_listing(
    payload: CreateListingRequest,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> MarketMutationResponse:
    """Reserve part or all of a station stack for sale at a fixed unit price."""
    async with session.begin():
        pilot_id = await _require_docked_market_pilot(session, authorization)
        await expire_market_listings(session)
        ship, station = await _ensure_containers(session, pilot_id)
        existing = await session.scalar(
            select(MarketListing)
            .where(
                MarketListing.seller_pilot_id == pilot_id,
                MarketListing.command_id == payload.idempotency_key,
            )
            .with_for_update()
        )
        if existing is not None:
            snapshot = await _snapshot(session, ship, station)
            market = await _market_snapshot(session, pilot_id)
            return MarketMutationResponse(**market.model_dump(), inventory=snapshot)
        item = await session.scalar(
            select(InventoryItem)
            .where(
                InventoryItem.id == payload.inventory_item_id,
                InventoryItem.container_id == station.id,
            )
            .with_for_update()
        )
        if item is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "station inventory item was not found")
        if payload.quantity > item.quantity:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "insufficient item quantity")
        if item.module_definition_id is not None and payload.quantity != 1:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "module listings are single items"
            )
        listing_fee_credits = _market_fee_credits(
            payload.quantity, payload.unit_price_credits, payload.duration_days
        )
        wallet = await _wallet(session, pilot_id)
        if wallet.balance_credits < listing_fee_credits:
            raise HTTPException(status.HTTP_409_CONFLICT, "insufficient wallet credits for listing fee")
        wallet.balance_credits -= listing_fee_credits
        listed_item = item
        if payload.quantity < item.quantity:
            item.quantity -= payload.quantity
            listed_item = InventoryItem(
                pilot_id=pilot_id,
                container_id=station.id,
                module_definition_id=item.module_definition_id,
                definition_id=item.definition_id,
                definition_version=item.definition_version,
                quantity=payload.quantity,
                durability=item.durability,
                volume_per_unit=item.volume_per_unit,
            )
            session.add(listed_item)
            await session.flush()
        session.add(
            MarketListing(
                station_id=KEPLER_STATION_ID,
                seller_pilot_id=pilot_id,
                inventory_item_id=listed_item.id,
                quantity=payload.quantity,
                unit_price_credits=payload.unit_price_credits,
                duration_days=payload.duration_days,
                listing_fee_credits=listing_fee_credits,
                expires_at=datetime.now(UTC) + timedelta(days=payload.duration_days),
                command_id=payload.idempotency_key,
            )
        )
        listed_item.container_id = None
        session.add(
            WalletTransaction(
                pilot_id=pilot_id,
                counterparty_pilot_id=None,
                amount_credits=-listing_fee_credits,
                transaction_kind="market_listing_fee",
                command_id=f"market-listing-fee:{payload.idempotency_key}",
                settlement_id=uuid4(),
            )
        )
        snapshot = await _snapshot(session, ship, station)
        market = await _market_snapshot(session, pilot_id)
        return MarketMutationResponse(**market.model_dump(), inventory=snapshot)


@router.post("/listings/{listing_id}/buy", response_model=MarketMutationResponse)
async def buy_listing(
    listing_id: UUID,
    payload: BuyListingRequest,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> MarketMutationResponse:
    """Buy listed station inventory and settle both wallets atomically."""
    async with session.begin():
        buyer_id = await _require_docked_market_pilot(session, authorization)
        await expire_market_listings(session)
        buyer_ship, buyer_station = await _ensure_containers(session, buyer_id)
        command_id = f"market-buy:{payload.idempotency_key}"
        previous_purchase = await session.scalar(
            select(WalletTransaction)
            .where(
                WalletTransaction.pilot_id == buyer_id,
                WalletTransaction.command_id == command_id,
            )
            .with_for_update()
        )
        if previous_purchase is not None:
            snapshot = await _snapshot(session, buyer_ship, buyer_station)
            market = await _market_snapshot(session, buyer_id)
            return MarketMutationResponse(**market.model_dump(), inventory=snapshot)
        listing = await session.scalar(
            select(MarketListing)
            .where(MarketListing.id == listing_id, MarketListing.state == "active")
            .with_for_update()
        )
        if listing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "market listing is unavailable")
        if listing.seller_pilot_id == buyer_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "cannot buy your own listing"
            )
        if payload.quantity > listing.quantity:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "listing quantity is unavailable"
            )
        item = await session.get(InventoryItem, listing.inventory_item_id, with_for_update=True)
        if item is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "listed inventory is unavailable")
        buyer_wallet = await _wallet(session, buyer_id)
        seller_wallet = await _wallet(session, listing.seller_pilot_id)
        total_price = payload.quantity * listing.unit_price_credits
        commission_credits = _market_fee_credits(
            payload.quantity, listing.unit_price_credits, listing.duration_days
        )
        total_cost = total_price + commission_credits
        if buyer_wallet.balance_credits < total_cost:
            raise HTTPException(status.HTTP_409_CONFLICT, "insufficient wallet credits")
        buyer_wallet.balance_credits -= total_cost
        seller_wallet.balance_credits += total_price
        settlement_id = uuid4()
        if payload.quantity == listing.quantity:
            item.container_id = buyer_station.id
            listing.state = "sold"
        else:
            item.quantity -= payload.quantity
            listing.quantity -= payload.quantity
            session.add(
                InventoryItem(
                    pilot_id=buyer_id,
                    container_id=buyer_station.id,
                    module_definition_id=item.module_definition_id,
                    definition_id=item.definition_id,
                    definition_version=item.definition_version,
                    quantity=payload.quantity,
                    durability=item.durability,
                    volume_per_unit=item.volume_per_unit,
                )
            )
        session.add_all(
            (
                WalletTransaction(
                    pilot_id=buyer_id,
                    counterparty_pilot_id=listing.seller_pilot_id,
                    amount_credits=-total_price,
                    transaction_kind="market_purchase",
                    market_listing_id=listing.id,
                    command_id=command_id,
                    settlement_id=settlement_id,
                ),
                WalletTransaction(
                    pilot_id=buyer_id,
                    counterparty_pilot_id=None,
                    amount_credits=-commission_credits,
                    transaction_kind="market_purchase_commission",
                    market_listing_id=listing.id,
                    command_id=f"market-commission:{payload.idempotency_key}",
                    settlement_id=settlement_id,
                ),
                WalletTransaction(
                    pilot_id=listing.seller_pilot_id,
                    counterparty_pilot_id=buyer_id,
                    amount_credits=total_price,
                    transaction_kind="market_sale",
                    market_listing_id=listing.id,
                    command_id=f"market-sale:{buyer_id}:{payload.idempotency_key}",
                    settlement_id=settlement_id,
                ),
            )
        )
        snapshot = await _snapshot(session, buyer_ship, buyer_station)
        market = await _market_snapshot(session, buyer_id)
        return MarketMutationResponse(**market.model_dump(), inventory=snapshot)


@router.post("/listings/{listing_id}/cancel", response_model=MarketMutationResponse)
async def cancel_listing(
    listing_id: UUID,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> MarketMutationResponse:
    """Cancel the caller's active listing and release its station inventory."""
    async with session.begin():
        pilot_id = await _require_docked_market_pilot(session, authorization)
        await expire_market_listings(session)
        ship, station = await _ensure_containers(session, pilot_id)
        listing = await session.scalar(
            select(MarketListing)
            .where(MarketListing.id == listing_id, MarketListing.seller_pilot_id == pilot_id)
            .with_for_update()
        )
        if listing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "market listing was not found")
        if listing.state == "active":
            listing.state = "cancelled"
            await _release_listing_inventory(session, listing)
        snapshot = await _snapshot(session, ship, station)
        market = await _market_snapshot(session, pilot_id)
        return MarketMutationResponse(**market.model_dump(), inventory=snapshot)


@router.post("/buy-orders", response_model=MarketMutationResponse)
async def create_buy_order(payload: CreateBuyOrderRequest, session: SessionDependency, authorization: Annotated[str | None, Header()] = None) -> MarketMutationResponse:
    async with session.begin():
        buyer_id = await _require_docked_market_pilot(session, authorization)
        ship, station = await _ensure_containers(session, buyer_id)
        fee = _market_fee_credits(payload.quantity, payload.unit_price_credits, payload.duration_days)
        reserved = payload.quantity * payload.unit_price_credits
        wallet = await _wallet(session, buyer_id)
        if wallet.balance_credits < reserved + fee: raise HTTPException(status.HTTP_409_CONFLICT, "insufficient wallet credits for buy order")
        wallet.balance_credits -= reserved + fee
        order = MarketBuyOrder(station_id=KEPLER_STATION_ID, buyer_pilot_id=buyer_id, definition_id=payload.definition_id, definition_version=payload.definition_version, quantity=payload.quantity, unit_price_credits=payload.unit_price_credits, duration_days=payload.duration_days, listing_fee_credits=fee, expires_at=datetime.now(UTC) + timedelta(days=payload.duration_days), command_id=payload.idempotency_key)
        session.add_all((order, WalletTransaction(pilot_id=buyer_id, counterparty_pilot_id=None, amount_credits=-fee, transaction_kind="market_buy_order_fee", command_id=f"market-buy-order-fee:{payload.idempotency_key}", settlement_id=uuid4())))
        snapshot, market = await _snapshot(session, ship, station), await _market_snapshot(session, buyer_id)
        return MarketMutationResponse(**market.model_dump(), inventory=snapshot)


@router.post("/buy-orders/{order_id}/fill", response_model=MarketMutationResponse)
async def fill_buy_order(order_id: UUID, payload: BuyListingRequest, session: SessionDependency, authorization: Annotated[str | None, Header()] = None) -> MarketMutationResponse:
    async with session.begin():
        seller_id = await _require_docked_market_pilot(session, authorization)
        ship, station = await _ensure_containers(session, seller_id)
        order = await session.scalar(select(MarketBuyOrder).where(MarketBuyOrder.id == order_id, MarketBuyOrder.state == "active").with_for_update())
        if order is None or order.buyer_pilot_id == seller_id: raise HTTPException(status.HTTP_404_NOT_FOUND, "buy order is unavailable")
        if payload.quantity > order.quantity: raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "buy order quantity is unavailable")
        item = await session.scalar(select(InventoryItem).where(InventoryItem.container_id == station.id, InventoryItem.definition_id == order.definition_id, InventoryItem.definition_version == order.definition_version).order_by(InventoryItem.created_at).with_for_update())
        if item is None or item.quantity < payload.quantity: raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "matching station inventory is unavailable")
        _, buyer_station = await _ensure_containers(session, order.buyer_pilot_id)
        payout = payload.quantity * order.unit_price_credits
        seller_wallet = await _wallet(session, seller_id); seller_wallet.balance_credits += payout
        if item.quantity == payload.quantity: item.container_id = buyer_station.id
        else: item.quantity -= payload.quantity; session.add(InventoryItem(pilot_id=order.buyer_pilot_id, container_id=buyer_station.id, module_definition_id=item.module_definition_id, definition_id=item.definition_id, definition_version=item.definition_version, quantity=payload.quantity, durability=item.durability, volume_per_unit=item.volume_per_unit))
        order.quantity -= payload.quantity
        if order.quantity == 0: order.state = "filled"
        settlement_id = uuid4(); session.add_all((WalletTransaction(pilot_id=order.buyer_pilot_id, counterparty_pilot_id=seller_id, amount_credits=-payout, transaction_kind="market_buy_order_fill", command_id=f"market-buy-order-fill:{payload.idempotency_key}", settlement_id=settlement_id), WalletTransaction(pilot_id=seller_id, counterparty_pilot_id=order.buyer_pilot_id, amount_credits=payout, transaction_kind="market_buy_order_sale", command_id=f"market-buy-order-sale:{payload.idempotency_key}", settlement_id=settlement_id)))
        snapshot, market = await _snapshot(session, ship, station), await _market_snapshot(session, seller_id)
        return MarketMutationResponse(**market.model_dump(), inventory=snapshot)