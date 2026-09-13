"""Durable asteroid field replenishment owned by the in-space system service."""

from __future__ import annotations

import asyncio
import json
import math
import random
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from .config import settings
from .db import session_factory
from .inventory import expire_jettisoned_items
from .market import expire_market_listings
from .models import (
    Asteroid,
    AsteroidField,
    InventoryItem,
    InventoryLedgerEntry,
    ManufacturingJob,
    ManufacturingJobInput,
    ManufacturingService,
    MinedOreLot,
    NpcProfile,
    NpcRuntime,
    Pilot,
    RefineryJob,
    RefineryService,
    ShipState,
    SolarSystem,
)
from .npc import NpcController, NpcMotion, ensure_miner_equipment, run_economic_miner
from .redis import publish_event, remove_system_presence, set_system_presence

SYSTEM_ID = "kepler"
DEFAULT_FIELD_PROFILE = {
    "composition": "ferrous",
    "variants": [
        {"weight": 1, "minerals": (("iron", 55, 75), ("nickel", 15, 30))},
    ],
}


def mineral_assay_for_profile(profile: dict[str, object], spawn_seed: int) -> str:
    """Create a normalized immutable mineral assay from a durable spawn seed."""
    generator = random.Random(spawn_seed)
    variants = profile.get("variants", [])
    if not isinstance(variants, list) or not variants:
        return "[]"
    weights = [
        max(0, float(variant.get("weight", 0))) for variant in variants if isinstance(variant, dict)
    ]
    valid_variants = [variant for variant in variants if isinstance(variant, dict)]
    if not valid_variants or not any(weights):
        return "[]"
    variant = generator.choices(valid_variants, weights=weights, k=1)[0]
    minerals = variant.get("minerals", [])
    if not isinstance(minerals, (list, tuple)):
        return "[]"
    rolled = [
        (str(entry[0]), generator.uniform(float(entry[1]), float(entry[2])))
        for entry in minerals
        if isinstance(entry, (list, tuple)) and len(entry) == 3
    ]
    total = sum(value for _, value in rolled)
    if total <= 0:
        return "[]"
    filtered = [
        (definition_id, value) for definition_id, value in rolled if value / total * 100 >= 0.1
    ]
    filtered_total = sum(value for _, value in filtered)
    if filtered_total <= 0:
        return "[]"
    return json.dumps(
        [
            {
                "definition_id": definition_id,
                "definition_version": 1,
                "percentage": round(value / filtered_total * 100, 3),
            }
            for definition_id, value in filtered
        ],
        separators=(",", ":"),
    )


async def replenish_asteroid_fields(now: datetime | None = None) -> int:
    """Retire exhausted fields and create finite random fields up to the system limit."""
    now = now or datetime.now(UTC)
    created = 0
    async with session_factory.begin() as session:
        await expire_jettisoned_items(session, now)
        await expire_market_listings(session, now)
        system = await session.scalar(
            select(SolarSystem).where(SolarSystem.system_key == SYSTEM_ID)
        )
        if system is None:
            return 0
        fields = list(
            await session.scalars(
                select(AsteroidField)
                .where(
                    AsteroidField.system_id == system.id,
                    AsteroidField.active.is_(True),
                )
                .with_for_update(skip_locked=True)
            )
        )
        active_profiles = []
        for field in fields:
            has_mineable_asteroid = await session.scalar(
                select(Asteroid.id).where(
                    Asteroid.field_id == field.id,
                    Asteroid.depleted_at.is_(None),
                    Asteroid.remaining_volume_cubic_meters >= 1,
                )
            )
            if has_mineable_asteroid is None:
                field.active = False
                field.next_spawn_at = None
                continue
            active_profiles.append(json.loads(field.spawn_profile))
        active_count = len(active_profiles)
        for _ in range(max(0, settings.asteroid_system_maximum_active_fields - active_count)):
            profile = random.choice(active_profiles) if active_profiles else DEFAULT_FIELD_PROFILE
            seed = random.randrange(2**31)
            generator = random.Random(seed)
            direction = generator.uniform(-1, 1)
            angle = generator.uniform(0, math.tau)
            radius = generator.uniform(
                settings.sensor_default_range_meters,
                system.radius_meters * 0.9,
            )
            horizontal_radius = math.sqrt(1 - direction**2)
            field = AsteroidField(
                system_id=system.id,
                field_key=f"dynamic-{seed:08x}",
                display_name=f"UNSURVEYED ASTEROID FIELD {seed:08X}",
                position_x=radius * horizontal_radius * math.cos(angle),
                position_y=radius * direction,
                position_z=radius * horizontal_radius * math.sin(angle),
                discovery_signature=generator.uniform(0.6, 1),
                spawn_profile=json.dumps(profile, sort_keys=True),
            )
            session.add(field)
            await session.flush()
            asteroid_count = min(
                max(
                    1,
                    int(
                        profile.get(
                            "maximum_active", settings.asteroid_field_maximum_active_asteroids
                        )
                    ),
                ),
                settings.asteroid_field_maximum_active_asteroids,
            )
            for _ in range(asteroid_count):
                asteroid_seed = random.randrange(2**31)
                asteroid_generator = random.Random(asteroid_seed)
                asteroid_angle = asteroid_generator.uniform(0, math.tau)
                asteroid_distance = asteroid_generator.uniform(800, 6_000)
                asteroid_radius = asteroid_generator.uniform(18, 95)
                volume = round(asteroid_radius * asteroid_generator.uniform(1.8, 3.2), 2)
                session.add(
                    Asteroid(
                        field_id=field.id,
                        spawn_seed=asteroid_seed,
                        position_x=(
                            field.position_x + math.cos(asteroid_angle) * asteroid_distance
                        ),
                        position_y=field.position_y + asteroid_generator.uniform(-900, 900),
                        position_z=field.position_z + math.sin(asteroid_angle) * asteroid_distance,
                        radius_meters=asteroid_radius,
                        composition=str(profile.get("composition", "ferrous")),
                        mineral_assay=mineral_assay_for_profile(profile, asteroid_seed),
                        initial_volume_cubic_meters=volume,
                        remaining_volume_cubic_meters=volume,
                    )
                )
                created += 1
    return created


async def _deliver_refinery_outputs(
    session, job: RefineryJob, container_id
) -> None:
    for output in json.loads(job.expected_outputs):
        matching_stack = await session.scalar(
            select(InventoryItem)
            .where(
                InventoryItem.container_id == container_id,
                InventoryItem.module_definition_id.is_(None),
                InventoryItem.definition_id == output["definition_id"],
                InventoryItem.definition_version == output["definition_version"],
                InventoryItem.durability == 100,
                InventoryItem.volume_per_unit == 1,
            )
            .with_for_update()
        )
        if matching_stack is not None:
            matching_stack.quantity += int(output["quantity_cubic_meters"])
            continue
        session.add(
            InventoryItem(
                pilot_id=job.pilot_id,
                container_id=container_id,
                module_definition_id=None,
                definition_id=output["definition_id"],
                definition_version=int(output["definition_version"]),
                quantity=int(output["quantity_cubic_meters"]),
                durability=100,
                volume_per_unit=1,
            )
        )


async def complete_refinery_jobs(now: datetime | None = None) -> int:
    """Consume due refinery inputs, deliver frozen outputs, and advance queued work."""
    now = now or datetime.now(UTC)
    completed = 0
    async with session_factory.begin() as session:
        due_jobs = list(
            await session.scalars(
                select(RefineryJob)
                .where(RefineryJob.state == "processing", RefineryJob.completes_at <= now)
                .order_by(RefineryJob.completes_at, RefineryJob.queue_sequence)
                .with_for_update(skip_locked=True)
            )
        )
        service_ids: set = set()
        for job in due_jobs:
            source = None
            if job.source_ore_lot_id is not None:
                source = await session.get(MinedOreLot, job.source_ore_lot_id, with_for_update=True)
            elif job.source_inventory_item_id is not None:
                source = await session.get(
                    InventoryItem, job.source_inventory_item_id, with_for_update=True
                )
            if source is None or source.container_id is None:
                job.state = "failed"
                job.failure_reason = "reserved refinery input was unavailable"
                job.source_ore_lot_id = None
                job.source_inventory_item_id = None
                job.completed_at = now
                service_ids.add(job.refinery_service_id)
                continue
            await _deliver_refinery_outputs(session, job, source.container_id)
            job.source_ore_lot_id = None
            job.source_inventory_item_id = None
            job.state = "completed"
            job.completed_at = now
            await session.flush()
            await session.delete(source)
            service_ids.add(job.refinery_service_id)
            completed += 1

        for service_id in service_ids:
            service = await session.get(RefineryService, service_id, with_for_update=True)
            if service is None:
                continue
            processing_count = int(
                await session.scalar(
                    select(func.count())
                    .select_from(RefineryJob)
                    .where(
                        RefineryJob.refinery_service_id == service.id,
                        RefineryJob.state == "processing",
                    )
                )
                or 0
            )
            available_lanes = max(0, service.active_job_capacity - processing_count)
            if not available_lanes:
                continue
            queued_jobs = list(
                await session.scalars(
                    select(RefineryJob)
                    .where(
                        RefineryJob.refinery_service_id == service.id,
                        RefineryJob.state == "queued",
                    )
                    .order_by(RefineryJob.queue_sequence)
                    .limit(available_lanes)
                    .with_for_update(skip_locked=True)
                )
            )
            for queued_job in queued_jobs:
                queued_job.state = "processing"
                queued_job.started_at = now
                queued_job.completes_at = now + timedelta(
                    seconds=queued_job.quoted_duration_seconds
                )
    return completed


async def run_system_world() -> None:
    """Run the future `system:kepler` world tick while co-hosted by the API process."""
    while True:
        await replenish_asteroid_fields()
        await asyncio.sleep(settings.world_spawn_tick_seconds)


async def tick_npc_simulation(now: datetime | None = None) -> int:
    """Advance each active NPC through its own deterministic controller."""
    now = now or datetime.now(UTC)
    active_npcs: list[tuple[Pilot, ShipState, NpcMotion, str | None]] = []
    async with session_factory.begin() as session:
        rows = await session.execute(
            select(Pilot, NpcProfile, NpcRuntime, ShipState)
            .join(NpcProfile, NpcProfile.pilot_id == Pilot.id)
            .join(NpcRuntime, NpcRuntime.pilot_id == Pilot.id)
            .join(ShipState, ShipState.pilot_id == Pilot.id)
            .where(NpcProfile.lifecycle_state == "active")
        )
        for pilot, profile, runtime, ship_state in rows.all():
            if "mine" in json.loads(profile.capabilities):
                await ensure_miner_equipment(session, pilot.id)
                motion = await run_economic_miner(session, pilot.id, runtime, ship_state, now)
            else:
                controller = NpcController(pilot.id, tuple(json.loads(profile.capabilities)))
                motion = controller.advance(
                    now,
                    (ship_state.position_x, ship_state.position_y, ship_state.position_z),
                    runtime,
                )
            ship_state.position_x, ship_state.position_y, ship_state.position_z = motion.position
            active_npcs.append((pilot, ship_state, motion, runtime.warp_phase))
    for pilot, ship_state, motion, warp_phase in active_npcs:
        if ship_state.docked_station_name is not None:
            if await remove_system_presence(SYSTEM_ID, str(pilot.id)):
                await publish_event("system", SYSTEM_ID, "pilot_left", {"pilot_id": str(pilot.id)})
            continue
        presence = {
            "pilot_id": str(pilot.id),
            "display_name": pilot.display_name,
            "ship_type": "starter-corvette",
            "x": ship_state.position_x,
            "y": ship_state.position_y,
            "z": ship_state.position_z,
            "yaw": motion.yaw,
            "pitch": 0,
            "roll": 0,
        }
        if await set_system_presence(SYSTEM_ID, str(pilot.id), presence):
            await publish_event("system", SYSTEM_ID, "pilot_moved", presence)
            await publish_event(
                "system",
                SYSTEM_ID,
                "pilot_mining",
                {
                    "pilot_id": str(pilot.id),
                    "active": motion.behavior_state in ("mining", "mining_cycle_wait"),
                    "source_x": ship_state.position_x,
                    "source_y": ship_state.position_y,
                    "source_z": ship_state.position_z,
                    "target_x": motion.target[0],
                    "target_y": motion.target[1],
                    "target_z": motion.target[2],
                },
            )
            await publish_event(
                "system",
                SYSTEM_ID,
                "pilot_activity",
                {
                    "pilot_id": str(pilot.id),
                    "behavior_state": motion.behavior_state,
                    "warp_phase": warp_phase,
                    "docked": ship_state.docked_station_name is not None,
                    "target_x": motion.target[0],
                    "target_y": motion.target[1],
                    "target_z": motion.target[2],
                },
            )
    return len(active_npcs)


async def run_npc_simulation() -> None:
    """Run NPC simulation independently from slower asteroid replenishment."""
    while True:
        await tick_npc_simulation()
        await asyncio.sleep(1)


async def run_refinery_worker() -> None:
    """Run durable refinery completion independently of the slower world tick."""
    while True:
        await complete_refinery_jobs()
        await asyncio.sleep(settings.refinery_tick_seconds)


async def complete_manufacturing_jobs(now: datetime | None = None) -> int:
    """Consume reserved inputs and deliver each completed module exactly once."""
    now = now or datetime.now(UTC)
    completed = 0
    async with session_factory.begin() as session:
        jobs = list(await session.scalars(select(ManufacturingJob).where(
            ManufacturingJob.state == "processing", ManufacturingJob.completes_at <= now
        ).with_for_update(skip_locked=True)))
        for job in jobs:
            inputs = list(await session.scalars(select(ManufacturingJobInput).where(
                ManufacturingJobInput.manufacturing_job_id == job.id
            ).with_for_update()))
            reserved = [await session.get(InventoryItem, row.inventory_item_id, with_for_update=True)
                        if row.inventory_item_id else None for row in inputs]
            if any(item is None or item.container_id is not None for item in reserved):
                job.state, job.failure_reason, job.completed_at = "failed", "reserved manufacturing input was unavailable", now
                continue
            output = json.loads(job.expected_output)
            item = InventoryItem(
                pilot_id=job.pilot_id, container_id=job.destination_container_id,
                module_definition_id=UUID(output["module_definition_id"]),
                definition_id=output["definition_id"], definition_version=output["definition_version"],
                quantity=output["quantity"], durability=output["durability"],
                volume_per_unit=output["volume_per_unit"],
            )
            session.add(item)
            await session.flush()
            for row, reserved_item in zip(inputs, reserved, strict=True):
                row.inventory_item_id = None
                await session.delete(reserved_item)
            session.add(InventoryLedgerEntry(
                pilot_id=job.pilot_id, manufacturing_job_id=job.id, inventory_item_id=item.id,
                event_kind="manufacturing_completed", definition_id=item.definition_id,
                definition_version=item.definition_version, quantity=item.quantity,
                source_container_id=None, destination_container_id=job.destination_container_id,
                command_id=f"manufacturing:{job.id}:completion",
            ))
            job.state, job.completed_at = "completed", now
            completed += 1
    return completed


async def run_manufacturing_worker() -> None:
    """Run manufacturing completions alongside the refinery worker."""
    while True:
        await complete_manufacturing_jobs()
        await asyncio.sleep(settings.refinery_tick_seconds)
