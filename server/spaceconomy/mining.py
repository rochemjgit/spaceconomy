"""Authoritative asteroid-field discovery APIs."""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import _pilot_id_from_authorization
from .config import settings
from .db import get_session
from .inventory import (
    VOLUME_EPSILON,
    _ensure_containers,
    _lock_pilot_state,
    _ore_for_container,
    _used_volume,
)
from .models import Asteroid, AsteroidField, MinedOreLot, PilotDiscovery, ShipState, SolarSystem

router = APIRouter(prefix="/api/v1/mining", tags=["mining"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]


class SystemDefinitionResponse(BaseModel):
    """Client-safe scale and local rendering configuration for a system."""

    system_key: str
    display_name: str
    radius_meters: float
    crossing_seconds: float
    warp_cruise_speed_meters_per_second: float
    object_render_radius_meters: float


class DiscoveredFieldResponse(BaseModel):
    """A pilot-visible field that may be selected as a warp destination."""

    id: UUID
    display_name: str
    position_x: float
    position_y: float
    position_z: float
    distance_meters: float
    scan_quality: float


class DiscoveryBootstrapResponse(BaseModel):
    """All map-visible mining discoveries for the authenticated pilot."""

    system: SystemDefinitionResponse
    discovered_fields: list[DiscoveredFieldResponse]


class ScanResponse(BaseModel):
    """The fields newly revealed by a completed sensor ping."""

    newly_discovered_fields: list[DiscoveredFieldResponse]
    power_megajoules: float
    cooldown_seconds: float


class AsteroidResponse(BaseModel):
    """A renderable asteroid inside the authenticated pilot's local interest area."""

    id: UUID
    field_id: UUID
    position_x: float
    position_y: float
    position_z: float
    radius_meters: float
    composition: str
    mineral_assay: list[dict[str, object]]
    initial_volume_cubic_meters: float
    remaining_volume_cubic_meters: float


class ExtractionRequest(BaseModel):
    asteroid_id: UUID
    position_x: float
    position_y: float
    position_z: float


class ExtractionResponse(BaseModel):
    asteroid_id: UUID
    mined_ore_lot_id: UUID
    composition: str
    mineral_assay: list[dict[str, object]]
    mined_ore_lot_volume_cubic_meters: float
    extracted_ore_cubic_meters: float
    remaining_ore_cubic_meters: float
    cargo_cubic_meters: float


class MinedOreLotResponse(BaseModel):
    id: UUID
    asteroid_id: UUID
    composition: str
    mineral_assay: list[dict[str, object]]
    volume_cubic_meters: float


def _combined_mineral_assay(
    existing_assay: str, existing_volume: float, extracted_assay: str, extracted_volume: float
) -> str:
    weighted_percentages: dict[tuple[str, int], float] = {}
    for assay, volume in ((existing_assay, existing_volume), (extracted_assay, extracted_volume)):
        for entry in json.loads(assay):
            definition_id = str(entry["definition_id"])
            definition_version = int(entry.get("definition_version", entry.get("version", 1)))
            weighted_percentages[definition_id, definition_version] = (
                weighted_percentages.get((definition_id, definition_version), 0)
                + float(entry["percentage"]) * volume
            )
    total_volume = existing_volume + extracted_volume
    return json.dumps(
        [
            {
                "definition_id": definition_id,
                "definition_version": definition_version,
                "percentage": round(weighted_percentage / total_volume, 3),
            }
            for (definition_id, definition_version), weighted_percentage in sorted(
                weighted_percentages.items()
            )
        ],
        separators=(",", ":"),
    )


def _distance(ship_state: ShipState, field: AsteroidField) -> float:
    return math.dist(
        (ship_state.position_x, ship_state.position_y, ship_state.position_z),
        (field.position_x, field.position_y, field.position_z),
    )


def _position_distance(position: tuple[float, float, float], field: AsteroidField) -> float:
    return math.dist(position, (field.position_x, field.position_y, field.position_z))


def _validate_system_position(position: tuple[float, float, float]) -> None:
    if not all(
        math.isfinite(value) and abs(value) <= settings.system_radius_meters for value in position
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "local position is outside the system boundary"
        )


def _field_response(
    field: AsteroidField, distance_meters: float, scan_quality: float
) -> DiscoveredFieldResponse:
    return DiscoveredFieldResponse(
        id=field.id,
        display_name=field.display_name,
        position_x=field.position_x,
        position_y=field.position_y,
        position_z=field.position_z,
        distance_meters=distance_meters,
        scan_quality=scan_quality,
    )


async def _pilot_state(session: AsyncSession, pilot_id: UUID) -> ShipState:
    return await _lock_pilot_state(session, pilot_id)


async def _kepler(session: AsyncSession) -> SolarSystem:
    system = await session.scalar(select(SolarSystem).where(SolarSystem.system_key == "kepler"))
    if system is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Kepler system is not seeded")
    return system


@router.get("/bootstrap", response_model=DiscoveryBootstrapResponse)
async def discovery_bootstrap(
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> DiscoveryBootstrapResponse:
    """Return the authenticated pilot's private field discoveries."""
    pilot_id = _pilot_id_from_authorization(authorization)
    system = await _kepler(session)
    ship_state = await session.get(ShipState, pilot_id)
    if ship_state is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pilot ship state was not found")
    discoveries = await session.execute(
        select(PilotDiscovery, AsteroidField)
        .join(AsteroidField, PilotDiscovery.discoverable_id == AsteroidField.id)
        .where(
            PilotDiscovery.pilot_id == pilot_id,
            PilotDiscovery.discoverable_kind == "asteroid_field",
        )
    )
    fields = [
        _field_response(field, _distance(ship_state, field), discovery.scan_quality)
        for discovery, field in discoveries
    ]
    return DiscoveryBootstrapResponse(
        system=SystemDefinitionResponse(
            system_key=system.system_key,
            display_name=system.display_name,
            radius_meters=system.radius_meters,
            crossing_seconds=settings.system_crossing_seconds,
            warp_cruise_speed_meters_per_second=system.radius_meters
            / settings.system_crossing_seconds,
            object_render_radius_meters=settings.object_render_radius_meters,
        ),
        discovered_fields=fields,
    )


@router.post("/scan", response_model=ScanResponse)
async def scan(
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> ScanResponse:
    """Spend capacitor power to discover nearby asteroid fields in all directions."""
    pilot_id = _pilot_id_from_authorization(authorization)
    now = datetime.now(UTC)
    async with session.begin():
        ship_state = await _pilot_state(session, pilot_id)
        if ship_state.docked_station_name:
            raise HTTPException(status.HTTP_409_CONFLICT, "undock before using sensors")
        if ship_state.power_megajoules < settings.sensor_default_power_cost_megajoules:
            raise HTTPException(status.HTTP_409_CONFLICT, "insufficient power for sensor scan")
        if ship_state.sensor_last_scan_at and now < ship_state.sensor_last_scan_at + timedelta(
            seconds=settings.sensor_default_cooldown_seconds
        ):
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "sensor scan is recharging")
        system = await _kepler(session)
        fields = list(
            await session.scalars(
                select(AsteroidField).where(
                    AsteroidField.system_id == system.id, AsteroidField.active.is_(True)
                )
            )
        )
        existing_ids = set(
            await session.scalars(
                select(PilotDiscovery.discoverable_id).where(
                    PilotDiscovery.pilot_id == pilot_id,
                    PilotDiscovery.discoverable_kind == "asteroid_field",
                )
            )
        )
        discovered = []
        for field in fields:
            distance_meters = _distance(ship_state, field)
            if distance_meters > settings.sensor_default_range_meters or field.id in existing_ids:
                continue
            quality = max(
                0.1,
                min(
                    1.0,
                    field.discovery_signature
                    * (1 - distance_meters / settings.sensor_default_range_meters),
                ),
            )
            session.add(
                PilotDiscovery(
                    pilot_id=pilot_id,
                    discoverable_kind="asteroid_field",
                    discoverable_id=field.id,
                    scan_quality=quality,
                )
            )
            discovered.append(_field_response(field, distance_meters, quality))
        ship_state.power_megajoules -= settings.sensor_default_power_cost_megajoules
        ship_state.sensor_last_scan_at = now
    return ScanResponse(
        newly_discovered_fields=discovered,
        power_megajoules=ship_state.power_megajoules,
        cooldown_seconds=settings.sensor_default_cooldown_seconds,
    )


@router.get("/asteroids", response_model=list[AsteroidResponse])
async def local_asteroids(
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
    position_x: Annotated[float | None, Query()] = None,
    position_y: Annotated[float | None, Query()] = None,
    position_z: Annotated[float | None, Query()] = None,
) -> list[AsteroidResponse]:
    """Return only asteroids near the pilot inside fields they have personally discovered."""
    pilot_id = _pilot_id_from_authorization(authorization)
    ship_state = await session.get(ShipState, pilot_id)
    if ship_state is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pilot ship state was not found")
    requested_position = (position_x, position_y, position_z)
    if any(value is not None for value in requested_position) and any(
        value is None for value in requested_position
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "position_x, position_y, and position_z must be supplied together",
        )
    interest_position = (ship_state.position_x, ship_state.position_y, ship_state.position_z)
    if all(value is not None for value in requested_position):
        interest_position = (position_x, position_y, position_z)
        _validate_system_position(interest_position)
    rows = await session.execute(
        select(Asteroid, AsteroidField)
        .join(AsteroidField, Asteroid.field_id == AsteroidField.id)
        .join(PilotDiscovery, PilotDiscovery.discoverable_id == AsteroidField.id)
        .where(
            PilotDiscovery.pilot_id == pilot_id,
            PilotDiscovery.discoverable_kind == "asteroid_field",
            Asteroid.depleted_at.is_(None),
        )
    )
    asteroids = []
    for asteroid, field in rows:
        if _position_distance(interest_position, field) > settings.object_render_radius_meters:
            continue
        asteroids.append(
            AsteroidResponse(
                id=asteroid.id,
                field_id=asteroid.field_id,
                position_x=asteroid.position_x,
                position_y=asteroid.position_y,
                position_z=asteroid.position_z,
                radius_meters=asteroid.radius_meters,
                composition=asteroid.composition,
                mineral_assay=json.loads(asteroid.mineral_assay),
                initial_volume_cubic_meters=asteroid.initial_volume_cubic_meters,
                remaining_volume_cubic_meters=asteroid.remaining_volume_cubic_meters,
            )
        )
    return asteroids


@router.get("/ore", response_model=list[MinedOreLotResponse])
async def mined_ore_lots(
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> list[MinedOreLotResponse]:
    """Return only the pilot's ship cargo ore, never remote station contents."""
    pilot_id = _pilot_id_from_authorization(authorization)
    async with session.begin():
        ship_container, _ = await _ensure_containers(session, pilot_id)
        lots = await _ore_for_container(session, ship_container.id)
    return [
        MinedOreLotResponse(
            id=lot.id,
            asteroid_id=lot.asteroid_id,
            composition=lot.composition,
            mineral_assay=json.loads(lot.mineral_assay),
            volume_cubic_meters=lot.volume_cubic_meters,
        )
        for lot in lots
    ]


@router.post("/extract", response_model=ExtractionResponse)
async def extract_asteroid(
    command: ExtractionRequest,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> ExtractionResponse:
    """Extract one fixed ore cycle from a discovered nearby asteroid."""
    pilot_id = _pilot_id_from_authorization(authorization)
    position = (command.position_x, command.position_y, command.position_z)
    _validate_system_position(position)
    async with session.begin():
        ship_state = await _pilot_state(session, pilot_id)
        if ship_state.docked_station_name:
            raise HTTPException(status.HTTP_409_CONFLICT, "undock before extracting ore")
        ship_container, _ = await _ensure_containers(session, pilot_id)
        asteroid = await session.scalar(
            select(Asteroid).where(Asteroid.id == command.asteroid_id).with_for_update()
        )
        if asteroid is None or asteroid.depleted_at is not None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "asteroid is unavailable")
        field = await session.get(AsteroidField, asteroid.field_id)
        if field is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "asteroid field is unavailable")
        discovery = await session.scalar(
            select(PilotDiscovery.id).where(
                PilotDiscovery.pilot_id == pilot_id,
                PilotDiscovery.discoverable_kind == "asteroid_field",
                PilotDiscovery.discoverable_id == field.id,
            )
        )
        if discovery is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "asteroid field has not been discovered")
        if (
            math.dist(position, (asteroid.position_x, asteroid.position_y, asteroid.position_z))
            > 2_500
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, "asteroid is out of mining range")
        used_volume = await _used_volume(session, ship_container.id)
        available_cargo = max(
            0,
            ship_container.capacity_cubic_meters - used_volume,
        )
        extracted = min(
            1,
            math.floor(asteroid.remaining_volume_cubic_meters),
            math.floor(available_cargo),
        )
        if extracted <= VOLUME_EPSILON:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "cargo hold lacks space for one cubic meter of ore"
            )
        mined_ore_lot = await session.scalar(
            select(MinedOreLot)
            .where(
                MinedOreLot.pilot_id == pilot_id,
                MinedOreLot.container_id == ship_container.id,
                MinedOreLot.composition == "Ore",
            )
            .order_by(MinedOreLot.created_at, MinedOreLot.id)
            .limit(1)
            .with_for_update()
        )
        if mined_ore_lot is None:
            mined_ore_lot = MinedOreLot(
                pilot_id=pilot_id,
                container_id=ship_container.id,
                asteroid_id=asteroid.id,
                composition="Ore",
                mineral_assay=asteroid.mineral_assay,
                volume_cubic_meters=extracted,
            )
            session.add(mined_ore_lot)
            await session.flush()
        else:
            mined_ore_lot.mineral_assay = _combined_mineral_assay(
                mined_ore_lot.mineral_assay,
                mined_ore_lot.volume_cubic_meters,
                asteroid.mineral_assay,
                extracted,
            )
            mined_ore_lot.volume_cubic_meters += extracted
        asteroid.remaining_volume_cubic_meters -= extracted
        if asteroid.remaining_volume_cubic_meters == 0:
            asteroid.depleted_at = datetime.now(UTC)
        ship_state.cargo_cubic_meters = used_volume + extracted
    return ExtractionResponse(
        asteroid_id=asteroid.id,
        mined_ore_lot_id=mined_ore_lot.id,
        composition=mined_ore_lot.composition,
        mineral_assay=json.loads(mined_ore_lot.mineral_assay),
        mined_ore_lot_volume_cubic_meters=mined_ore_lot.volume_cubic_meters,
        extracted_ore_cubic_meters=extracted,
        remaining_ore_cubic_meters=asteroid.remaining_volume_cubic_meters,
        cargo_cubic_meters=ship_state.cargo_cubic_meters,
    )
