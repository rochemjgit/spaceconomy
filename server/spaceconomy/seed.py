"""Idempotently seed versioned fitting catalog content into PostgreSQL."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import session_factory
from .fitting import (
    CAPACITOR_BANK,
    COMBAT_FRIGATE,
    GENERALIST_HAULER,
    MINING_LASER,
    MINING_LASER_M2,
    REACTOR_CORE,
    SHIELD_BOOSTER,
    STARTER_MINER,
    WARP_DRIVE,
)
from .fitting import (
    HullDefinition as DomainHullDefinition,
)
from .fitting import (
    ModuleDefinition as DomainModuleDefinition,
)
from .models import (
    Asteroid,
    AsteroidField,
    HullDefinition,
    ManufacturingRecipe,
    ManufacturingRecipeInput,
    ManufacturingService,
    MineralDefinition,
    ModuleDefinition,
    ModuleEffect,
    RefineryService,
    SolarSystem,
)
from .world import mineral_assay_for_profile

KEPLER_STATION_ID = "4e32a9a9-5551-4e3f-9b9b-b6b6e22a4f04"
STARTER_MODULE_DEFINITION_IDS = frozenset(
    {
        "module.mining_laser.m1",
        "module.shield_booster.s1",
        "module.capacitor_bank.c1",
        "module.reactor.r1",
        "module.warp_drive.w1",
    }
)

MINERAL_DEFINITIONS = (
    ("iron", "Iron", "scientific", "abundant"),
    ("nickel", "Nickel", "scientific", "abundant"),
    ("cobalt", "Cobalt", "scientific", "uncommon"),
    ("silicon", "Silicon", "scientific", "abundant"),
    ("magnesium", "Magnesium", "scientific", "abundant"),
    ("aluminum", "Aluminum", "scientific", "uncommon"),
    ("calcium", "Calcium", "scientific", "uncommon"),
    ("titanium", "Titanium", "scientific", "uncommon"),
    ("carbon", "Carbon", "scientific", "abundant"),
    ("sulfur", "Sulfur", "scientific", "uncommon"),
    ("water_ice", "Water Ice", "scientific", "abundant"),
    ("chromium", "Chromium", "scientific", "rare"),
    ("manganese", "Manganese", "scientific", "rare"),
    ("platinum_group", "Platinum Group Metals", "scientific", "rare"),
    ("aetherium", "Aetherium", "fictional", "exotic"),
    ("gravimetric_crystal", "Gravimetric Crystal", "fictional", "exotic"),
    ("nullite", "Nullite", "fictional", "exotic"),
)

FIELD_PROFILES = {
    "ferrous": {
        "variants": [{"weight": 1, "minerals": (("iron", 55, 75), ("nickel", 15, 30), ("cobalt", 2, 10), ("chromium", 0.5, 4), ("platinum_group", 0.1, 1.5))}],
    },
    "silicate": {
        "variants": [{"weight": 1, "minerals": (("silicon", 28, 45), ("magnesium", 15, 30), ("aluminum", 8, 20), ("calcium", 4, 14), ("titanium", 1, 8), ("iron", 3, 12), ("nickel", 1, 6))}],
    },
    "rare": {
        "variants": [
            {"weight": 97, "minerals": (("carbon", 25, 42), ("water_ice", 18, 35), ("sulfur", 8, 20), ("iron", 8, 22), ("nickel", 3, 12), ("manganese", 0.5, 5), ("platinum_group", 0.1, 2))},
            {"weight": 3, "minerals": (("carbon", 20, 35), ("water_ice", 12, 25), ("iron", 8, 20), ("aetherium", 0.05, 0.5), ("gravimetric_crystal", 0.05, 0.5), ("nullite", 0.05, 0.5), ("platinum_group", 1, 6))},
        ],
    },
}


async def seed_catalog() -> None:
    """Upsert the immutable catalog versions currently used by the fitting domain."""
    async with session_factory.begin() as session:
        for definition_id, display_name, classification, rarity_tier in MINERAL_DEFINITIONS:
            await _upsert_mineral(session, definition_id, display_name, classification, rarity_tier)
        for hull_definition in (STARTER_MINER, COMBAT_FRIGATE, GENERALIST_HAULER):
            await _upsert_hull(session, hull_definition)
        for module_definition in (
            MINING_LASER,
            MINING_LASER_M2,
            SHIELD_BOOSTER,
            CAPACITOR_BANK,
            REACTOR_CORE,
            WARP_DRIVE,
        ):
            await _upsert_module(session, module_definition)
        await _upsert_starter_refinery(session)
        await _upsert_manufacturing_catalog(session)
        await _upsert_system(session)
        rows = await session.execute(select(Asteroid, AsteroidField).join(AsteroidField, Asteroid.field_id == AsteroidField.id))
        for asteroid, field in rows:
            if asteroid.mineral_assay == "[]":
                asteroid.mineral_assay = mineral_assay_for_profile(json.loads(field.spawn_profile), asteroid.spawn_seed)


async def _upsert_system(session: AsyncSession) -> SolarSystem:
    result = await session.execute(select(SolarSystem).where(SolarSystem.system_key == "kepler"))
    system = result.scalar_one_or_none()
    if system is None:
        system = SolarSystem(system_key="kepler", display_name="KEPLER", radius_meters=settings.system_radius_meters)
        session.add(system)
        await session.flush()
    else:
        system.display_name = "KEPLER"
        system.radius_meters = settings.system_radius_meters
    return system


async def _upsert_asteroid_field(
    session: AsyncSession,
    system: SolarSystem,
    field_key: str,
    display_name: str,
    position_x: float,
    position_y: float,
    position_z: float,
    discovery_signature: float,
    composition: str,
) -> None:
    result = await session.execute(
        select(AsteroidField).where(
            AsteroidField.system_id == system.id,
            AsteroidField.field_key == field_key,
        )
    )
    field = result.scalar_one_or_none()
    values = {
        "display_name": display_name,
        "position_x": position_x,
        "position_y": position_y,
        "position_z": position_z,
        "discovery_signature": discovery_signature,
        "spawn_profile": json.dumps(
            {
                "composition": composition,
                "variants": FIELD_PROFILES[composition]["variants"],
                "batch_size": 4 if field_key == "kepler_test" else settings.asteroid_spawn_batch_size,
                "maximum_active": 8 if field_key == "kepler_test" else settings.asteroid_field_maximum_active_asteroids,
                "spawn_radius_minimum_meters": 300 if field_key == "kepler_test" else 800,
                "spawn_radius_maximum_meters": 600 if field_key == "kepler_test" else 6_000,
            },
            sort_keys=True,
        ),
        "active": True,
    }
    if field is None:
        session.add(AsteroidField(system_id=system.id, field_key=field_key, **values))
    else:
        for name, value in values.items():
            setattr(field, name, value)


async def _upsert_mineral(
    session: AsyncSession,
    definition_id: str,
    display_name: str,
    classification: str,
    rarity_tier: str,
) -> None:
    row = await session.scalar(
        select(MineralDefinition).where(
            MineralDefinition.definition_id == definition_id,
            MineralDefinition.version == 1,
        )
    )
    values = {
        "display_name": display_name,
        "classification": classification,
        "rarity_tier": rarity_tier,
        "active": True,
    }
    if row is None:
        session.add(MineralDefinition(definition_id=definition_id, version=1, **values))
    else:
        for name, value in values.items():
            setattr(row, name, value)


async def _upsert_starter_refinery(session: AsyncSession) -> None:
    row = await session.scalar(
        select(RefineryService).where(
            RefineryService.station_id == KEPLER_STATION_ID,
            RefineryService.service_key == "starter_refinery",
        )
    )
    values = {
        "display_name": "Kepler Starter Refinery",
        "first_pass_seconds_per_cubic_meter": 1.0,
        "second_pass_seconds_per_cubic_meter": 1.0,
        "first_pass_efficiency": 0.5,
        "second_pass_efficiency": 0.5,
        "fee_credits": 0,
        "active_job_capacity": 1,
        "queue_capacity": 5,
        "active": True,
    }
    if row is None:
        session.add(
            RefineryService(
                station_id=KEPLER_STATION_ID,
                service_key="starter_refinery",
                **values,
            )
        )
    else:
        for name, value in values.items():
            setattr(row, name, value)


def _manufacturing_catalog() -> dict[str, Any]:
    path = Path(settings.manufacturing_recipe_catalog_path)
    if not path.is_absolute():
        path = Path(__file__).resolve().parent.parent / path
    try:
        catalog = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise RuntimeError(f"manufacturing recipe catalog was not found: {path}") from error
    except json.JSONDecodeError as error:
        raise RuntimeError(f"manufacturing recipe catalog is not valid JSON: {path}") from error
    if (
        not isinstance(catalog, dict)
        or not isinstance(catalog.get("services"), list)
        or not isinstance(catalog.get("recipes"), list)
    ):
        raise RuntimeError("manufacturing recipe catalog requires services and recipes arrays")
    return catalog


async def _upsert_manufacturing_catalog(session: AsyncSession) -> None:
    catalog = _manufacturing_catalog()
    for service_data in catalog["services"]:
        if not isinstance(service_data, dict):
            raise RuntimeError("manufacturing service entries must be objects")
        service_key = _catalog_string(service_data, "service_key")
        service = await session.scalar(select(ManufacturingService).where(
            ManufacturingService.station_id == KEPLER_STATION_ID,
            ManufacturingService.service_key == service_key,
        ))
        values = {
            "display_name": _catalog_string(service_data, "display_name"),
            "seconds_per_run": _catalog_positive_number(service_data, "seconds_per_run"),
            "fee_credits": _catalog_non_negative_integer(service_data, "fee_credits"),
            "active_job_capacity": _catalog_positive_integer(service_data, "active_job_capacity"),
            "queue_capacity": _catalog_positive_integer(service_data, "queue_capacity"),
            "active": _catalog_boolean(service_data, "active"),
        }
        if service is None:
            session.add(
                ManufacturingService(
                    station_id=KEPLER_STATION_ID, service_key=service_key, **values
                )
            )
        else:
            for name, value in values.items():
                setattr(service, name, value)

    for recipe_data in catalog["recipes"]:
        if not isinstance(recipe_data, dict):
            raise RuntimeError("manufacturing recipe entries must be objects")
        recipe_id = _catalog_string(recipe_data, "recipe_id")
        version = _catalog_positive_integer(recipe_data, "version")
        output_data = recipe_data.get("output")
        inputs_data = recipe_data.get("inputs")
        if (
            not isinstance(output_data, dict)
            or not isinstance(inputs_data, list)
            or not inputs_data
        ):
            raise RuntimeError(f"manufacturing recipe {recipe_id} requires an output and inputs")
        output = await session.scalar(select(ModuleDefinition).where(
            ModuleDefinition.definition_id == _catalog_string(output_data, "definition_id"),
            ModuleDefinition.version
            == _catalog_positive_integer(output_data, "definition_version"),
        ))
        if output is None:
            raise RuntimeError(
                f"manufacturing recipe {recipe_id} references an unknown module output"
            )
        inputs = [
            (_catalog_string(input_data, "definition_id"),
             _catalog_positive_integer(input_data, "definition_version"),
             _catalog_positive_integer(input_data, "quantity"))
            for input_data in inputs_data
            if isinstance(input_data, dict)
        ]
        if len(inputs) != len(inputs_data):
            raise RuntimeError(f"manufacturing recipe {recipe_id} inputs must be objects")
        values = {
            "service_key": _catalog_string(recipe_data, "service_key"),
            "display_name": _catalog_string(recipe_data, "display_name"),
            "output_module_definition_id": output.id,
            "output_quantity": _catalog_positive_integer(output_data, "quantity"),
            "active": _catalog_boolean(recipe_data, "active"),
        }
        recipe = await session.scalar(select(ManufacturingRecipe).where(
            ManufacturingRecipe.recipe_id == recipe_id, ManufacturingRecipe.version == version,
        ))
        if recipe is not None:
            existing_inputs = [
                (row.definition_id, row.definition_version, row.quantity)
                for row in await session.scalars(
                    select(ManufacturingRecipeInput)
                    .where(ManufacturingRecipeInput.manufacturing_recipe_id == recipe.id)
                    .order_by(ManufacturingRecipeInput.input_index)
                )
            ]
            existing_values = {name: getattr(recipe, name) for name in values}
            if existing_values != values or existing_inputs != inputs:
                raise RuntimeError(
                    f"manufacturing recipe {recipe_id} version {version} is immutable; "
                    "add a new version"
                )
            continue
        recipe = ManufacturingRecipe(recipe_id=recipe_id, version=version, **values)
        session.add(recipe)
        await session.flush()
        for input_index, (definition_id, definition_version, quantity) in enumerate(inputs):
            session.add(
                ManufacturingRecipeInput(
                    manufacturing_recipe_id=recipe.id,
                    input_index=input_index,
                    definition_id=definition_id,
                    definition_version=definition_version,
                    quantity=quantity,
                )
            )


def _catalog_string(data: dict[str, Any], name: str) -> str:
    value = data.get(name)
    if not isinstance(value, str) or not value:
        raise RuntimeError(f"manufacturing catalog {name} must be a non-empty string")
    return value


def _catalog_boolean(data: dict[str, Any], name: str) -> bool:
    value = data.get(name)
    if not isinstance(value, bool):
        raise RuntimeError(f"manufacturing catalog {name} must be a boolean")
    return value


def _catalog_positive_number(data: dict[str, Any], name: str) -> float:
    value = data.get(name)
    if not isinstance(value, (int, float)) or isinstance(value, bool) or value <= 0:
        raise RuntimeError(f"manufacturing catalog {name} must be positive")
    return float(value)


def _catalog_positive_integer(data: dict[str, Any], name: str) -> int:
    value = data.get(name)
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise RuntimeError(f"manufacturing catalog {name} must be a positive integer")
    return value


def _catalog_non_negative_integer(data: dict[str, Any], name: str) -> int:
    value = data.get(name)
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise RuntimeError(f"manufacturing catalog {name} must be a non-negative integer")
    return value


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
        "mass_kg": definition.mass_kg,
        "volume_cubic_meters": definition.volume_cubic_meters,
        "effective_range_meters": definition.effective_range_meters,
        "starter_grant": definition.starter_grant,
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