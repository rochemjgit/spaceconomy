"""Docked player market and wallet settlement APIs."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import _pilot_id_from_authorization
from .db import get_session
from .inventory import KEPLER_STATION_ID, DockedInventoryResponse, _ensure_containers, _snapshot
from .models import InventoryItem, MarketListing, PilotWallet, WalletTransaction

router = APIRouter(prefix="/api/v1/market", tags=["market"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]


class MarketListingResponse(BaseModel):
    id: UUID
    seller_pilot_id: UUID
    inventory_item_id: UUID
    definition_id: str
    definition_version: int
    quantity: int
    unit_price_credits: int
    volume_per_unit: float


class MarketSnapshotResponse(BaseModel):
    wallet_balance_credits: int
    listings: list[MarketListingResponse]
    my_listings: list[MarketListingResponse]


class MarketMutationResponse(MarketSnapshotResponse):
    inventory: DockedInventoryResponse


class CreateListingRequest(BaseModel):
    inventory_item_id: UUID
    quantity: int = Field(gt=0)
    unit_price_credits: int = Field(gt=0)


class BuyListingRequest(BaseModel):
    quantity: int = Field(gt=0)


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
    return wallet


async def _listing_rows(
    session: AsyncSession, pilot_id: UUID
) -> list[tuple[MarketListing, InventoryItem]]:
    return list(
        await session.execute(
            select(MarketListing, InventoryItem)
            .join(InventoryItem, MarketListing.inventory_item_id == InventoryItem.id)
            .where(MarketListing.station_id == KEPLER_STATION_ID, MarketListing.state == "active")
            .order_by(MarketListing.created_at.desc(), MarketListing.id)
        )
    )


def _listing_response(listing: MarketListing, item: InventoryItem) -> MarketListingResponse:
    return MarketListingResponse(
        id=listing.id,
        seller_pilot_id=listing.seller_pilot_id,
        inventory_item_id=item.id,
        definition_id=item.definition_id,
        definition_version=item.definition_version,
        quantity=listing.quantity,
        unit_price_credits=listing.unit_price_credits,
        volume_per_unit=item.volume_per_unit,
    )


async def _market_snapshot(session: AsyncSession, pilot_id: UUID) -> MarketSnapshotResponse:
    wallet = await _wallet(session, pilot_id)
    rows = await _listing_rows(session, pilot_id)
    listings = [_listing_response(listing, item) for listing, item in rows]
    return MarketSnapshotResponse(
        wallet_balance_credits=wallet.balance_credits,
        listings=listings,
        my_listings=[listing for listing in listings if listing.seller_pilot_id == pilot_id],
    )


@router.get("/docked", response_model=MarketSnapshotResponse)
async def docked_market(
    session: SessionDependency, authorization: Annotated[str | None, Header()] = None
) -> MarketSnapshotResponse:
    """Show the Kepler market and the caller's active listings."""
    async with session.begin():
        pilot_id = await _require_docked_market_pilot(session, authorization)
        return await _market_snapshot(session, pilot_id)


@router.post("/listings", response_model=MarketMutationResponse)
async def create_listing(
    payload: CreateListingRequest,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> MarketMutationResponse:
    """Reserve part or all of a station stack for sale at a fixed unit price."""
    async with session.begin():
        pilot_id = await _require_docked_market_pilot(session, authorization)
        ship, station = await _ensure_containers(session, pilot_id)
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
        buyer_ship, buyer_station = await _ensure_containers(session, buyer_id)
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
        if buyer_wallet.balance_credits < total_price:
            raise HTTPException(status.HTTP_409_CONFLICT, "insufficient wallet credits")
        buyer_wallet.balance_credits -= total_price
        seller_wallet.balance_credits += total_price
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
                ),
                WalletTransaction(
                    pilot_id=listing.seller_pilot_id,
                    counterparty_pilot_id=buyer_id,
                    amount_credits=total_price,
                    transaction_kind="market_sale",
                    market_listing_id=listing.id,
                ),
            )
        )
        snapshot = await _snapshot(session, buyer_ship, buyer_station)
        market = await _market_snapshot(session, buyer_id)
        return MarketMutationResponse(**market.model_dump(), inventory=snapshot)