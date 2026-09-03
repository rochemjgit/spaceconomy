"""Idempotently seed versioned fitting catalog content into PostgreSQL."""

from __future__ import annotations

import asyncio
import json

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import session_factory
from .fitting import (
    CAPACITOR_BANK,
    COMBAT_FRIGATE,
    GENERALIST_HAULER,
    MINING_LASER,
    SHIELD_BOOSTER,
    STARTER_MINER,
)
from .fitting import (
    HullDefinition as DomainHullDefinition,
)
from .fitting import (
    ModuleDefinition as DomainModuleDefinition,
)
from .models import HullDefinition, ModuleDefinition, ModuleEffect


async def seed_catalog() -> None:
    """Upsert the immutable catalog versions currently used by the fitting domain."""
    async with session_factory.begin() as session:
        for hull_definition in (STARTER_MINER, COMBAT_FRIGATE, GENERALIST_HAULER):
            await _upsert_hull(session, hull_definition)
        for module_definition in (MINING_LASER, SHIELD_BOOSTER, CAPACITOR_BANK):
            await _upsert_module(session, module_definition)


async def _upsert_hull(session: AsyncSession, definition: DomainHullDefinition) -> None:
    result = await session.execute(
        select(HullDefinition).where(
            HullDefinition.definition_id == definition.definition_id,
            HullDefinition.version == definition.version,
        )
    )
    row = result.scalar_one_or_none()
    values = {
        "display_name": definition.display_name,
        "universal_hardpoint_count": definition.universal_hardpoint_count,
        "core_system_slot_count": definition.core_system_slot_count,
        "base_statistics": json.dumps(definition.base_statistics, sort_keys=True),
        "active": True,
    }
    if row is None:
        session.add(
            HullDefinition(
                definition_id=definition.definition_id,
                version=definition.version,
                **values,
            )
        )
    else:
        for field, value in values.items():
            setattr(row, field, value)


async def _upsert_module(session: AsyncSession, definition: DomainModuleDefinition) -> None:
    result = await session.execute(
        select(ModuleDefinition).where(
            ModuleDefinition.definition_id == definition.definition_id,
            ModuleDefinition.version == definition.version,
        )
    )
    row = result.scalar_one_or_none()
    values = {
        "display_name": definition.display_name,
        "family": definition.family,
        "fit_location": definition.fit_location.value,
        "cpu_demand": definition.cpu_demand,
        "powergrid_demand": definition.powergrid_demand,
        "durability_maximum": definition.durability_maximum,
        "active": True,
    }
    if row is None:
        row = ModuleDefinition(
            definition_id=definition.definition_id,
            version=definition.version,
            **values,
        )
        session.add(row)
        await session.flush()
    else:
        for field, value in values.items():
            setattr(row, field, value)
        await session.execute(
            delete(ModuleEffect).where(ModuleEffect.module_definition_id == row.id)
        )
    for effect_index, effect in enumerate(definition.passive_effects):
        session.add(
            ModuleEffect(
                module_definition_id=row.id,
                effect_index=effect_index,
                statistic=effect.statistic,
                operation=effect.operation.value,
                value=effect.value,
            )
        )


def main() -> None:
    """Run catalog seeding as a module command."""
    asyncio.run(seed_catalog())


if __name__ == "__main__":
    main()