"""Persistent docked fitting commands backed by inventory module objects."""

from __future__ import annotations

import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import _pilot_id_from_authorization
from .db import get_session
from .fitting import (
    FittingError,
    FittingService,
    HullDefinition as DomainHullDefinition,
    ModuleDefinition as DomainModuleDefinition,
    ModuleItem,
    ModifierOperation,
    SlotLocation,
    StatisticModifier,
)
from .inventory import _ensure_containers, _require_docked_pilot
from .models import FittedModule, HullDefinition, InventoryItem, ModuleDefinition, ModuleEffect, Ship

router = APIRouter(prefix="/api/v1/fitting", tags=["fitting"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]


class FitModuleRequest(BaseModel):
    item_id: UUID
    slot_location: SlotLocation
    slot_index: int = Field(ge=0)


class UnfitModuleRequest(BaseModel):
    slot_location: SlotLocation
    slot_index: int = Field(ge=0)


class FittedModuleResponse(BaseModel):
    item_id: UUID
    definition_id: str
    display_name: str
    family: str
    slot_location: SlotLocation
    slot_index: int
    durability: float
    mass_kg: float


class FittingSnapshotResponse(BaseModel):
    ship_id: UUID
    hull_definition_id: str
    universal_hardpoint_count: int
    core_system_slot_count: int
    fitted_modules: list[FittedModuleResponse]
    statistics: dict[str, float]


async def _domain_module_definition(
    session: AsyncSession, definition: ModuleDefinition
) -> DomainModuleDefinition:
    effects = list(
        await session.scalars(
            select(ModuleEffect)
            .where(ModuleEffect.module_definition_id == definition.id)
            .order_by(ModuleEffect.effect_index)
        )
    )
    return DomainModuleDefinition(
        definition_id=definition.definition_id,
        version=definition.version,
        display_name=definition.display_name,
        family=definition.family,
        fit_location=SlotLocation(definition.fit_location),
        cpu_demand=definition.cpu_demand,
        powergrid_demand=definition.powergrid_demand,
        durability_maximum=definition.durability_maximum,
        mass_kg=definition.mass_kg,
        volume_cubic_meters=definition.volume_cubic_meters,
        passive_effects=tuple(
            StatisticModifier(
                statistic=effect.statistic,
                operation=ModifierOperation(effect.operation),
                value=effect.value,
            )
            for effect in effects
        ),
    )


async def _service_for_ship(
    session: AsyncSession,
    pilot_id: UUID,
    ship: Ship,
    station_container_id: UUID,
) -> tuple[FittingService, dict[UUID, ModuleDefinition]]:
    hull = await session.get(HullDefinition, ship.hull_definition_id)
    if hull is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "ship hull catalog is unavailable")
    definitions = {
        definition.id: definition
        for definition in await session.scalars(select(ModuleDefinition).where(ModuleDefinition.active.is_(True)))
    }
    service = FittingService(
        ship_id=str(ship.id),
        owner_id=str(pilot_id),
        hull=DomainHullDefinition(
            definition_id=hull.definition_id,
            version=hull.version,
            display_name=hull.display_name,
            universal_hardpoint_count=hull.universal_hardpoint_count,
            core_system_slot_count=hull.core_system_slot_count,
            base_statistics=json.loads(hull.base_statistics),
        ),
        station_id=str(station_container_id),
    )
    station_items = list(
        await session.scalars(
            select(InventoryItem).where(
                InventoryItem.container_id == station_container_id,
                InventoryItem.module_definition_id.is_not(None),
            )
        )
    )
    fitted_rows = list(
        (await session.execute(
            select(FittedModule, InventoryItem)
            .join(InventoryItem, InventoryItem.id == FittedModule.inventory_item_id)
            .where(FittedModule.ship_id == ship.id)
            .with_for_update()
        )).all()
    )
    for item in station_items:
        if item.module_definition_id is None or item.quantity != 1:
            continue
        definition = definitions.get(item.module_definition_id)
        if definition is None:
            continue
        service.add_station_item(
            ModuleItem(
                item_id=str(item.id),
                definition=await _domain_module_definition(session, definition),
                station_id=str(station_container_id),
                owner_id=str(pilot_id),
                durability=item.durability,
            )
        )
    for fitted, item in fitted_rows:
        definition = definitions.get(fitted.module_definition_id)
        if definition is None:
            continue
        service._fitted[(SlotLocation(fitted.slot_location), fitted.slot_index)] = ModuleItem(
            item_id=str(item.id),
            definition=await _domain_module_definition(session, definition),
            station_id=str(station_container_id),
            owner_id=str(pilot_id),
            durability=fitted.durability,
        )
    return service, definitions


async def _snapshot_response(
    service: FittingService,
    definitions: dict[UUID, ModuleDefinition],
    fitted_rows: list[FittedModule] | None = None,
) -> FittingSnapshotResponse:
    snapshot = service.snapshot()
    definition_by_key = {
        (definition.definition_id, definition.version): definition
        for definition in definitions.values()
    }
    fitted_modules = []
    for fitted in snapshot.fitted_modules:
        definition = definition_by_key[(fitted.definition_id, fitted.definition_version)]
        fitted_modules.append(
            FittedModuleResponse(
                item_id=UUID(fitted.item_id),
                definition_id=fitted.definition_id,
                display_name=definition.display_name,
                family=definition.family,
                slot_location=fitted.slot_location,
                slot_index=fitted.slot_index,
                durability=fitted.durability,
                mass_kg=definition.mass_kg,
            )
        )
    return FittingSnapshotResponse(
        ship_id=UUID(snapshot.ship_id),
        hull_definition_id=snapshot.hull_definition_id,
        universal_hardpoint_count=service.hull.universal_hardpoint_count,
        core_system_slot_count=service.hull.core_system_slot_count,
        fitted_modules=fitted_modules,
        statistics=snapshot.statistics,
    )


async def _locked_ship(session: AsyncSession, pilot_id: UUID) -> Ship:
    ship = await session.scalar(select(Ship).where(Ship.pilot_id == pilot_id).with_for_update())
    if ship is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "active ship was not found")
    return ship


@router.get("/docked", response_model=FittingSnapshotResponse)
async def docked_fitting(
    session: SessionDependency, authorization: Annotated[str | None, Header()] = None
) -> FittingSnapshotResponse:
    """Return derived statistics and fitted module objects for the docked ship."""
    async with session.begin():
        pilot_id, _ = await _require_docked_pilot(session, authorization)
        _, station_container = await _ensure_containers(session, pilot_id)
        ship = await _locked_ship(session, pilot_id)
        service, definitions = await _service_for_ship(session, pilot_id, ship, station_container.id)
        return await _snapshot_response(service, definitions)


@router.post("/fit", response_model=FittingSnapshotResponse)
async def fit_module(
    payload: FitModuleRequest,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> FittingSnapshotResponse:
    """Move one module object from docked station storage into an empty ship slot."""
    async with session.begin():
        pilot_id, _ = await _require_docked_pilot(session, authorization)
        _, station_container = await _ensure_containers(session, pilot_id)
        ship = await _locked_ship(session, pilot_id)
        item = await session.scalar(
            select(InventoryItem)
            .where(
                InventoryItem.id == payload.item_id,
                InventoryItem.pilot_id == pilot_id,
                InventoryItem.container_id == station_container.id,
                InventoryItem.module_definition_id.is_not(None),
                InventoryItem.quantity == 1,
            )
            .with_for_update()
        )
        if item is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "station module item was not found")
        service, definitions = await _service_for_ship(session, pilot_id, ship, station_container.id)
        try:
            awaitable_result = service.fit(
                str(item.id), payload.slot_location, payload.slot_index, f"fit:{item.id}:{payload.slot_location}:{payload.slot_index}"
            )
        except FittingError as error:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error.code) from error
        if item.module_definition_id is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "module definition is unavailable")
        item.container_id = None
        session.add(
            FittedModule(
                ship_id=ship.id,
                inventory_item_id=item.id,
                module_definition_id=item.module_definition_id,
                slot_location=payload.slot_location.value,
                slot_index=payload.slot_index,
                durability=item.durability,
            )
        )
        await session.flush()
        return await _snapshot_response(service, definitions)


@router.post("/unfit", response_model=FittingSnapshotResponse)
async def unfit_module(
    payload: UnfitModuleRequest,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> FittingSnapshotResponse:
    """Move one fitted module object back to docked station storage."""
    async with session.begin():
        pilot_id, _ = await _require_docked_pilot(session, authorization)
        _, station_container = await _ensure_containers(session, pilot_id)
        ship = await _locked_ship(session, pilot_id)
        fitted = await session.scalar(
            select(FittedModule)
            .where(
                FittedModule.ship_id == ship.id,
                FittedModule.slot_location == payload.slot_location.value,
                FittedModule.slot_index == payload.slot_index,
            )
            .with_for_update()
        )
        if fitted is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "fitted module was not found")
        item = await session.get(InventoryItem, fitted.inventory_item_id, with_for_update=True)
        if item is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "fitted module item is unavailable")
        service, definitions = await _service_for_ship(session, pilot_id, ship, station_container.id)
        try:
            service.unfit(
                payload.slot_location,
                payload.slot_index,
                f"unfit:{ship.id}:{payload.slot_location}:{payload.slot_index}",
            )
        except FittingError as error:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error.code) from error
        item.container_id = station_container.id
        await session.delete(fitted)
        await session.flush()
        return await _snapshot_response(service, definitions)
