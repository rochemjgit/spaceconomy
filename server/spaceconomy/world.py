"""Durable asteroid field replenishment owned by the in-space system service."""

from __future__ import annotations

import asyncio
import json
import math
import random
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select

from .config import settings
from .db import session_factory
from .inventory import expire_jettisoned_items
from .models import Asteroid, AsteroidField, JettisonedItem, MinedOreLot


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
    """Spawn one configured batch per due field without exceeding its active limit."""
    now = now or datetime.now(UTC)
    created = 0
    async with session_factory.begin() as session:
        await expire_jettisoned_items(session, now)
        fields = list(
            await session.scalars(
                select(AsteroidField)
                .where(
                    AsteroidField.active.is_(True),
                    (AsteroidField.next_spawn_at.is_(None)) | (AsteroidField.next_spawn_at <= now),
                )
                .with_for_update(skip_locked=True)
            )
        )
        for field in fields:
            profile = json.loads(field.spawn_profile)
            existing_asteroids = list(
                await session.scalars(select(Asteroid).where(Asteroid.field_id == field.id))
            )
            for asteroid in existing_asteroids:
                if asteroid.mineral_assay == "[]":
                    asteroid.mineral_assay = mineral_assay_for_profile(profile, asteroid.spawn_seed)
            maximum_active = min(
                int(
                    profile.get("maximum_active", settings.asteroid_field_maximum_active_asteroids)
                ),
                settings.asteroid_field_maximum_active_asteroids,
            )
            active_count = await session.scalar(
                select(func.count())
                .select_from(Asteroid)
                .where(
                    Asteroid.field_id == field.id,
                    Asteroid.depleted_at.is_(None),
                )
            )
            excess_count = max(0, int(active_count or 0) - maximum_active)
            if excess_count:
                removable_ids = list(
                    await session.scalars(
                        select(Asteroid.id)
                        .where(
                            Asteroid.field_id == field.id,
                            Asteroid.depleted_at.is_(None),
                            ~Asteroid.id.in_(select(MinedOreLot.asteroid_id)),
                            ~select(JettisonedItem.id)
                            .where(JettisonedItem.ore_asteroid_id == Asteroid.id)
                            .exists(),
                        )
                        .order_by(Asteroid.created_at)
                        .limit(excess_count)
                    )
                )
                if removable_ids:
                    await session.execute(delete(Asteroid).where(Asteroid.id.in_(removable_ids)))
                    active_count = int(active_count or 0) - len(removable_ids)
            batch_size = min(
                int(profile.get("batch_size", settings.asteroid_spawn_batch_size)),
                maximum_active - int(active_count or 0),
            )
            for _ in range(max(0, batch_size)):
                seed = random.randrange(2**31)
                generator = random.Random(seed)
                angle = generator.uniform(0, math.tau)
                radius = generator.uniform(
                    float(profile.get("spawn_radius_minimum_meters", 800)),
                    float(profile.get("spawn_radius_maximum_meters", 6_000)),
                )
                vertical_offset = generator.uniform(-900, 900)
                asteroid_radius = generator.uniform(18, 95)
                volume = round(asteroid_radius * generator.uniform(1.8, 3.2), 2)
                session.add(
                    Asteroid(
                        field_id=field.id,
                        spawn_seed=seed,
                        position_x=field.position_x + math.cos(angle) * radius,
                        position_y=field.position_y + vertical_offset,
                        position_z=field.position_z + math.sin(angle) * radius,
                        radius_meters=asteroid_radius,
                        composition=str(profile.get("composition", "ferrous")),
                        mineral_assay=mineral_assay_for_profile(profile, seed),
                        initial_volume_cubic_meters=volume,
                        remaining_volume_cubic_meters=volume,
                    )
                )
                created += 1
            field.next_spawn_at = now + timedelta(seconds=settings.asteroid_spawn_interval_seconds)
    return created


async def run_system_world() -> None:
    """Run the future `system:kepler` world tick while co-hosted by the API process."""
    while True:
        await replenish_asteroid_fields()
        await asyncio.sleep(settings.world_spawn_tick_seconds)
