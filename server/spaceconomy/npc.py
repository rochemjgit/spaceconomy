"""Per-pilot deterministic control for non-player ships."""

from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal, cast
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, TypeAdapter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .inventory import KEPLER_STATION_ID, _ensure_containers, _used_volume
from .market import _market_fee_credits, _wallet
from .mining import deactivate_exhausted_asteroid_field, scan_nearby_asteroid_fields
from .models import (
    Asteroid,
    AsteroidField,
    FittedModule,
    InventoryItem,
    MarketListing,
    MinedOreLot,
    ModuleDefinition,
    NpcRuntime,
    PilotDiscovery,
    RefineryJob,
    RefineryService,
    Ship,
    ShipLocation,
    ShipState,
    WalletTransaction,
)
from .refinery import crush_outputs, purify_output

KEPLER_POSITION = (123_078.0, 480.0, -3_400.0)
DECISION_INTERVAL = timedelta(seconds=30)
MOVEMENT_SPEED_METERS_PER_SECOND = 65.0
WARP_MINIMUM_DISTANCE_METERS = 100_000
WARP_MAXIMUM_CAPACITY = 100.0
WARP_ENTRY_CAPACITY_COST = 10.0
WARP_CAPACITY_RECHARGE_PER_SECOND = 2.0
WARP_CAPACITY_DRAIN_PER_SECOND = 2.0
WARP_CRUISE_SPEED_METERS_PER_SECOND = 10_000.0
WARP_ALIGN_SECONDS = 1.2
WARP_ACCELERATION_SECONDS = 4.0
WARP_TRANSIT_SECONDS = 0.9
WARP_DECELERATION_SECONDS = 1.6
WARP_ALIGNMENT_SPEED_METERS_PER_SECOND = 100.0
TARGET_LOCK_SECONDS = 1.5
SHIP_POWER_MAXIMUM_MEGAJOULES = 100.0
SHIP_POWER_RECHARGE_MEGAWATTS = 8.0
MINING_LASER_POWER_DRAW_MEGAWATTS = 12.0
NPC_MARKET_REFERENCE_PRICE_CREDITS = 100
NPC_MARKET_MINIMUM_PRICE_CREDITS = 75


async def ensure_miner_equipment(session: AsyncSession, pilot_id: UUID) -> None:
    """Fit a mining laser for an NPC through the same durable item records as players."""
    _, station_container = await _ensure_containers(session, pilot_id)
    ship = await session.scalar(select(Ship).where(Ship.pilot_id == pilot_id).with_for_update())
    if ship is None:
        return
    for definition_id, slot_location, slot_index in (
        ("module.mining_laser.m1", "universal_hardpoint", 0),
        ("module.warp_drive.w1", "core_system", 0),
    ):
        await _ensure_fitted_module(
            session,
            pilot_id,
            ship,
            station_container.id,
            definition_id,
            slot_location,
            slot_index,
        )


async def _ensure_fitted_module(
    session: AsyncSession,
    pilot_id: UUID,
    ship: Ship,
    station_container_id: UUID,
    definition_id: str,
    slot_location: str,
    slot_index: int,
) -> None:
    definition = await session.scalar(
        select(ModuleDefinition).where(
            ModuleDefinition.definition_id == definition_id,
            ModuleDefinition.active.is_(True),
        )
    )
    if definition is None:
        return
    fitted = await session.scalar(
        select(FittedModule).where(
            FittedModule.ship_id == ship.id,
            FittedModule.module_definition_id == definition.id,
        )
    )
    if fitted is not None:
        return
    item = await session.scalar(
        select(InventoryItem)
        .where(
            InventoryItem.pilot_id == pilot_id,
            InventoryItem.container_id == station_container_id,
            InventoryItem.module_definition_id == definition.id,
        )
        .with_for_update()
    )
    if item is None:
        item = InventoryItem(
            pilot_id=pilot_id,
            container_id=station_container_id,
            module_definition_id=definition.id,
            definition_id=definition.definition_id,
            definition_version=definition.version,
            quantity=1,
            durability=definition.durability_maximum,
            volume_per_unit=definition.volume_cubic_meters,
        )
        session.add(item)
        await session.flush()
    item.container_id = None
    session.add(
        FittedModule(
            ship_id=ship.id,
            inventory_item_id=item.id,
            module_definition_id=definition.id,
            slot_location=slot_location,
            slot_index=slot_index,
            durability=item.durability,
        )
    )


@dataclass(frozen=True, slots=True)
class NpcMotion:
    """The next authoritative transform and intent for one NPC."""

    behavior_state: str
    position: tuple[float, float, float]
    target: tuple[float, float, float]
    yaw: float
    decision_due_at: datetime


class NpcController:
    """Resolve one NPC's bounded movement decisions independently of other NPCs."""

    def __init__(self, pilot_id: UUID, capabilities: tuple[str, ...]) -> None:
        self.pilot_id = pilot_id
        self.capabilities = capabilities

    def advance(
        self, now: datetime, position: tuple[float, float, float], runtime: NpcRuntime
    ) -> NpcMotion:
        target = self._stored_target(runtime)
        decision_due_at = runtime.decision_due_at
        if decision_due_at is not None and decision_due_at.tzinfo is None:
            decision_due_at = decision_due_at.replace(tzinfo=UTC)
        if target is None or decision_due_at is None or now >= decision_due_at:
            behavior_state = "prospecting" if "mine" in self.capabilities else "patrolling"
            target = self._deterministic_target(now, behavior_state)
            decision_due_at = now + DECISION_INTERVAL
            runtime.decision_source = "deterministic"
        else:
            behavior_state = runtime.behavior_state
        next_position, yaw = self._move_toward(position, target)
        runtime.behavior_state = behavior_state
        runtime.target_x, runtime.target_y, runtime.target_z = target
        runtime.decision_due_at = decision_due_at
        return NpcMotion(behavior_state, next_position, target, yaw, decision_due_at)

    def _deterministic_target(
        self, now: datetime, behavior_state: str
    ) -> tuple[float, float, float]:
        decision_index = int(now.timestamp() // DECISION_INTERVAL.total_seconds())
        phase = ((self.pilot_id.int % 360) + decision_index * 73) * math.pi / 180
        radius = (
            settings.sensor_default_range_meters
            + self.pilot_id.int % int(settings.system_radius_meters * 0.8)
            if behavior_state == "prospecting"
            else 850
        )
        return (
            KEPLER_POSITION[0] + math.cos(phase) * radius,
            KEPLER_POSITION[1] + math.sin(phase * 2) * 120,
            KEPLER_POSITION[2] + math.sin(phase) * radius,
        )

    @staticmethod
    def _stored_target(runtime: NpcRuntime) -> tuple[float, float, float] | None:
        if runtime.target_x is None or runtime.target_y is None or runtime.target_z is None:
            return None
        return (runtime.target_x, runtime.target_y, runtime.target_z)

    @staticmethod
    def _move_toward(
        position: tuple[float, float, float], target: tuple[float, float, float]
    ) -> tuple[tuple[float, float, float], float]:
        offset = tuple(target[axis] - position[axis] for axis in range(3))
        distance = math.sqrt(sum(component * component for component in offset))
        if distance == 0:
            return position, 0.0
        travel = min(MOVEMENT_SPEED_METERS_PER_SECOND, distance)
        next_position = tuple(
            position[axis] + offset[axis] / distance * travel for axis in range(3)
        )
        return next_position, math.atan2(offset[0], offset[2])


async def run_economic_miner(
    session: AsyncSession,
    pilot_id: UUID,
    runtime: NpcRuntime,
    ship_state: ShipState,
    now: datetime,
) -> NpcMotion:
    """Perform one bounded, server-authoritative action from a miner's economy loop."""
    ship_container, station_container = await _ensure_containers(session, pilot_id)
    position = (ship_state.position_x, ship_state.position_y, ship_state.position_z)
    if ship_state.docked_station_name:
        motion = await _run_docked_miner_action(
            session, pilot_id, runtime, ship_state, ship_container.id, station_container.id, now
        )
    else:
        motion = await _run_space_miner_action(
            session,
            pilot_id,
            runtime,
            ship_state,
            ship_container.id,
            ship_container.capacity_cubic_meters,
            position,
            now,
        )
    ship = await session.scalar(
        select(Ship).where(Ship.pilot_id == pilot_id, Ship.status == "active")
    )
    if ship is not None:
        location = await session.get(ShipLocation, ship.id, with_for_update=True)
        if location is not None:
            displacement = tuple(
                motion.position[axis] - position[axis] for axis in range(3)
            )
            distance = math.sqrt(sum(component * component for component in displacement))
            if distance:
                location.heading_x, location.heading_y, location.heading_z = (
                    component / distance for component in displacement
                )
            location.position_x, location.position_y, location.position_z = motion.position
            location.velocity_x, location.velocity_y, location.velocity_z = displacement
            location.checkpointed_at = now
    ship_state.position_x, ship_state.position_y, ship_state.position_z = motion.position
    return motion


async def _run_docked_miner_action(
    session: AsyncSession, pilot_id: UUID, runtime: NpcRuntime, ship_state: ShipState,
    ship_container_id: UUID, station_container_id: UUID, now: datetime,
) -> NpcMotion:
    runtime.mining_target_asteroid_id = None
    runtime.mining_lock_started_at = None
    runtime.mining_locked_at = None
    runtime.mining_next_cycle_at = None
    cargo_lot = await session.scalar(
        select(MinedOreLot)
        .where(MinedOreLot.container_id == ship_container_id)
        .order_by(MinedOreLot.created_at)
        .with_for_update()
    )
    if cargo_lot is not None:
        cargo_lot.container_id = station_container_id
        ship_state.cargo_cubic_meters = await _used_volume(session, ship_container_id)
        return _stationary_motion(runtime, ship_state, now, "unloading")
    raw_lot = await session.scalar(
        select(MinedOreLot)
        .where(MinedOreLot.container_id == station_container_id)
        .order_by(MinedOreLot.created_at)
        .limit(1)
        .with_for_update()
    )
    if raw_lot is not None:
        await _queue_refinery_job(session, pilot_id, raw_lot, None, now)
        return _stationary_motion(runtime, ship_state, now, "refining_raw_ore")
    intermediate = await session.scalar(
        select(InventoryItem)
        .where(
            InventoryItem.container_id == station_container_id,
            InventoryItem.definition_id.startswith("material.ore."),
        )
        .order_by(InventoryItem.created_at)
        .limit(1)
        .with_for_update()
    )
    if intermediate is not None:
        await _queue_refinery_job(session, pilot_id, None, intermediate, now)
        return _stationary_motion(runtime, ship_state, now, "refining_minerals")
    finished_material = await session.scalar(
        select(InventoryItem)
        .where(
            InventoryItem.container_id == station_container_id,
            InventoryItem.definition_id.startswith("material.pure."),
            ~InventoryItem.id.in_(select(MarketListing.inventory_item_id)),
        )
        .order_by(InventoryItem.created_at)
        .limit(1)
        .with_for_update()
    )
    if finished_material is not None:
        listed = await session.scalar(
            select(MarketListing).where(MarketListing.inventory_item_id == finished_material.id)
        )
        if listed is None:
            duration_days = 7
            unit_price_credits = await _npc_listing_price(
                session, pilot_id, finished_material
            )
            if unit_price_credits is None:
                return _stationary_motion(runtime, ship_state, now, "stockpiling_minerals")
            listing_fee_credits = _market_fee_credits(
                finished_material.quantity, unit_price_credits, duration_days
            )
            wallet = await _wallet(session, pilot_id)
            if wallet.balance_credits >= listing_fee_credits:
                wallet.balance_credits -= listing_fee_credits
                session.add(
                    MarketListing(
                        station_id=KEPLER_STATION_ID,
                        seller_pilot_id=pilot_id,
                        inventory_item_id=finished_material.id,
                        quantity=finished_material.quantity,
                        unit_price_credits=unit_price_credits,
                        duration_days=duration_days,
                        listing_fee_credits=listing_fee_credits,
                        expires_at=now + timedelta(days=duration_days),
                        command_id=f"npc-list:{pilot_id}:{finished_material.id}",
                    )
                )
                finished_material.container_id = None
                session.add(
                    WalletTransaction(
                        pilot_id=pilot_id,
                        counterparty_pilot_id=None,
                        amount_credits=-listing_fee_credits,
                        transaction_kind="market_listing_fee",
                        command_id=f"npc-listing-fee:{pilot_id}:{finished_material.id}",
                        settlement_id=uuid4(),
                    )
                )
        return _stationary_motion(runtime, ship_state, now, "listing_minerals")
    ship_state.docked_station_name = None
    return _stationary_motion(runtime, ship_state, now, "undocking")


async def _npc_listing_price(
    session: AsyncSession, pilot_id: UUID, material: InventoryItem
) -> int | None:
    """Price against the cheapest competing supply without selling below the NPC floor."""
    lowest_competitor_price = await session.scalar(
        select(func.min(MarketListing.unit_price_credits))
        .join(InventoryItem, InventoryItem.id == MarketListing.inventory_item_id)
        .where(
            MarketListing.station_id == KEPLER_STATION_ID,
            MarketListing.state == "active",
            MarketListing.seller_pilot_id != pilot_id,
            InventoryItem.definition_id == material.definition_id,
            InventoryItem.definition_version == material.definition_version,
        )
    )
    if lowest_competitor_price is None:
        return NPC_MARKET_REFERENCE_PRICE_CREDITS
    if lowest_competitor_price <= NPC_MARKET_MINIMUM_PRICE_CREDITS:
        return None
    return min(NPC_MARKET_REFERENCE_PRICE_CREDITS, lowest_competitor_price - 1)


async def _queue_refinery_job(
    session: AsyncSession, pilot_id: UUID, raw_lot: MinedOreLot | None,
    intermediate: InventoryItem | None, now: datetime,
) -> None:
    source_id = raw_lot.id if raw_lot else intermediate.id if intermediate else None
    if source_id is None:
        return
    existing = await session.scalar(
        select(RefineryJob).where(
            RefineryJob.pilot_id == pilot_id,
            (
                RefineryJob.source_ore_lot_id == source_id
                if raw_lot
                else RefineryJob.source_inventory_item_id == source_id
            ),
            RefineryJob.state.in_(("queued", "processing")),
        )
    )
    if existing is not None:
        return
    service = await session.scalar(
        select(RefineryService).where(RefineryService.active.is_(True)).limit(1)
    )
    if service is None:
        return
    if raw_lot is not None:
        outputs = crush_outputs(
            json.loads(raw_lot.mineral_assay),
            raw_lot.volume_cubic_meters,
            service.first_pass_efficiency,
        )
        duration = raw_lot.volume_cubic_meters * service.first_pass_seconds_per_cubic_meter
        efficiency = service.first_pass_efficiency
        stage = "crush"
    else:
        output = purify_output(
            intermediate.definition_id,
            intermediate.definition_version,
            intermediate.quantity,
            service.second_pass_efficiency,
        )
        outputs = () if output is None else (output,)
        duration = intermediate.quantity * service.second_pass_seconds_per_cubic_meter
        efficiency = service.second_pass_efficiency
        stage = "purify"
    processing = await session.scalar(
        select(func.count())
        .select_from(RefineryJob)
        .where(
            RefineryJob.refinery_service_id == service.id,
            RefineryJob.state == "processing",
        )
    )
    sequence = int(
        await session.scalar(
            select(func.coalesce(func.max(RefineryJob.queue_sequence), -1)).where(
                RefineryJob.pilot_id == pilot_id,
                RefineryJob.refinery_service_id == service.id,
            )
        )
    ) + 1
    state = "processing" if int(processing or 0) < service.active_job_capacity else "queued"
    session.add(
        RefineryJob(
            pilot_id=pilot_id,
            refinery_service_id=service.id,
            source_ore_lot_id=raw_lot.id if raw_lot else None,
            source_inventory_item_id=intermediate.id if intermediate else None,
            stage=stage,
            state=state,
            queue_sequence=sequence,
            quoted_duration_seconds=duration,
            quoted_efficiency=efficiency,
            quoted_fee_credits=service.fee_credits,
            expected_outputs=json.dumps([output.__dict__ for output in outputs]),
            idempotency_key=f"npc-refinery:{pilot_id}:{source_id}",
            started_at=now if state == "processing" else None,
            completes_at=now + timedelta(seconds=duration) if state == "processing" else None,
        )
    )


async def _run_space_miner_action(
    session: AsyncSession, pilot_id: UUID, runtime: NpcRuntime, ship_state: ShipState,
    ship_container_id: UUID, cargo_capacity: float, position: tuple[float, float, float],
    now: datetime,
) -> NpcMotion:
    used_volume = await _used_volume(session, ship_container_id)
    power_was_depleted = ship_state.power_megajoules <= 0
    ship_state.power_megajoules = min(
        SHIP_POWER_MAXIMUM_MEGAJOULES,
        ship_state.power_megajoules + SHIP_POWER_RECHARGE_MEGAWATTS,
    )
    if used_volume >= cargo_capacity:
        if math.dist(position, KEPLER_POSITION) <= 250:
            ship_state.docked_station_name = "KEPLER STATION"
            return _stationary_motion(runtime, ship_state, now, "docking")
        return await _warp_or_move(
            session, pilot_id, runtime, ship_state, KEPLER_POSITION, now, "returning"
        )
    await scan_nearby_asteroid_fields(session, pilot_id, ship_state, now)
    asteroids = await _discovered_asteroids(session, pilot_id)
    asteroid = next(
        (
            candidate
            for candidate in asteroids
            if candidate.id == runtime.mining_target_asteroid_id
        ),
        None,
    )
    if asteroid is None:
        claimed_targets = set(
            await session.scalars(
                select(NpcRuntime.mining_target_asteroid_id).where(
                    NpcRuntime.pilot_id != pilot_id,
                    NpcRuntime.mining_target_asteroid_id.is_not(None),
                )
            )
        )
        asteroid = _select_mining_asteroid(position, pilot_id, asteroids, claimed_targets)
    if asteroid is None:
        runtime.decision_due_at = None
        survey_motion = NpcController(pilot_id, ("mine",)).advance(now, position, runtime)
        return await _warp_or_move(
            session,
            pilot_id,
            runtime,
            ship_state,
            survey_motion.target,
            now,
            "exploring",
        )
    if runtime.mining_target_asteroid_id != asteroid.id:
        runtime.mining_target_asteroid_id = asteroid.id
        runtime.mining_lock_started_at = None
        runtime.mining_locked_at = None
        runtime.mining_next_cycle_at = None
    target = (asteroid.position_x, asteroid.position_y, asteroid.position_z)
    mining_laser_range = await _mining_laser_range(session, pilot_id)
    if mining_laser_range is None:
        return _set_motion(runtime, position, target, 0, now, "mining_laser_offline")
    if math.dist(position, target) > mining_laser_range:
        return await _warp_or_move(
            session, pilot_id, runtime, ship_state, target, now, "travelling_to_asteroid"
        )
    if runtime.mining_lock_started_at is None:
        runtime.mining_lock_started_at = now
        return _set_motion(runtime, position, target, 0, now, "locking_asteroid")
    if runtime.mining_locked_at is None:
        lock_started_at = runtime.mining_lock_started_at or now
        if lock_started_at.tzinfo is None:
            lock_started_at = lock_started_at.replace(tzinfo=UTC)
        if (now - lock_started_at).total_seconds() < TARGET_LOCK_SECONDS:
            return _set_motion(runtime, position, target, 0, now, "locking_asteroid")
        runtime.mining_locked_at = now
        runtime.mining_next_cycle_at = now + timedelta(seconds=1)
        return _set_motion(runtime, position, target, 0, now, "target_locked")
    if power_was_depleted:
        return _set_motion(runtime, position, target, 0, now, "recharging_power")
    if not await _has_working_mining_laser(session, pilot_id):
        return _set_motion(runtime, position, target, 0, now, "mining_laser_offline")
    ship_state.power_megajoules = max(
        0.0, ship_state.power_megajoules - MINING_LASER_POWER_DRAW_MEGAWATTS
    )
    next_cycle_at = runtime.mining_next_cycle_at
    if next_cycle_at is not None and next_cycle_at.tzinfo is None:
        next_cycle_at = next_cycle_at.replace(tzinfo=UTC)
    if next_cycle_at is not None and now < next_cycle_at:
        return _set_motion(runtime, position, target, 0, now, "mining_cycle_wait")
    extracted = min(
        1,
        math.floor(asteroid.remaining_volume_cubic_meters),
        math.floor(cargo_capacity - used_volume),
    )
    if extracted <= 0:
        if asteroid.remaining_volume_cubic_meters < 1:
            asteroid.remaining_volume_cubic_meters = 0
            asteroid.depleted_at = now
        runtime.mining_target_asteroid_id = None
        runtime.mining_lock_started_at = None
        runtime.mining_locked_at = None
        runtime.mining_next_cycle_at = None
        return _stationary_motion(runtime, ship_state, now, "selecting_next_asteroid")
    lot = await session.scalar(
        select(MinedOreLot)
        .where(
            MinedOreLot.pilot_id == pilot_id,
            MinedOreLot.container_id == ship_container_id,
        )
        .with_for_update()
    )
    if lot is None:
        session.add(
            MinedOreLot(
                pilot_id=pilot_id,
                container_id=ship_container_id,
                asteroid_id=asteroid.id,
                composition="Ore",
                mineral_assay=asteroid.mineral_assay,
                volume_cubic_meters=extracted,
            )
        )
    else:
        lot.volume_cubic_meters += extracted
    asteroid.remaining_volume_cubic_meters -= extracted
    if asteroid.remaining_volume_cubic_meters < 1:
        asteroid.remaining_volume_cubic_meters = 0
        asteroid.depleted_at = now
        field = await session.get(AsteroidField, asteroid.field_id, with_for_update=True)
        if field is not None:
            await deactivate_exhausted_asteroid_field(session, field)
    ship_state.cargo_cubic_meters = used_volume + extracted
    runtime.mining_next_cycle_at = now + timedelta(seconds=_mining_cycle_seconds(pilot_id))
    return _stationary_motion(runtime, ship_state, now, "mining")


def _mining_cycle_seconds(pilot_id: UUID) -> int:
    """Match player ore-cycle cadence without nondeterministic server simulation."""
    return 2 + pilot_id.int % 4


def _select_mining_asteroid(
    position: tuple[float, float, float],
    pilot_id: UUID,
    asteroids: list[Asteroid],
    claimed_targets: set[UUID],
) -> Asteroid | None:
    """Choose a stable random unclaimed asteroid in the nearest discovered field."""
    if not asteroids:
        return None
    field_id = min(
        {asteroid.field_id for asteroid in asteroids},
        key=lambda candidate_field_id: min(
            math.dist(
                position,
                (asteroid.position_x, asteroid.position_y, asteroid.position_z),
            )
            for asteroid in asteroids
            if asteroid.field_id == candidate_field_id
        ),
    )
    candidates = [asteroid for asteroid in asteroids if asteroid.field_id == field_id]
    unclaimed_candidates = [
        asteroid for asteroid in candidates if asteroid.id not in claimed_targets
    ]
    choices = unclaimed_candidates or candidates
    choices.sort(key=lambda asteroid: asteroid.id.int)
    return random.Random(pilot_id.int ^ field_id.int).choice(choices)


async def _discovered_asteroids(session: AsyncSession, pilot_id: UUID) -> list[Asteroid]:
    return list(
        await session.scalars(
            select(Asteroid)
            .join(AsteroidField, Asteroid.field_id == AsteroidField.id)
            .join(PilotDiscovery, PilotDiscovery.discoverable_id == AsteroidField.id)
            .where(
                PilotDiscovery.pilot_id == pilot_id,
                PilotDiscovery.discoverable_kind == "asteroid_field",
                AsteroidField.active.is_(True),
                Asteroid.depleted_at.is_(None),
                Asteroid.remaining_volume_cubic_meters >= 1,
            )
            .with_for_update()
        )
    )


def _move(
    runtime: NpcRuntime,
    ship_state: ShipState,
    target: tuple[float, float, float],
    now: datetime,
    state: str,
) -> NpcMotion:
    position = (ship_state.position_x, ship_state.position_y, ship_state.position_z)
    next_position, yaw = NpcController._move_toward(position, target)
    return _set_motion(runtime, next_position, target, yaw, now, state)


async def _warp_or_move(
    session: AsyncSession,
    pilot_id: UUID,
    runtime: NpcRuntime,
    ship_state: ShipState,
    target: tuple[float, float, float],
    now: datetime,
    state: str,
) -> NpcMotion:
    position = (ship_state.position_x, ship_state.position_y, ship_state.position_z)
    if runtime.warp_phase is None:
        runtime.warp_capacity = min(
            WARP_MAXIMUM_CAPACITY,
            runtime.warp_capacity + WARP_CAPACITY_RECHARGE_PER_SECOND,
        )
        if (
            math.dist(position, target) <= WARP_MINIMUM_DISTANCE_METERS
            or runtime.warp_capacity <= WARP_ENTRY_CAPACITY_COST
            or not await _has_working_warp_drive(session, pilot_id)
        ):
            return _move(runtime, ship_state, target, now, state)
        runtime.warp_capacity -= WARP_ENTRY_CAPACITY_COST
        runtime.warp_phase = "aligning"
        runtime.warp_phase_started_at = now
        runtime.warp_destination_x, runtime.warp_destination_y, runtime.warp_destination_z = target
    warp_target = (
        runtime.warp_destination_x,
        runtime.warp_destination_y,
        runtime.warp_destination_z,
    )
    if any(component is None for component in warp_target):
        warp_target = target
    if runtime.warp_phase != "decelerating" and math.dist(warp_target, target) > 1:
        _begin_warp_egress(runtime, position, warp_target, now)
        warp_target = (
            runtime.warp_destination_x,
            runtime.warp_destination_y,
            runtime.warp_destination_z,
        )
    return _advance_warp(runtime, position, warp_target, now, state)


async def _has_working_warp_drive(session: AsyncSession, pilot_id: UUID) -> bool:
    return await session.scalar(
        select(FittedModule.id)
        .join(Ship, Ship.id == FittedModule.ship_id)
        .join(ModuleDefinition, ModuleDefinition.id == FittedModule.module_definition_id)
        .where(
            Ship.pilot_id == pilot_id,
            Ship.status == "active",
            ModuleDefinition.family == "warp_drive",
            FittedModule.durability > 0,
        )
        .limit(1)
    ) is not None


async def _has_working_mining_laser(session: AsyncSession, pilot_id: UUID) -> bool:
    return await session.scalar(
        select(FittedModule.id)
        .join(Ship, Ship.id == FittedModule.ship_id)
        .join(ModuleDefinition, ModuleDefinition.id == FittedModule.module_definition_id)
        .where(
            Ship.pilot_id == pilot_id,
            Ship.status == "active",
            ModuleDefinition.family == "mining_laser",
            FittedModule.durability > 0,
        )
        .limit(1)
    ) is not None


async def _mining_laser_range(session: AsyncSession, pilot_id: UUID) -> float | None:
    return await session.scalar(
        select(ModuleDefinition.effective_range_meters)
        .join(FittedModule, FittedModule.module_definition_id == ModuleDefinition.id)
        .join(Ship, Ship.id == FittedModule.ship_id)
        .where(
            Ship.pilot_id == pilot_id,
            Ship.status == "active",
            ModuleDefinition.family == "mining_laser",
            FittedModule.durability > 0,
        )
        .limit(1)
    )


def _advance_warp(
    runtime: NpcRuntime,
    position: tuple[float, float, float],
    target: tuple[float, float, float],
    now: datetime,
    state: str,
) -> NpcMotion:
    phase_started = runtime.warp_phase_started_at or now
    if phase_started.tzinfo is None:
        phase_started = phase_started.replace(tzinfo=UTC)
    elapsed = max(0.0, (now - phase_started).total_seconds())
    phase = runtime.warp_phase
    if phase == "aligning":
        if elapsed >= WARP_ALIGN_SECONDS:
            return _next_warp_phase(runtime, position, target, now, "accelerating", state)
        return _move_warp_at_speed(
            runtime, position, target, WARP_ALIGNMENT_SPEED_METERS_PER_SECOND, now, state
        )
    if phase == "accelerating":
        if elapsed >= WARP_ACCELERATION_SECONDS:
            return _next_warp_phase(runtime, position, target, now, "warping", state)
        return _move_warp_at_speed(
            runtime,
            position,
            target,
            WARP_CRUISE_SPEED_METERS_PER_SECOND * elapsed / WARP_ACCELERATION_SECONDS,
            now,
            state,
        )
    if phase == "warping":
        if elapsed >= WARP_TRANSIT_SECONDS:
            return _next_warp_phase(runtime, position, target, now, "cruising", state)
        return _move_warp_at_speed(
            runtime, position, target, WARP_CRUISE_SPEED_METERS_PER_SECOND, now, state
        )
    if phase == "cruising":
        remaining = math.dist(position, target)
        if remaining <= WARP_CRUISE_SPEED_METERS_PER_SECOND * WARP_DECELERATION_SECONDS / 2:
            return _next_warp_phase(runtime, position, target, now, "decelerating", state)
        runtime.warp_capacity = max(
            WARP_ENTRY_CAPACITY_COST,
            runtime.warp_capacity - WARP_CAPACITY_DRAIN_PER_SECOND * elapsed,
        )
        runtime.warp_phase_started_at = now
        return _move_warp_cruise(runtime, position, target, now, state)
    if phase == "decelerating":
        if elapsed >= WARP_DECELERATION_SECONDS:
            runtime.warp_phase = None
            runtime.warp_phase_started_at = None
            runtime.warp_destination_x = None
            runtime.warp_destination_y = None
            runtime.warp_destination_z = None
            return _set_motion(runtime, target, target, 0, now, state)
        return _move_warp_at_speed(
            runtime,
            position,
            target,
            WARP_CRUISE_SPEED_METERS_PER_SECOND * (1 - elapsed / WARP_DECELERATION_SECONDS),
            now,
            state,
        )
    return _set_motion(runtime, position, target, 0, now, state)


def _next_warp_phase(
    runtime: NpcRuntime,
    position: tuple[float, float, float],
    target: tuple[float, float, float],
    now: datetime,
    phase: str,
    state: str,
) -> NpcMotion:
    runtime.warp_phase = phase
    runtime.warp_phase_started_at = now
    return _set_motion(runtime, position, target, 0, now, state)


def _begin_warp_egress(
    runtime: NpcRuntime,
    position: tuple[float, float, float],
    destination: tuple[float, float, float],
    now: datetime,
) -> None:
    offset = tuple(destination[axis] - position[axis] for axis in range(3))
    distance = math.sqrt(sum(component * component for component in offset))
    if distance == 0:
        return
    egress_distance = WARP_CRUISE_SPEED_METERS_PER_SECOND * WARP_DECELERATION_SECONDS / 2
    runtime.warp_destination_x, runtime.warp_destination_y, runtime.warp_destination_z = tuple(
        position[axis] + offset[axis] / distance * egress_distance for axis in range(3)
    )
    runtime.warp_phase = "decelerating"
    runtime.warp_phase_started_at = now


def _move_warp_cruise(
    runtime: NpcRuntime,
    position: tuple[float, float, float],
    target: tuple[float, float, float],
    now: datetime,
    state: str,
) -> NpcMotion:
    return _move_warp_at_speed(
        runtime, position, target, WARP_CRUISE_SPEED_METERS_PER_SECOND, now, state
    )


def _move_warp_at_speed(
    runtime: NpcRuntime,
    position: tuple[float, float, float],
    target: tuple[float, float, float],
    speed_meters_per_second: float,
    now: datetime,
    state: str,
) -> NpcMotion:
    offset = tuple(target[axis] - position[axis] for axis in range(3))
    distance = math.sqrt(sum(component * component for component in offset))
    if distance == 0:
        return _set_motion(runtime, position, target, 0, now, state)
    travel = min(speed_meters_per_second, distance)
    next_position = tuple(
        position[axis] + offset[axis] / distance * travel for axis in range(3)
    )
    return _set_motion(runtime, next_position, target, math.atan2(offset[0], offset[2]), now, state)


def _stationary_motion(
    runtime: NpcRuntime, ship_state: ShipState, now: datetime, state: str
) -> NpcMotion:
    position = (ship_state.position_x, ship_state.position_y, ship_state.position_z)
    return _set_motion(runtime, position, position, 0, now, state)


def _set_motion(
    runtime: NpcRuntime,
    position: tuple[float, float, float],
    target: tuple[float, float, float],
    yaw: float,
    now: datetime,
    state: str,
) -> NpcMotion:
    runtime.behavior_state, runtime.decision_source = state, "deterministic"
    runtime.target_x, runtime.target_y, runtime.target_z = target
    runtime.decision_due_at = now + DECISION_INTERVAL
    return NpcMotion(state, position, target, yaw, runtime.decision_due_at)


class WaitCommand(BaseModel):
    action_type: Literal["wait"]
    duration_seconds: int = Field(ge=1, le=300)


class TravelToFieldCommand(BaseModel):
    action_type: Literal["travel_to_field"]
    field_id: UUID


class DockCommand(BaseModel):
    action_type: Literal["dock"]


class UndockCommand(BaseModel):
    action_type: Literal["undock"]


class MineCommand(BaseModel):
    action_type: Literal["mine"]
    asteroid_id: UUID


class SubmitRefiningJobCommand(BaseModel):
    action_type: Literal["submit_refining_job"]
    ore_lot_id: UUID


class CreateMarketListingCommand(BaseModel):
    action_type: Literal["create_market_listing"]
    inventory_item_id: UUID
    quantity: int = Field(gt=0)
    unit_price_credits: int = Field(gt=0)


NpcCommand = Annotated[
    WaitCommand
    | TravelToFieldCommand
    | DockCommand
    | UndockCommand
    | MineCommand
    | SubmitRefiningJobCommand
    | CreateMarketListingCommand,
    Field(discriminator="action_type"),
]

_command_adapter: TypeAdapter[NpcCommand] = TypeAdapter(NpcCommand)


def parse_command(payload: object) -> NpcCommand:
    """Validate untrusted planner output against the closed NPC action allowlist."""
    return cast(NpcCommand, _command_adapter.validate_python(payload))


class NpcObservation(BaseModel):
    """Server-derived facts that a planner may use when selecting one action."""

    docked: bool
    cargo_used_cubic_meters: float = Field(ge=0)
    cargo_capacity_cubic_meters: float = Field(gt=0)
    target_field_id: UUID | None = None
    mineable_asteroid_id: UUID | None = None
    raw_ore_lot_id: UUID | None = None
    market_item_id: UUID | None = None
    suggested_market_price_credits: int | None = Field(default=None, gt=0)


def economic_miner_fallback(observation: NpcObservation) -> NpcCommand:
    """Keep a starter miner productive when its planner is unavailable or rejected."""
    if observation.docked:
        if observation.raw_ore_lot_id is not None:
            return SubmitRefiningJobCommand(
                action_type="submit_refining_job", ore_lot_id=observation.raw_ore_lot_id
            )
        if (
            observation.market_item_id is not None
            and observation.suggested_market_price_credits is not None
        ):
            return CreateMarketListingCommand(
                action_type="create_market_listing",
                inventory_item_id=observation.market_item_id,
                quantity=1,
                unit_price_credits=observation.suggested_market_price_credits,
            )
        return UndockCommand(action_type="undock")
    if (
        observation.cargo_used_cubic_meters
        >= observation.cargo_capacity_cubic_meters
    ):
        return DockCommand(action_type="dock")
    if observation.mineable_asteroid_id is not None:
        return MineCommand(
            action_type="mine", asteroid_id=observation.mineable_asteroid_id
        )
    if observation.target_field_id is not None:
        return TravelToFieldCommand(
            action_type="travel_to_field", field_id=observation.target_field_id
        )
    return WaitCommand(action_type="wait", duration_seconds=30)