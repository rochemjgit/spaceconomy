"""Serialized ship/station inventory and public salvage operations."""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import _pilot_id_from_authorization
from .config import settings
from .db import get_session
from .models import (
    HullDefinition,
    InventoryContainer,
    InventoryItem,
    JettisonedItem,
    MinedOreLot,
    ModuleDefinition,
    Ship,
    ShipState,
)

router = APIRouter(prefix="/api/v1/inventory", tags=["inventory"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]
SHIP_CARGO_CAPACITY = 24.0
KEPLER_STATION_ID = UUID("4e32a9a9-5551-4e3f-9b9b-b6b6e22a4f04")
VOLUME_EPSILON = 1e-9


class InventoryItemResponse(BaseModel):
    id: UUID
    definition_id: str
    module_definition_id: UUID | None
    definition_version: int
    quantity: int
    durability: float
    volume_per_unit: float


class RawOreLotResponse(BaseModel):
    id: UUID
    asteroid_id: UUID
    composition: str
    mineral_assay: list[dict[str, object]]
    volume_cubic_meters: float


class InventoryContainerResponse(BaseModel):
    id: UUID
    name: str
    capacity_cubic_meters: float | None
    used_volume_cubic_meters: float
    items: list[InventoryItemResponse]
    raw_ore_lots: list[RawOreLotResponse]


class DockedInventoryResponse(BaseModel):
    ship: InventoryContainerResponse
    station: InventoryContainerResponse | None


class BulkInventoryResponse(DockedInventoryResponse):
    moved_volume_cubic_meters: float = 0
    remaining_stacks: int = 0


class PickupInventoryResponse(InventoryContainerResponse):
    """Keep legacy top-level ship fields while adding the common mutation snapshot."""

    ship: InventoryContainerResponse
    station: InventoryContainerResponse | None


class MergeAllRequest(BaseModel):
    container_id: UUID | None = None


class OreTransferRequest(BaseModel):
    lot_id: UUID
    source_container_id: UUID
    destination_container_id: UUID
    volume_cubic_meters: float = Field(gt=0, allow_inf_nan=False)


class OreSplitRequest(BaseModel):
    lot_id: UUID
    container_id: UUID
    volume_cubic_meters: float = Field(gt=0, allow_inf_nan=False)


class OreJettisonRequest(BaseModel):
    lot_id: UUID
    volume_cubic_meters: float = Field(gt=0, allow_inf_nan=False)
    position_x: float
    position_y: float
    position_z: float


class TransferRequest(BaseModel):
    item_id: UUID
    source_container_id: UUID
    destination_container_id: UUID
    quantity: int = Field(gt=0)


class TransferAllRequest(BaseModel):
    source_container_id: UUID
    destination_container_id: UUID


class SplitStackRequest(BaseModel):
    item_id: UUID
    container_id: UUID
    quantity: int = Field(gt=0)


class JettisonRequest(BaseModel):
    item_id: UUID
    quantity: int = Field(gt=0)
    position_x: float
    position_y: float
    position_z: float


class PickupJettisonedItemRequest(BaseModel):
    jettisoned_item_id: UUID
    position_x: float
    position_y: float
    position_z: float


class JettisonedItemResponse(BaseModel):
    id: UUID
    definition_id: str
    quantity: int
    volume_per_unit: float
    position_x: float
    position_y: float
    position_z: float
    expires_at: datetime


class JettisonInventoryResponse(JettisonedItemResponse):
    ship: InventoryContainerResponse
    station: InventoryContainerResponse | None


async def _lock_pilot_state(session: AsyncSession, pilot_id: UUID) -> ShipState:
    """First lock for inventory, fitting, mining and durable docking/checkpoint writes.

    Never acquire a public cargo row before this lock and the pilot's containers.
    SQLite tests exercise transactions, but PostgreSQL supplies the row locks.
    """
    ship_state = await session.get(ShipState, pilot_id, with_for_update=True)
    if ship_state is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pilot ship state was not found")
    return ship_state


async def _require_docked_pilot(
    session: AsyncSession, authorization: str | None
) -> tuple[UUID, ShipState]:
    pilot_id = _pilot_id_from_authorization(authorization)
    ship_state = await _lock_pilot_state(session, pilot_id)
    if ship_state.docked_station_name is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "ship must be docked to manage inventory")
    return pilot_id, ship_state


async def _ensure_containers(
    session: AsyncSession, pilot_id: UUID
) -> tuple[InventoryContainer, InventoryContainer]:
    await _lock_pilot_state(session, pilot_id)
    ship = await session.scalar(
        select(Ship).where(Ship.pilot_id == pilot_id, Ship.status == "active").with_for_update()
    )
    hull = (
        await session.get(HullDefinition, ship.hull_definition_id)
        if ship is not None
        else await session.scalar(
            select(HullDefinition)
            .where(HullDefinition.definition_id == "hull.starter_miner")
            .order_by(HullDefinition.version.desc())
        )
    )
    if hull is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "ship catalog is unavailable")
    if ship is None:
        ship = Ship(pilot_id=pilot_id, hull_definition_id=hull.id, name="STARTER CORVETTE")
        session.add(ship)
        await session.flush()

    containers = list(
        await session.scalars(
            select(InventoryContainer)
            .where(InventoryContainer.pilot_id == pilot_id)
            .with_for_update()
        )
    )
    ship_container = next(
        (container for container in containers if container.ship_id == ship.id), None
    )
    station_container = next(
        (container for container in containers if container.station_id == KEPLER_STATION_ID), None
    )
    if ship_container is None:
        ship_container = InventoryContainer(
            pilot_id=pilot_id,
            ship_id=ship.id,
            container_type="ship_cargo",
            capacity_cubic_meters=float(
                json.loads(hull.base_statistics).get("cargo_volume", SHIP_CARGO_CAPACITY)
            ),
        )
        session.add(ship_container)
    station_created = station_container is None
    if station_container is None:
        station_container = InventoryContainer(
            pilot_id=pilot_id,
            station_id=KEPLER_STATION_ID,
            container_type="station_storage",
            capacity_cubic_meters=0,
        )
        session.add(station_container)
    await session.flush()
    if station_created:
        module_definitions = list(
            await session.scalars(select(ModuleDefinition).where(ModuleDefinition.active.is_(True)))
        )
        for definition in module_definitions:
            session.add(
                InventoryItem(
                    pilot_id=pilot_id,
                    container_id=station_container.id,
                    module_definition_id=definition.id,
                    definition_id=definition.definition_id,
                    definition_version=definition.version,
                    quantity=1,
                    durability=definition.durability_maximum,
                    volume_per_unit=definition.volume_cubic_meters,
                )
            )
        await session.flush()
    return ship_container, station_container


async def _items_for_container(session: AsyncSession, container_id: UUID) -> list[InventoryItem]:
    return list(
        await session.scalars(
            select(InventoryItem)
            .where(InventoryItem.container_id == container_id)
            .order_by(InventoryItem.definition_id, InventoryItem.created_at)
        )
    )


async def _ore_for_container(session: AsyncSession, container_id: UUID) -> list[MinedOreLot]:
    return list(
        await session.scalars(
            select(MinedOreLot)
            .where(MinedOreLot.container_id == container_id)
            .order_by(MinedOreLot.created_at, MinedOreLot.id)
        )
    )


async def _used_volume(session: AsyncSession, container_id: UUID) -> float:
    return math.fsum(
        [
            item.quantity * item.volume_per_unit
            for item in await _items_for_container(session, container_id)
        ]
        + [lot.volume_cubic_meters for lot in await _ore_for_container(session, container_id)]
    )


async def _available_volume(session: AsyncSession, container: InventoryContainer) -> float:
    if container.container_type == "station_storage":
        return math.inf
    # Keep any negative residual so repeated epsilon-sized transfers cannot grow
    # an overfull hold beyond the single permitted round-off tolerance.
    return container.capacity_cubic_meters - await _used_volume(session, container.id)


def _available_containers(
    state: ShipState, ship: InventoryContainer, station: InventoryContainer
) -> dict[UUID, InventoryContainer]:
    available = {ship.id: ship}
    if state.docked_station_name is not None:
        available[station.id] = station
    return available


def _container_response(
    container: InventoryContainer,
    items: list[InventoryItem],
    raw_ore_lots: list[MinedOreLot] | None = None,
) -> InventoryContainerResponse:
    raw_ore_lots = raw_ore_lots or []
    return InventoryContainerResponse(
        id=container.id,
        name="SHIP CARGO" if container.container_type == "ship_cargo" else "KEPLER STATION",
        capacity_cubic_meters=(
            None
            if container.container_type == "station_storage"
            else container.capacity_cubic_meters
        ),
        used_volume_cubic_meters=(
            math.fsum(
                [item.quantity * item.volume_per_unit for item in items]
                + [lot.volume_cubic_meters for lot in raw_ore_lots]
            )
        ),
        items=[InventoryItemResponse.model_validate(item, from_attributes=True) for item in items],
        raw_ore_lots=[
            RawOreLotResponse(
                id=lot.id,
                asteroid_id=lot.asteroid_id,
                composition=lot.composition,
                mineral_assay=json.loads(lot.mineral_assay),
                volume_cubic_meters=lot.volume_cubic_meters,
            )
            for lot in raw_ore_lots
        ],
    )


async def _snapshot(
    session: AsyncSession, ship_container: InventoryContainer, station_container: InventoryContainer
) -> DockedInventoryResponse:
    await session.flush()
    state = await _lock_pilot_state(session, ship_container.pilot_id)
    ship_items = await _items_for_container(session, ship_container.id)
    raw_ore_lots = await _ore_for_container(session, ship_container.id)
    ship = _container_response(ship_container, ship_items, raw_ore_lots)
    state.cargo_cubic_meters = ship.used_volume_cubic_meters
    station = None
    if state.docked_station_name is not None:
        station = _container_response(
            station_container,
            await _items_for_container(session, station_container.id),
            await _ore_for_container(session, station_container.id),
        )
    return DockedInventoryResponse(
        ship=ship,
        station=station,
    )


async def _transfer(
    session: AsyncSession,
    pilot_id: UUID,
    source: InventoryContainer,
    destination: InventoryContainer,
    item: InventoryItem,
    quantity: int,
) -> int:
    if source.id == destination.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "choose a different inventory")
    if item.quantity < quantity:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "insufficient item quantity")
    if (
        quantity * item.volume_per_unit
        > await _available_volume(session, destination) + VOLUME_EPSILON
    ):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "ship cargo capacity exceeded")
    matching_item = None
    if item.module_definition_id is None:
        matching_item = await session.scalar(
            select(InventoryItem)
            .where(
                InventoryItem.container_id == destination.id,
                InventoryItem.module_definition_id.is_(None),
                InventoryItem.definition_id == item.definition_id,
                InventoryItem.definition_version == item.definition_version,
                InventoryItem.durability == item.durability,
                InventoryItem.volume_per_unit == item.volume_per_unit,
            )
            .with_for_update()
        )
    if quantity == item.quantity and matching_item is None:
        item.container_id = destination.id
    elif matching_item is not None:
        matching_item.quantity += quantity
        if quantity == item.quantity:
            await session.delete(item)
        else:
            item.quantity -= quantity
    else:
        item.quantity -= quantity
        session.add(
            InventoryItem(
                pilot_id=pilot_id,
                container_id=destination.id,
                module_definition_id=item.module_definition_id,
                definition_id=item.definition_id,
                definition_version=item.definition_version,
                quantity=quantity,
                durability=item.durability,
                volume_per_unit=item.volume_per_unit,
            )
        )
    return quantity


async def _merge_container_stacks(session: AsyncSession, container_id: UUID) -> None:
    items = await _items_for_container(session, container_id)
    merged: dict[tuple[str, int, float, float, UUID | None], InventoryItem] = {}
    for item in items:
        if item.module_definition_id is not None:
            continue
        key = (
            item.definition_id,
            item.definition_version,
            item.durability,
            item.volume_per_unit,
            item.module_definition_id,
        )
        existing = merged.get(key)
        if existing is None:
            merged[key] = item
        else:
            existing.quantity += item.quantity
            await session.delete(item)
    ore: dict[tuple[UUID, str, str], MinedOreLot] = {}
    for lot in await _ore_for_container(session, container_id):
        ore_key = (lot.asteroid_id, lot.composition, lot.mineral_assay)
        existing_lot = ore.get(ore_key)
        if existing_lot is None:
            ore[ore_key] = lot
        else:
            existing_lot.volume_cubic_meters += lot.volume_cubic_meters
            await session.delete(lot)


def _validate_system_position(position: tuple[float, float, float]) -> None:
    # Realtime is a client-reported Redis relay, not an authoritative simulation.
    # ShipState positions are checkpoints; enforcing them here would reject flight.
    if not all(
        math.isfinite(value) and abs(value) <= settings.system_radius_meters for value in position
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "local position is outside the system boundary",
        )


def _jettisoned_item_response(item: JettisonedItem) -> JettisonedItemResponse:
    return JettisonedItemResponse.model_validate(item, from_attributes=True)


async def expire_jettisoned_items(session: AsyncSession, now: datetime | None = None) -> None:
    """Purge public cargo whose configured lifetime has elapsed."""
    expires_before = now or datetime.now(UTC)
    await session.execute(delete(JettisonedItem).where(JettisonedItem.expires_at <= expires_before))


@router.get("/docked", response_model=DockedInventoryResponse)
async def docked_inventory(
    session: SessionDependency, authorization: Annotated[str | None, Header()] = None
) -> DockedInventoryResponse:
    """Return the active pilot's docked ship cargo and unlimited station storage."""
    async with session.begin():
        pilot_id, _ = await _require_docked_pilot(session, authorization)
        ship_container, station_container = await _ensure_containers(session, pilot_id)
        return await _snapshot(session, ship_container, station_container)


@router.get("/ship", response_model=InventoryContainerResponse)
async def ship_inventory(
    session: SessionDependency, authorization: Annotated[str | None, Header()] = None
) -> InventoryContainerResponse:
    """Return the active pilot's cargo inventory from anywhere in the system."""
    async with session.begin():
        pilot_id = _pilot_id_from_authorization(authorization)
        ship_container, station_container = await _ensure_containers(session, pilot_id)
        return (await _snapshot(session, ship_container, station_container)).ship


@router.get("/jettisoned", response_model=list[JettisonedItemResponse])
async def local_jettisoned_items(
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
    position_x: float = 0,
    position_y: float = 0,
    position_z: float = 0,
) -> list[JettisonedItemResponse]:
    """Return every unexpired public cargo object in the caller's nearby render area."""
    _pilot_id_from_authorization(authorization)
    position = (position_x, position_y, position_z)
    _validate_system_position(position)
    async with session.begin():
        await expire_jettisoned_items(session)
        candidates = list(await session.scalars(select(JettisonedItem)))
        return [
            _jettisoned_item_response(item)
            for item in candidates
            if math.dist(position, (item.position_x, item.position_y, item.position_z))
            <= settings.object_render_radius_meters
        ]


@router.post("/jettison", response_model=JettisonInventoryResponse)
async def jettison_item(
    payload: JettisonRequest,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> JettisonInventoryResponse:
    """Drop cargo in space as a public object that expires after a bounded lifetime."""
    position = (payload.position_x, payload.position_y, payload.position_z)
    _validate_system_position(position)
    async with session.begin():
        pilot_id = _pilot_id_from_authorization(authorization)
        ship_state = await _lock_pilot_state(session, pilot_id)
        if ship_state.docked_station_name:
            raise HTTPException(status.HTTP_409_CONFLICT, "undock before jettisoning cargo")
        ship_container, station_container = await _ensure_containers(session, pilot_id)
        item = await session.scalar(
            select(InventoryItem)
            .where(
                InventoryItem.id == payload.item_id,
                InventoryItem.container_id == ship_container.id,
            )
            .with_for_update()
        )
        if item is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "ship cargo item was not found")
        if payload.quantity > item.quantity:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "insufficient item quantity")
        jettisoned_item = JettisonedItem(
            definition_id=item.definition_id,
            definition_version=item.definition_version,
            module_definition_id=item.module_definition_id,
            quantity=payload.quantity,
            durability=item.durability,
            volume_per_unit=item.volume_per_unit,
            position_x=position[0],
            position_y=position[1],
            position_z=position[2],
            expires_at=datetime.now(UTC) + timedelta(seconds=settings.jettison_expiry_seconds),
        )
        session.add(jettisoned_item)
        if payload.quantity == item.quantity:
            await session.delete(item)
        else:
            item.quantity -= payload.quantity
        await session.flush()
        snapshot = await _snapshot(session, ship_container, station_container)
        return JettisonInventoryResponse(
            **_jettisoned_item_response(jettisoned_item).model_dump(),
            **snapshot.model_dump(),
        )


@router.post("/jettisoned/pickup", response_model=PickupInventoryResponse)
async def pickup_jettisoned_item(
    payload: PickupJettisonedItemRequest,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> PickupInventoryResponse:
    """Move a public nearby cargo object into the caller's ship hold with no ownership check."""
    position = (payload.position_x, payload.position_y, payload.position_z)
    _validate_system_position(position)
    async with session.begin():
        pilot_id = _pilot_id_from_authorization(authorization)
        ship_state = await _lock_pilot_state(session, pilot_id)
        if ship_state.docked_station_name:
            raise HTTPException(status.HTTP_409_CONFLICT, "undock before collecting cargo")
        ship_container, station_container = await _ensure_containers(session, pilot_id)
        item = await session.scalar(
            select(JettisonedItem)
            .where(
                JettisonedItem.id == payload.jettisoned_item_id,
                JettisonedItem.expires_at > datetime.now(UTC),
            )
            .with_for_update()
        )
        if item is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "jettisoned cargo is unavailable")
        if (
            math.dist(position, (item.position_x, item.position_y, item.position_z))
            > settings.jettison_pickup_range_meters
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, "jettisoned cargo is out of pickup range")
        if (
            item.quantity * item.volume_per_unit
            > await _available_volume(session, ship_container) + VOLUME_EPSILON
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, "ship cargo capacity exceeded")
        if item.ore_asteroid_id is not None:
            session.add(
                MinedOreLot(
                    pilot_id=pilot_id,
                    container_id=ship_container.id,
                    asteroid_id=item.ore_asteroid_id,
                    composition=item.ore_composition,
                    mineral_assay=item.ore_mineral_assay,
                    volume_cubic_meters=item.volume_per_unit,
                )
            )
        else:
            matching_item = None
            if item.module_definition_id is None:
                matching_item = await session.scalar(
                    select(InventoryItem)
                    .where(
                        InventoryItem.container_id == ship_container.id,
                        InventoryItem.module_definition_id.is_(None),
                        InventoryItem.definition_id == item.definition_id,
                        InventoryItem.definition_version == item.definition_version,
                        InventoryItem.durability == item.durability,
                        InventoryItem.volume_per_unit == item.volume_per_unit,
                    )
                    .with_for_update()
                )
            if matching_item is None:
                session.add(
                    InventoryItem(
                        pilot_id=pilot_id,
                        container_id=ship_container.id,
                        module_definition_id=item.module_definition_id,
                        definition_id=item.definition_id,
                        definition_version=item.definition_version,
                        quantity=item.quantity,
                        durability=item.durability,
                        volume_per_unit=item.volume_per_unit,
                    )
                )
            else:
                matching_item.quantity += item.quantity
        await session.delete(item)
        snapshot = await _snapshot(session, ship_container, station_container)
        return PickupInventoryResponse(**snapshot.ship.model_dump(), **snapshot.model_dump())


@router.post("/transfer", response_model=DockedInventoryResponse)
async def transfer(
    payload: TransferRequest,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> DockedInventoryResponse:
    """Atomically move a stack, or part of one, between the two docked inventories."""
    async with session.begin():
        pilot_id, _ = await _require_docked_pilot(session, authorization)
        ship_container, station_container = await _ensure_containers(session, pilot_id)
        containers = {ship_container.id: ship_container, station_container.id: station_container}
        source = containers.get(payload.source_container_id)
        destination = containers.get(payload.destination_container_id)
        if source is None or destination is None:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "inventory is not available at this station"
            )
        item = await session.scalar(
            select(InventoryItem)
            .where(InventoryItem.id == payload.item_id, InventoryItem.container_id == source.id)
            .with_for_update()
        )
        if item is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "inventory item was not found")
        await _transfer(session, pilot_id, source, destination, item, payload.quantity)
        await session.flush()
        return await _snapshot(session, ship_container, station_container)


@router.post("/transfer-all", response_model=BulkInventoryResponse)
async def transfer_all(
    payload: TransferAllRequest,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> BulkInventoryResponse:
    """Move every stack that fits from one docked inventory to the other."""
    async with session.begin():
        pilot_id, _ = await _require_docked_pilot(session, authorization)
        ship_container, station_container = await _ensure_containers(session, pilot_id)
        containers = {ship_container.id: ship_container, station_container.id: station_container}
        source = containers.get(payload.source_container_id)
        destination = containers.get(payload.destination_container_id)
        if source is None or destination is None or source.id == destination.id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "choose two docked inventories"
            )
        moved_volume = 0.0
        for item in await _items_for_container(session, source.id):
            available = await _available_volume(session, destination)
            quantity = item.quantity
            if math.isfinite(available) and item.volume_per_unit > 0:
                quantity = min(
                    quantity, math.floor((available + VOLUME_EPSILON) / item.volume_per_unit)
                )
            if quantity <= 0:
                continue
            moved_volume += quantity * item.volume_per_unit
            await _transfer(session, pilot_id, source, destination, item, quantity)
            await session.flush()
        for lot in await _ore_for_container(session, source.id):
            volume = min(lot.volume_cubic_meters, await _available_volume(session, destination))
            if volume <= 0:
                continue
            moved_volume += await _transfer_ore(session, lot, destination, volume)
            await session.flush()
        await session.flush()
        remaining = len(await _items_for_container(session, source.id)) + len(
            await _ore_for_container(session, source.id)
        )
        snapshot = await _snapshot(session, ship_container, station_container)
        return BulkInventoryResponse(
            **snapshot.model_dump(),
            moved_volume_cubic_meters=moved_volume,
            remaining_stacks=remaining,
        )


@router.post("/split", response_model=DockedInventoryResponse)
async def split_stack(
    payload: SplitStackRequest,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> DockedInventoryResponse:
    """Split an accessible stack; station access requires docking."""
    async with session.begin():
        pilot_id = _pilot_id_from_authorization(authorization)
        state = await _lock_pilot_state(session, pilot_id)
        ship_container, station_container = await _ensure_containers(session, pilot_id)
        containers = _available_containers(state, ship_container, station_container)
        if payload.container_id not in containers:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "inventory is not available at this station"
            )
        item = await session.scalar(
            select(InventoryItem)
            .where(
                InventoryItem.id == payload.item_id,
                InventoryItem.container_id == payload.container_id,
            )
            .with_for_update()
        )
        if item is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "inventory item was not found")
        if item.module_definition_id is not None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "module items cannot be split"
            )
        if payload.quantity >= item.quantity:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "split quantity must be smaller than the stack",
            )
        item.quantity -= payload.quantity
        session.add(
            InventoryItem(
                pilot_id=pilot_id,
                container_id=item.container_id,
                module_definition_id=item.module_definition_id,
                definition_id=item.definition_id,
                definition_version=item.definition_version,
                quantity=payload.quantity,
                durability=item.durability,
                volume_per_unit=item.volume_per_unit,
            )
        )
        await session.flush()
        return await _snapshot(session, ship_container, station_container)


@router.post("/merge-all", response_model=DockedInventoryResponse)
async def merge_all(
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
    payload: MergeAllRequest | None = None,
) -> DockedInventoryResponse:
    """Consolidate a selected accessible container, or every available container."""
    async with session.begin():
        pilot_id = _pilot_id_from_authorization(authorization)
        state = await _lock_pilot_state(session, pilot_id)
        ship_container, station_container = await _ensure_containers(session, pilot_id)
        available = _available_containers(state, ship_container, station_container)
        if payload is not None and payload.container_id is not None:
            if payload.container_id not in available:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "inventory is not available here")
            available = {payload.container_id: available[payload.container_id]}
        for container_id in available:
            await _merge_container_stacks(session, container_id)
        await session.flush()
        return await _snapshot(session, ship_container, station_container)


async def _locked_ore(session: AsyncSession, lot_id: UUID, container_id: UUID) -> MinedOreLot:
    lot = await session.scalar(
        select(MinedOreLot)
        .where(MinedOreLot.id == lot_id, MinedOreLot.container_id == container_id)
        .with_for_update()
    )
    if lot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ore lot was not found")
    return lot


def _ore_quantity(lot: MinedOreLot, requested: float) -> float:
    if requested > lot.volume_cubic_meters + VOLUME_EPSILON:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "insufficient ore volume")
    # Only normalize a round-off overshoot, never silently under-fill a request.
    return min(requested, lot.volume_cubic_meters)


def _copy_ore(lot: MinedOreLot, container_id: UUID, volume: float) -> MinedOreLot:
    return MinedOreLot(
        pilot_id=lot.pilot_id,
        container_id=container_id,
        asteroid_id=lot.asteroid_id,
        composition=lot.composition,
        mineral_assay=lot.mineral_assay,
        volume_cubic_meters=volume,
    )


async def _transfer_ore(
    session: AsyncSession, lot: MinedOreLot, destination: InventoryContainer, requested: float
) -> float:
    if lot.container_id == destination.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "choose a different inventory")
    volume = _ore_quantity(lot, requested)
    if volume > await _available_volume(session, destination) + VOLUME_EPSILON:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "ship cargo capacity exceeded")
    if volume == lot.volume_cubic_meters:
        lot.container_id = destination.id
    else:
        lot.volume_cubic_meters -= volume
        session.add(_copy_ore(lot, destination.id, volume))
    return volume


@router.post("/ore/transfer", response_model=DockedInventoryResponse)
async def transfer_ore(
    payload: OreTransferRequest,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> DockedInventoryResponse:
    """Move an exact ore volume, retaining its source and assay, while docked."""
    async with session.begin():
        pilot_id, _ = await _require_docked_pilot(session, authorization)
        ship, station = await _ensure_containers(session, pilot_id)
        containers = {ship.id: ship, station.id: station}
        if (
            payload.source_container_id not in containers
            or payload.destination_container_id not in containers
        ):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "inventory is not available at this station"
            )
        lot = await _locked_ore(session, payload.lot_id, payload.source_container_id)
        await _transfer_ore(
            session, lot, containers[payload.destination_container_id], payload.volume_cubic_meters
        )
        return await _snapshot(session, ship, station)


@router.post("/ore/split", response_model=DockedInventoryResponse)
async def split_ore(
    payload: OreSplitRequest,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> DockedInventoryResponse:
    """Split an accessible lot without altering its source or assay."""
    async with session.begin():
        pilot_id = _pilot_id_from_authorization(authorization)
        state = await _lock_pilot_state(session, pilot_id)
        ship, station = await _ensure_containers(session, pilot_id)
        if payload.container_id not in _available_containers(state, ship, station):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "inventory is not available here")
        lot = await _locked_ore(session, payload.lot_id, payload.container_id)
        if payload.volume_cubic_meters >= lot.volume_cubic_meters:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "split volume must be smaller than the lot"
            )
        lot.volume_cubic_meters -= payload.volume_cubic_meters
        session.add(_copy_ore(lot, lot.container_id, payload.volume_cubic_meters))
        return await _snapshot(session, ship, station)


@router.post("/ore/jettison", response_model=JettisonInventoryResponse)
async def jettison_ore(
    payload: OreJettisonRequest,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> JettisonInventoryResponse:
    """Drop a partial or full ore lot as public salvage with immutable metadata."""
    position = (payload.position_x, payload.position_y, payload.position_z)
    _validate_system_position(position)
    async with session.begin():
        pilot_id = _pilot_id_from_authorization(authorization)
        state = await _lock_pilot_state(session, pilot_id)
        if state.docked_station_name is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "undock before jettisoning cargo")
        ship, station = await _ensure_containers(session, pilot_id)
        lot = await _locked_ore(session, payload.lot_id, ship.id)
        volume = _ore_quantity(lot, payload.volume_cubic_meters)
        public = JettisonedItem(
            definition_id="ore.raw",
            definition_version=1,
            module_definition_id=None,
            quantity=1,
            durability=0,
            volume_per_unit=volume,
            ore_asteroid_id=lot.asteroid_id,
            ore_composition=lot.composition,
            ore_mineral_assay=lot.mineral_assay,
            position_x=position[0],
            position_y=position[1],
            position_z=position[2],
            expires_at=datetime.now(UTC) + timedelta(seconds=settings.jettison_expiry_seconds),
        )
        session.add(public)
        if volume == lot.volume_cubic_meters:
            await session.delete(lot)
        else:
            lot.volume_cubic_meters -= volume
        snapshot = await _snapshot(session, ship, station)
        return JettisonInventoryResponse(
            **_jettisoned_item_response(public).model_dump(), **snapshot.model_dump()
        )
