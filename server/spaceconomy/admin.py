"""Local-development administration APIs for runtime configuration and NPCs."""

from __future__ import annotations

import asyncio
import json
import time
from datetime import UTC, datetime
from typing import Annotated, Iterator, Literal, cast
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_session
from .inventory import _ensure_containers
from .redis import get_system_presence
from .models import (
    Account,
    AccountActivation,
    AsteroidField,
    FittedModule,
    InventoryContainer,
    InventoryItem,
    MarketListing,
    MarketBuyOrder,
    MinedOreLot,
    NpcProfile,
    NpcRuntime,
    Pilot,
    PilotDiscovery,
    PilotWallet,
    RefreshSession,
    RefineryJob,
    RefineryService,
    Ship,
    ShipLocation,
    ShipState,
    SolarSystem,
    WalletTransaction,
)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]
KEPLER_STATION_POSITION = (3_000_000_000, 480, -50_000)
SYSTEM_ID = "kepler"


async def require_admin_access() -> None:
    """Development bypass; replace this gate with a real administrator policy before release."""
    if settings.admin_auth_required:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "admin authentication is not configured"
        )


AdminDependency = Annotated[None, Depends(require_admin_access)]


class RuntimeConfiguration(BaseModel):
    simulation_tick_hz: int = Field(ge=1, le=60)
    snapshot_tick_hz: int = Field(ge=1, le=60)
    asteroid_spawn_interval_seconds: int = Field(ge=10, le=3_600)
    asteroid_field_maximum_active_asteroids: int = Field(1, le=500)
    asteroid_system_maximum_active_fields: int = Field(1, le=100)
    refinery_tick_seconds: float = Field(gt=0, le=60)
    llm_provider: Literal["ollama", "azure_foundry"]
    llm_model: str
    ollama_model: str = Field(min_length=1, max_length=128)
    ollama_timeout_seconds: float = Field(gt=0, le=300)


class RuntimeConfigurationUpdate(BaseModel):
    simulation_tick_hz: int | None = Field(default=None, ge=1, le=60)
    snapshot_tick_hz: int | None = Field(default=None, ge=1, le=60)
    asteroid_spawn_interval_seconds: int | None = Field(default=None, ge=10, le=3_600)
    asteroid_field_maximum_active_asteroids: int | None = Field(default=None, ge=1, le=500)
    asteroid_system_maximum_active_fields: int | None = Field(default=None, ge=1, le=100)
    refinery_tick_seconds: float | None = Field(default=None, gt=0, le=60)
    llm_provider: Literal["ollama", "azure_foundry"] | None = None
    ollama_model: str | None = Field(default=None, min_length=1, max_length=128)
    ollama_timeout_seconds: float | None = Field(default=None, gt=0, le=300)


class AdminRefineryJob(BaseModel):
    id: UUID
    pilot: str
    refinery_name: str
    stage: str
    state: str
    queue_sequence: int
    quoted_duration_seconds: float
    quoted_efficiency: float
    quoted_fee_credits: int
    started_at: datetime | None
    completes_at: datetime | None
    completed_at: datetime | None
    failure_reason: str | None


class AdminRefineryResponse(BaseModel):
    jobs: list[AdminRefineryJob]


class NpcResponse(BaseModel):
    pilot_id: UUID
    display_name: str
    archetype_key: str
    backstory: str
    motivations: list[str]
    capabilities: list[str]
    lifecycle_state: Literal["active", "paused", "retired"]
    behavior_state: str


class NpcInventorySummary(BaseModel):
    container_type: str
    item_stacks: int
    item_units: int
    ore_lots: int
    volume_cubic_meters: float
    items: list["NpcInventoryItem"]
    raw_ore_lots: list["NpcRawOreLot"]


class NpcInventoryItem(BaseModel):
    definition_id: str
    quantity: int
    durability: float
    volume_per_unit: float


class NpcRawOreLot(BaseModel):
    composition: str
    volume_cubic_meters: float


class NpcStateResponse(NpcResponse):
    location_kind: Literal["docked", "space"]
    station_name: str | None
    position_x: float
    position_y: float
    position_z: float
    cargo_cubic_meters: float
    inventory: list[NpcInventorySummary]
    wallet_balance_credits: int
    open_market_orders: list["NpcMarketOrder"]
    active_refinery_jobs: list["ActiveRefineryJob"]


class PlayerMapPresence(BaseModel):
    pilot_id: UUID
    display_name: str
    location_kind: Literal["docked", "space"]
    station_name: str | None
    position_x: float
    position_y: float
    position_z: float
    cargo_cubic_meters: float
    inventory: list[NpcInventorySummary]
    wallet_balance_credits: int
    open_market_orders: list["NpcMarketOrder"]
    active_refinery_jobs: list["ActiveRefineryJob"]


class AsteroidFieldMapPresence(BaseModel):
    id: UUID
    display_name: str
    position_x: float
    position_y: float
    position_z: float


class SystemStateResponse(BaseModel):
    npcs: list[NpcStateResponse]
    players: list[PlayerMapPresence]
    asteroid_fields: list[AsteroidFieldMapPresence]
    system_radius_meters: float


class NpcMarketOrder(BaseModel):
    definition_id: str
    quantity: int
    unit_price_credits: int
    expires_at: datetime


class ActiveRefineryJob(BaseModel):
    refinery_name: str
    stage: str
    state: str
    queue_sequence: int
    quoted_duration_seconds: float
    quoted_efficiency: float
    quoted_fee_credits: int
    started_at: datetime | None
    completes_at: datetime | None


class AdminMarketOrder(BaseModel):
    id: UUID
    side: Literal["sell", "buy"]
    owner: str
    station: str
    system: str
    definition_id: str
    quantity: int
    unit_price_credits: int
    state: str
    expires_at: datetime


class AdminMarketLedgerEntry(BaseModel):
    created_at: datetime
    pilot: str
    transaction_kind: str
    amount_credits: int
    market_listing_id: UUID | None


class AdminMarketResponse(BaseModel):
    orders: list[AdminMarketOrder]
    ledger: list[AdminMarketLedgerEntry]


class NpcMoveRequest(BaseModel):
    destination: Literal["station", "coordinates"]
    position_x: float | None = Field(default=None, allow_inf_nan=False)
    position_y: float | None = Field(default=None, allow_inf_nan=False)
    position_z: float | None = Field(default=None, allow_inf_nan=False)


class CreateNpcRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=32)
    archetype_key: str = Field(default="economic_miner", min_length=1, max_length=64)
    backstory: str = Field(min_length=1, max_length=4_000)
    motivations: list[str] = Field(min_length=1, max_length=12)
    capabilities: list[str] = Field(default_factory=lambda: ["mine", "refine", "market"])


class UpdateNpcRequest(BaseModel):
    backstory: str | None = Field(default=None, min_length=1, max_length=4_000)
    motivations: list[str] | None = Field(default=None, min_length=1, max_length=12)
    capabilities: list[str] | None = Field(default=None)
    lifecycle_state: Literal["active", "paused", "retired"] | None = None


class ProfileGenerationRequest(BaseModel):
    display_name: str = Field(default="", max_length=32)
    archetype_key: str = Field(default="economic_miner", min_length=1, max_length=64)
    prompt: str = Field(default="", max_length=1_000)


class GeneratedProfile(BaseModel):
    display_name: str = Field(min_length=1, max_length=32)
    creative_direction: str = Field(min_length=1, max_length=1_000)
    backstory: str = Field(min_length=1, max_length=4_000)
    motivations: list[str] = Field(min_length=1, max_length=12)


class TestPromptRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=2_000)
    num_predict: int = Field(default=64, ge=1, le=256)


class TestPromptResponse(BaseModel):
    response: str
    elapsed_seconds: float


class FoundryStreamPromptRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=8_000)
    system_instruction: str = Field(default="you are a helpful ai", max_length=4_000)
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: int = Field(default=256, ge=1, le=1_024)


def _runtime_configuration() -> RuntimeConfiguration:
    return RuntimeConfiguration(
        simulation_tick_hz=settings.simulation_tick_hz,
        snapshot_tick_hz=settings.snapshot_tick_hz,
        asteroid_spawn_interval_seconds=settings.asteroid_spawn_interval_seconds,
        asteroid_field_maximum_active_asteroids=settings.asteroid_field_maximum_active_asteroids,
        asteroid_system_maximum_active_fields=settings.asteroid_system_maximum_active_fields,
        refinery_tick_seconds=settings.refinery_tick_seconds,
        llm_provider=settings.llm_provider,
        llm_model=(
            settings.azure_foundry_model
            if settings.llm_provider == "azure_foundry"
            else settings.ollama_model
        ),
        ollama_model=settings.ollama_model,
        ollama_timeout_seconds=settings.ollama_timeout_seconds,
    )


@router.get("/market/orders", response_model=AdminMarketResponse)
async def market_orders(
    _: AdminDependency,
    session: SessionDependency,
    item: str | None = None,
    station: str | None = None,
    system: str | None = None,
    side: Literal["buy", "sell"] | None = None,
    state: str | None = None,
) -> AdminMarketResponse:
    """Inspect current station orders and their immutable market ledger activity."""
    if station and station.lower() not in {"kepler", "kepler station"}:
        return AdminMarketResponse(orders=[], ledger=[])
    if system and system.lower() != "kepler":
        return AdminMarketResponse(orders=[], ledger=[])
    orders: list[AdminMarketOrder] = []
    if side in (None, "sell"):
        statement = select(MarketListing, Pilot).join(Pilot, MarketListing.seller_pilot_id == Pilot.id)
        if item: statement = statement.where(MarketListing.inventory_item_id.in_(select(InventoryItem.id).where(InventoryItem.definition_id.ilike(f"%{item}%"))))
        if state: statement = statement.where(MarketListing.state == state)
        for listing, pilot in (await session.execute(statement.order_by(MarketListing.created_at.desc()))).all():
            inventory_item = await session.get(InventoryItem, listing.inventory_item_id)
            if inventory_item: orders.append(AdminMarketOrder(id=listing.id, side="sell", owner=pilot.display_name, station="KEPLER STATION", system="KEPLER", definition_id=inventory_item.definition_id, quantity=listing.quantity, unit_price_credits=listing.unit_price_credits, state=listing.state, expires_at=listing.expires_at))
    if side in (None, "buy"):
        statement = select(MarketBuyOrder, Pilot).join(Pilot, MarketBuyOrder.buyer_pilot_id == Pilot.id)
        if item: statement = statement.where(MarketBuyOrder.definition_id.ilike(f"%{item}%"))
        if state: statement = statement.where(MarketBuyOrder.state == state)
        for order, pilot in (await session.execute(statement.order_by(MarketBuyOrder.created_at.desc()))).all():
            orders.append(AdminMarketOrder(id=order.id, side="buy", owner=pilot.display_name, station="KEPLER STATION", system="KEPLER", definition_id=order.definition_id, quantity=order.quantity, unit_price_credits=order.unit_price_credits, state=order.state, expires_at=order.expires_at))
    ledger_statement = select(WalletTransaction, Pilot).join(Pilot, WalletTransaction.pilot_id == Pilot.id).where(WalletTransaction.transaction_kind.like("market_%")).order_by(WalletTransaction.created_at.desc()).limit(250)
    ledger = [AdminMarketLedgerEntry(created_at=entry.created_at, pilot=pilot.display_name, transaction_kind=entry.transaction_kind, amount_credits=entry.amount_credits, market_listing_id=entry.market_listing_id) for entry, pilot in (await session.execute(ledger_statement)).all()]
    return AdminMarketResponse(orders=orders, ledger=ledger)


@router.get("/refinery/jobs", response_model=AdminRefineryResponse)
async def refinery_jobs(
    _: AdminDependency,
    session: SessionDependency,
    pilot: str | None = None,
    refinery: str | None = None,
    stage: Literal["crush", "purify"] | None = None,
    state: Literal["queued", "processing", "completed", "cancelled", "failed"] | None = None,
) -> AdminRefineryResponse:
    """Inspect refinery work across the game, including completed and failed jobs."""
    statement = (
        select(RefineryJob, Pilot.display_name, RefineryService.display_name)
        .join(Pilot, Pilot.id == RefineryJob.pilot_id)
        .join(RefineryService, RefineryService.id == RefineryJob.refinery_service_id)
    )
    if pilot:
        statement = statement.where(Pilot.display_name.ilike(f"%{pilot}%"))
    if refinery:
        statement = statement.where(RefineryService.display_name.ilike(f"%{refinery}%"))
    if stage:
        statement = statement.where(RefineryJob.stage == stage)
    if state:
        statement = statement.where(RefineryJob.state == state)
    rows = await session.execute(
        statement.order_by(RefineryJob.created_at.desc(), RefineryJob.queue_sequence)
    )
    return AdminRefineryResponse(
        jobs=[
            AdminRefineryJob(
                id=job.id,
                pilot=pilot_name,
                refinery_name=refinery_name,
                stage=job.stage,
                state=job.state,
                queue_sequence=job.queue_sequence,
                quoted_duration_seconds=job.quoted_duration_seconds,
                quoted_efficiency=job.quoted_efficiency,
                quoted_fee_credits=job.quoted_fee_credits,
                started_at=job.started_at,
                completes_at=job.completes_at,
                completed_at=job.completed_at,
                failure_reason=job.failure_reason,
            )
            for job, pilot_name, refinery_name in rows.all()
        ]
    )


def _npc_response(pilot: Pilot, profile: NpcProfile, runtime: NpcRuntime) -> NpcResponse:
    return NpcResponse(
        pilot_id=pilot.id,
        display_name=pilot.display_name,
        archetype_key=profile.archetype_key,
        backstory=profile.backstory,
        motivations=json.loads(profile.motivations),
        capabilities=json.loads(profile.capabilities),
        lifecycle_state=cast(Literal["active", "paused", "retired"], profile.lifecycle_state),
        behavior_state=runtime.behavior_state,
    )


async def _npc_rows(session: AsyncSession) -> list[tuple[Pilot, NpcProfile, NpcRuntime]]:
    result = await session.execute(
        select(Pilot, NpcProfile, NpcRuntime)
        .join(NpcProfile, NpcProfile.pilot_id == Pilot.id)
        .join(NpcRuntime, NpcRuntime.pilot_id == Pilot.id)
        .order_by(Pilot.display_name)
    )
    return cast(list[tuple[Pilot, NpcProfile, NpcRuntime]], result.all())


async def _npc_row(session: AsyncSession, pilot_id: UUID) -> tuple[Pilot, NpcProfile, NpcRuntime]:
    result = await session.execute(
        select(Pilot, NpcProfile, NpcRuntime)
        .join(NpcProfile, NpcProfile.pilot_id == Pilot.id)
        .join(NpcRuntime, NpcRuntime.pilot_id == Pilot.id)
        .where(Pilot.id == pilot_id)
        .with_for_update()
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "NPC was not found")
    return cast(tuple[Pilot, NpcProfile, NpcRuntime], row)


async def _npc_state_response(
    session: AsyncSession, pilot: Pilot, profile: NpcProfile, runtime: NpcRuntime, ship_state: ShipState
) -> NpcStateResponse:
    inventory, wallet_balance_credits, open_market_orders, active_refinery_jobs = await _pilot_assets(session, pilot.id)
    return NpcStateResponse(
        **_npc_response(pilot, profile, runtime).model_dump(),
        location_kind="docked" if ship_state.docked_station_name else "space",
        station_name=ship_state.docked_station_name,
        position_x=ship_state.position_x,
        position_y=ship_state.position_y,
        position_z=ship_state.position_z,
        cargo_cubic_meters=ship_state.cargo_cubic_meters,
        inventory=inventory,
        wallet_balance_credits=wallet_balance_credits,
        open_market_orders=open_market_orders,
        active_refinery_jobs=active_refinery_jobs,
    )


async def _pilot_assets(
    session: AsyncSession, pilot_id: UUID
) -> tuple[list[NpcInventorySummary], int, list[NpcMarketOrder], list[ActiveRefineryJob]]:
    containers = list(
        await session.scalars(select(InventoryContainer).where(InventoryContainer.pilot_id == pilot_id))
    )
    inventory = []
    for container in containers:
        item_stacks, item_units, item_volume = (
            await session.execute(
                select(
                    func.count(InventoryItem.id),
                    func.coalesce(func.sum(InventoryItem.quantity), 0),
                    func.coalesce(func.sum(InventoryItem.quantity * InventoryItem.volume_per_unit), 0),
                ).where(InventoryItem.container_id == container.id)
            )
        ).one()
        ore_lots, ore_volume = (
            await session.execute(
                select(
                    func.count(MinedOreLot.id),
                    func.coalesce(func.sum(MinedOreLot.volume_cubic_meters), 0),
                ).where(MinedOreLot.container_id == container.id)
            )
        ).one()
        inventory.append(
            NpcInventorySummary(
                container_type=container.container_type,
                item_stacks=int(item_stacks),
                item_units=int(item_units),
                ore_lots=int(ore_lots),
                volume_cubic_meters=float(item_volume) + float(ore_volume),
                items=[
                    NpcInventoryItem(
                        definition_id=item.definition_id,
                        quantity=item.quantity,
                        durability=item.durability,
                        volume_per_unit=item.volume_per_unit,
                    )
                    for item in await session.scalars(
                        select(InventoryItem)
                        .where(InventoryItem.container_id == container.id)
                        .order_by(InventoryItem.definition_id, InventoryItem.created_at)
                    )
                ],
                raw_ore_lots=[
                    NpcRawOreLot(
                        composition=lot.composition,
                        volume_cubic_meters=lot.volume_cubic_meters,
                    )
                    for lot in await session.scalars(
                        select(MinedOreLot)
                        .where(MinedOreLot.container_id == container.id)
                        .order_by(MinedOreLot.created_at, MinedOreLot.id)
                    )
                ],
            )
        )
    wallet = await session.get(PilotWallet, pilot_id)
    order_rows = await session.execute(
        select(MarketListing, InventoryItem)
        .join(InventoryItem, MarketListing.inventory_item_id == InventoryItem.id)
        .where(
            MarketListing.seller_pilot_id == pilot_id,
            MarketListing.state == "active",
            MarketListing.expires_at > datetime.now(UTC),
        )
        .order_by(MarketListing.created_at.desc(), MarketListing.id)
    )
    refinery_rows = await session.execute(
        select(RefineryJob, RefineryService.display_name)
        .join(RefineryService, RefineryService.id == RefineryJob.refinery_service_id)
        .where(RefineryJob.pilot_id == pilot_id, RefineryJob.state.in_(("queued", "processing")))
        .order_by(RefineryJob.queue_sequence)
    )
    return (
        inventory,
        wallet.balance_credits if wallet is not None else 10_000,
        [
            NpcMarketOrder(
                definition_id=item.definition_id,
                quantity=listing.quantity,
                unit_price_credits=listing.unit_price_credits,
                expires_at=listing.expires_at,
            )
            for listing, item in order_rows.all()
        ],
        [
            ActiveRefineryJob(
                refinery_name=refinery_name,
                stage=job.stage,
                state=job.state,
                queue_sequence=job.queue_sequence,
                quoted_duration_seconds=job.quoted_duration_seconds,
                quoted_efficiency=job.quoted_efficiency,
                quoted_fee_credits=job.quoted_fee_credits,
                started_at=job.started_at,
                completes_at=job.completes_at,
            )
            for job, refinery_name in refinery_rows.all()
        ],
    )


@router.get("/configuration", response_model=RuntimeConfiguration)
async def get_configuration(_: AdminDependency) -> RuntimeConfiguration:
    return _runtime_configuration()


@router.patch("/configuration", response_model=RuntimeConfiguration)
async def update_configuration(
    payload: RuntimeConfigurationUpdate, _: AdminDependency
) -> RuntimeConfiguration:
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(settings, field, value)
    return _runtime_configuration()


@router.get("/npcs", response_model=list[NpcResponse])
async def list_npcs(session: SessionDependency, _: AdminDependency) -> list[NpcResponse]:
    async with session.begin():
        return [_npc_response(*row) for row in await _npc_rows(session)]


@router.get("/npcs/state", response_model=list[NpcStateResponse])
async def list_npc_states(session: SessionDependency, _: AdminDependency) -> list[NpcStateResponse]:
    async with session.begin():
        rows = await session.execute(
            select(Pilot, NpcProfile, NpcRuntime, ShipState)
            .join(NpcProfile, NpcProfile.pilot_id == Pilot.id)
            .join(NpcRuntime, NpcRuntime.pilot_id == Pilot.id)
            .join(ShipState, ShipState.pilot_id == Pilot.id)
            .order_by(Pilot.display_name)
        )
        return [await _npc_state_response(session, *row) for row in rows.all()]


@router.get("/system/state", response_model=SystemStateResponse)
async def get_system_state(session: SessionDependency, _: AdminDependency) -> SystemStateResponse:
    live_presence = await get_system_presence(SYSTEM_ID)
    async with session.begin():
        system_radius_meters = await session.scalar(
            select(SolarSystem.radius_meters).where(SolarSystem.system_key == SYSTEM_ID)
        )
        if system_radius_meters is None:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Kepler system is not seeded")
        npc_rows = await session.execute(
            select(Pilot, NpcProfile, NpcRuntime, ShipState)
            .join(NpcProfile, NpcProfile.pilot_id == Pilot.id)
            .join(NpcRuntime, NpcRuntime.pilot_id == Pilot.id)
            .join(ShipState, ShipState.pilot_id == Pilot.id)
            .order_by(Pilot.display_name)
        )
        player_rows = await session.execute(
            select(Pilot, ShipState)
            .outerjoin(NpcProfile, NpcProfile.pilot_id == Pilot.id)
            .join(ShipState, ShipState.pilot_id == Pilot.id)
            .where(NpcProfile.pilot_id.is_(None))
            .order_by(Pilot.display_name)
        )
        asteroid_field_rows = await session.execute(
            select(AsteroidField)
            .join(SolarSystem, SolarSystem.id == AsteroidField.system_id)
            .where(SolarSystem.system_key == SYSTEM_ID, AsteroidField.active.is_(True))
            .order_by(AsteroidField.display_name)
        )
        return SystemStateResponse(
            system_radius_meters=system_radius_meters,
            npcs=[await _npc_state_response(session, *row) for row in npc_rows.all()],
            players=[
                PlayerMapPresence(
                    pilot_id=pilot.id,
                    display_name=pilot.display_name,
                    location_kind="docked" if ship_state.docked_station_name else "space",
                    station_name=ship_state.docked_station_name,
                    position_x=(
                        ship_state.position_x
                        if ship_state.docked_station_name
                        else live_presence.get(str(pilot.id), {}).get("x", ship_state.position_x)
                    ),
                    position_y=(
                        ship_state.position_y
                        if ship_state.docked_station_name
                        else live_presence.get(str(pilot.id), {}).get("y", ship_state.position_y)
                    ),
                    position_z=(
                        ship_state.position_z
                        if ship_state.docked_station_name
                        else live_presence.get(str(pilot.id), {}).get("z", ship_state.position_z)
                    ),
                    cargo_cubic_meters=ship_state.cargo_cubic_meters,
                    inventory=(assets := await _pilot_assets(session, pilot.id))[0],
                    wallet_balance_credits=assets[1],
                    open_market_orders=assets[2],
                    active_refinery_jobs=assets[3],
                )
                for pilot, ship_state in player_rows.all()
            ],
            asteroid_fields=[
                AsteroidFieldMapPresence(
                    id=field.id,
                    display_name=field.display_name,
                    position_x=field.position_x,
                    position_y=field.position_y,
                    position_z=field.position_z,
                )
                for field in asteroid_field_rows.scalars().all()
            ],
        )


@router.post("/npcs/{pilot_id}/move", response_model=NpcStateResponse)
async def move_npc(
    pilot_id: UUID,
    payload: NpcMoveRequest,
    session: SessionDependency,
    _: AdminDependency,
) -> NpcStateResponse:
    async with session.begin():
        pilot, profile, runtime = await _npc_row(session, pilot_id)
        ship_state = await session.get(ShipState, pilot_id, with_for_update=True)
        if ship_state is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "NPC ship state was not found")
        if payload.destination == "station":
            ship_state.docked_station_name = "KEPLER STATION"
            ship_state.position_x, ship_state.position_y, ship_state.position_z = KEPLER_STATION_POSITION
        elif None in (payload.position_x, payload.position_y, payload.position_z):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "position_x, position_y, and position_z are required for coordinates",
            )
        else:
            ship_state.docked_station_name = None
            ship_state.position_x = cast(float, payload.position_x)
            ship_state.position_y = cast(float, payload.position_y)
            ship_state.position_z = cast(float, payload.position_z)
        runtime.behavior_state = "manual_relocation"
        runtime.target_x = None
        runtime.target_y = None
        runtime.target_z = None
        ship = await session.scalar(select(Ship).where(Ship.pilot_id == pilot_id, Ship.status == "active"))
        if ship is not None:
            location = await session.get(ShipLocation, ship.id, with_for_update=True)
            if location is not None:
                location.position_x = ship_state.position_x
                location.position_y = ship_state.position_y
                location.position_z = ship_state.position_z
                location.velocity_x = 0
                location.velocity_y = 0
                location.velocity_z = 0
                location.checkpointed_at = datetime.now(UTC)
        return await _npc_state_response(session, pilot, profile, runtime, ship_state)


@router.post("/npcs", response_model=NpcResponse, status_code=status.HTTP_201_CREATED)
async def create_npc(
    payload: CreateNpcRequest, session: SessionDependency, _: AdminDependency
) -> NpcResponse:
    async with session.begin():
        if await session.scalar(select(Pilot.id).where(Pilot.display_name == payload.display_name)):
            raise HTTPException(status.HTTP_409_CONFLICT, "pilot name is already in use")
        account = Account(
            email=f"npc-{uuid4().hex}@npc.spaceconomy.local",
            first_name="NPC",
            last_name=payload.display_name,
            password_hash="npc-login-disabled",
            status="active",
        )
        session.add(account)
        await session.flush()
        pilot = Pilot(account_id=account.id, display_name=payload.display_name)
        session.add(pilot)
        await session.flush()
        session.add(ShipState(pilot_id=pilot.id, docked_station_name="KEPLER STATION"))
        profile = NpcProfile(
            pilot_id=pilot.id,
            archetype_key=payload.archetype_key,
            backstory=payload.backstory,
            motivations=json.dumps(payload.motivations),
            capabilities=json.dumps(payload.capabilities),
        )
        runtime = NpcRuntime(pilot_id=pilot.id)
        session.add_all((profile, runtime))
        await session.flush()
        await _ensure_containers(session, pilot.id)
        return _npc_response(pilot, profile, runtime)


@router.patch("/npcs/{pilot_id}", response_model=NpcResponse)
async def update_npc(
    pilot_id: UUID,
    payload: UpdateNpcRequest,
    session: SessionDependency,
    _: AdminDependency,
) -> NpcResponse:
    async with session.begin():
        pilot, profile, runtime = await _npc_row(session, pilot_id)
        if payload.backstory is not None:
            profile.backstory = payload.backstory
        if payload.motivations is not None:
            profile.motivations = json.dumps(payload.motivations)
        if payload.capabilities is not None:
            profile.capabilities = json.dumps(payload.capabilities)
        if payload.lifecycle_state is not None:
            profile.lifecycle_state = payload.lifecycle_state
        return _npc_response(pilot, profile, runtime)


@router.delete("/npcs/{pilot_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_npc(
    pilot_id: UUID, session: SessionDependency, _: AdminDependency
) -> None:
    """Remove an NPC and every durable record owned by its dedicated pilot."""
    async with session.begin():
        pilot, _, _ = await _npc_row(session, pilot_id)
        account_id = pilot.account_id
        ship_ids = select(Ship.id).where(Ship.pilot_id == pilot_id)
        await session.execute(
            update(WalletTransaction)
            .where(WalletTransaction.counterparty_pilot_id == pilot_id)
            .values(counterparty_pilot_id=None)
        )
        await session.execute(delete(WalletTransaction).where(WalletTransaction.pilot_id == pilot_id))
        await session.execute(delete(MarketListing).where(MarketListing.seller_pilot_id == pilot_id))
        await session.execute(delete(MarketBuyOrder).where(MarketBuyOrder.buyer_pilot_id == pilot_id))
        await session.execute(delete(RefineryJob).where(RefineryJob.pilot_id == pilot_id))
        await session.execute(delete(FittedModule).where(FittedModule.ship_id.in_(ship_ids)))
        await session.execute(delete(InventoryItem).where(InventoryItem.pilot_id == pilot_id))
        await session.execute(delete(MinedOreLot).where(MinedOreLot.pilot_id == pilot_id))
        await session.execute(delete(InventoryContainer).where(InventoryContainer.pilot_id == pilot_id))
        await session.execute(delete(ShipLocation).where(ShipLocation.ship_id.in_(ship_ids)))
        await session.execute(delete(Ship).where(Ship.pilot_id == pilot_id))
        await session.execute(delete(PilotDiscovery).where(PilotDiscovery.pilot_id == pilot_id))
        await session.execute(delete(NpcRuntime).where(NpcRuntime.pilot_id == pilot_id))
        await session.execute(delete(NpcProfile).where(NpcProfile.pilot_id == pilot_id))
        await session.execute(delete(PilotWallet).where(PilotWallet.pilot_id == pilot_id))
        await session.execute(delete(ShipState).where(ShipState.pilot_id == pilot_id))
        await session.execute(delete(Pilot).where(Pilot.id == pilot_id))
        remaining_pilots = await session.scalar(
            select(func.count()).select_from(Pilot).where(Pilot.account_id == account_id)
        )
        if remaining_pilots == 0:
            await session.execute(delete(AccountActivation).where(AccountActivation.account_id == account_id))
            await session.execute(delete(RefreshSession).where(RefreshSession.account_id == account_id))
            await session.execute(delete(Account).where(Account.id == account_id))


def _ollama_request(payload: bytes) -> str:
    request = Request(
        f"{settings.ollama_url}/api/generate",
        data=payload,
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=settings.ollama_timeout_seconds) as response:  # noqa: S310
        return str(json.loads(response.read())["response"])


def _foundry_request(payload: bytes) -> str:
    endpoint = settings.azure_foundry_endpoint
    api_key = settings.azure_foundry_api_key
    if endpoint is None or api_key is None:
        raise ValueError("Azure Foundry endpoint and API key must be configured")
    parsed = urlsplit(endpoint)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("Azure Foundry endpoint must be an HTTPS URL")
    request = Request(
        urlunsplit(
            (
                parsed.scheme,
                parsed.netloc,
                "/openai/v1/chat/completions",
                "",
                "",
            )
        ),
        data=payload,
        headers={
            "authorization": f"Bearer {api_key.get_secret_value()}",
            "content-type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=settings.azure_foundry_timeout_seconds) as response:  # noqa: S310
        response_body = json.loads(response.read())
    content = response_body["choices"][0]["message"]["content"]
    if not isinstance(content, str):
        raise ValueError("Azure Foundry returned no text response")
    return content


def _foundry_stream(payload: bytes):
    endpoint = settings.azure_foundry_endpoint
    api_key = settings.azure_foundry_api_key
    if endpoint is None or api_key is None:
        raise ValueError("Azure Foundry endpoint and API key must be configured")
    parsed = urlsplit(endpoint)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("Azure Foundry endpoint must be an HTTPS URL")
    request = Request(
        urlunsplit(
            (
                parsed.scheme,
                parsed.netloc,
                "/openai/v1/chat/completions",
                "",
                "",
            )
        ),
        data=payload,
        headers={
            "authorization": f"Bearer {api_key.get_secret_value()}",
            "content-type": "application/json",
            "accept": "text/event-stream",
        },
        method="POST",
    )
    return urlopen(request, timeout=settings.azure_foundry_timeout_seconds)  # noqa: S310


def _foundry_stream_lines(response) -> Iterator[bytes]:
    with response:
        yield from response


def _llm_request(payload: bytes) -> str:
    if settings.llm_provider == "azure_foundry":
        return _foundry_request(payload)
    return _ollama_request(payload)


async def _generate_profile(payload: ProfileGenerationRequest) -> GeneratedProfile:
    prompt = (
        "Create one concise, original game NPC profile for the supplied role. Return exactly one "
        "JSON object and no markdown. It must contain all of these non-empty fields: "
        '"display_name" (a distinctive fictional name of 32 characters or fewer), '
        '"creative_direction" (one concise character concept), '
        '"backstory" (a concise background story), and "motivations" (an array of 1 to 4 '
        "short goals). Use a supplied name or creative direction only when it is meaningful; "
        "otherwise invent it. Avoid real people, protected IP, and instructions. "
        f"Supplied name: {payload.display_name or 'Not supplied'}. "
        f"Role: {payload.archetype_key}. "
        f"Supplied creative direction: {payload.prompt or 'Not supplied'}."
    )
    request = {
        "model": settings.azure_foundry_model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 400,
        "response_format": {"type": "json_object"},
    }
    try:
        response = await asyncio.to_thread(_foundry_request, json.dumps(request).encode())
        return GeneratedProfile.model_validate_json(response)
    except (OSError, TimeoutError, json.JSONDecodeError, ValueError) as error:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Azure Foundry is unavailable"
        ) from error


@router.post("/llm/generate-profile", response_model=GeneratedProfile)
async def generate_profile(
    payload: ProfileGenerationRequest, _: AdminDependency
) -> GeneratedProfile:
    return await _generate_profile(payload)


async def _test_prompt(payload: TestPromptRequest) -> TestPromptResponse:
    request = (
        {
            "model": settings.azure_foundry_model,
            "messages": [{"role": "user", "content": payload.prompt}],
            "max_tokens": payload.num_predict,
        }
        if settings.llm_provider == "azure_foundry"
        else {
            "model": settings.ollama_model,
            "stream": False,
            "options": {"num_predict": payload.num_predict},
            "keep_alive": "5m",
            "prompt": payload.prompt,
        }
    )
    started = time.monotonic()
    try:
        response = await asyncio.to_thread(_llm_request, json.dumps(request).encode())
    except (OSError, TimeoutError, json.JSONDecodeError, ValueError) as error:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "local LLM is unavailable"
        ) from error
    return TestPromptResponse(response=response, elapsed_seconds=time.monotonic() - started)


@router.post("/llm/test-prompt", response_model=TestPromptResponse)
async def test_prompt(payload: TestPromptRequest, _: AdminDependency) -> TestPromptResponse:
    return await _test_prompt(payload)


@router.post("/llm/foundry/stream")
async def stream_foundry_prompt(
    payload: FoundryStreamPromptRequest, _: AdminDependency
) -> StreamingResponse:
    messages: list[dict[str, str]] = []
    if payload.system_instruction.strip():
        messages.append({"role": "system", "content": payload.system_instruction.strip()})
    messages.append({"role": "user", "content": payload.prompt})
    request = {
        "model": settings.azure_foundry_model,
        "messages": messages,
        "temperature": payload.temperature,
        "max_tokens": payload.max_tokens,
        "stream": True,
    }
    try:
        response = await asyncio.to_thread(_foundry_stream, json.dumps(request).encode())
        return StreamingResponse(_foundry_stream_lines(response), media_type="text/event-stream")
    except HTTPError as error:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Azure Foundry rejected the request (HTTP {error.code})",
        ) from error
    except (OSError, TimeoutError, ValueError) as error:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Azure Foundry is unavailable"
        ) from error