"""Authoritative Phase III ship fitting definitions and operations."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from collections.abc import Iterable
from typing import Final


class SlotLocation(StrEnum):
    """The two Phase III fitting locations available on a player ship."""

    UNIVERSAL_HARDPOINT = "universal_hardpoint"
    CORE_SYSTEM = "core_system"


class ModifierOperation(StrEnum):
    """Deterministic operations supported by definition-driven effects."""

    FLAT = "flat"
    PERCENT = "percent"
    MULTIPLIER = "multiplier"
    CAP = "cap"
    FLOOR = "floor"


@dataclass(frozen=True, slots=True)
class StatisticModifier:
    statistic: str
    operation: ModifierOperation
    value: float


@dataclass(frozen=True, slots=True)
class HullDefinition:
    definition_id: str
    version: int
    display_name: str
    universal_hardpoint_count: int
    core_system_slot_count: int
    base_statistics: dict[str, float]


@dataclass(frozen=True, slots=True)
class ModuleDefinition:
    definition_id: str
    version: int
    display_name: str
    family: str
    fit_location: SlotLocation
    cpu_demand: float
    powergrid_demand: float
    durability_maximum: float
    passive_effects: tuple[StatisticModifier, ...] = ()


@dataclass(slots=True)
class ModuleItem:
    item_id: str
    definition: ModuleDefinition
    station_id: str
    owner_id: str
    durability: float


@dataclass(frozen=True, slots=True)
class FittedModule:
    slot_location: SlotLocation
    slot_index: int
    item_id: str
    definition_id: str
    definition_version: int
    durability: float


@dataclass(frozen=True, slots=True)
class FittingSnapshot:
    ship_id: str
    hull_definition_id: str
    docked_station_id: str | None
    fitted_modules: tuple[FittedModule, ...]
    statistics: dict[str, float]


class FittingError(ValueError):
    """Stable validation failure returned by a fitting command."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class FittingService:
    """Own ship fitting mutations and derived-stat calculation in one boundary."""

    def __init__(self, ship_id: str, owner_id: str, hull: HullDefinition, station_id: str) -> None:
        self.ship_id = ship_id
        self.owner_id = owner_id
        self.hull = hull
        self.docked_station_id: str | None = station_id
        self._station_items: dict[str, ModuleItem] = {}
        self._fitted: dict[tuple[SlotLocation, int], ModuleItem] = {}
        self._idempotent_results: dict[str, FittingSnapshot | FittingError] = {}

    def add_station_item(self, item: ModuleItem) -> None:
        if item.owner_id != self.owner_id:
            raise FittingError("item_not_owned")
        self._station_items[item.item_id] = item

    def fit(
        self,
        item_id: str,
        slot_location: SlotLocation,
        slot_index: int,
        idempotency_key: str,
    ) -> FittingSnapshot:
        cached_result = self._idempotent_results.get(idempotency_key)
        if cached_result is not None:
            if isinstance(cached_result, FittingError):
                raise cached_result
            return cached_result
        try:
            result = self._fit(item_id, slot_location, slot_index)
        except FittingError as error:
            self._idempotent_results[idempotency_key] = error
            raise
        self._idempotent_results[idempotency_key] = result
        return result

    def _fit(self, item_id: str, slot_location: SlotLocation, slot_index: int) -> FittingSnapshot:
        if self.docked_station_id is None:
            raise FittingError("ship_not_docked")
        item = self._station_items.get(item_id)
        if item is None:
            raise FittingError("item_not_in_docked_station_storage")
        if item.station_id != self.docked_station_id:
            raise FittingError("item_not_in_docked_station_storage")
        if item.definition.fit_location != slot_location:
            raise FittingError("invalid_slot_location")
        if item.durability <= 0:
            raise FittingError("module_broken")
        slot = (slot_location, slot_index)
        if not self._is_slot_valid(slot_location, slot_index):
            raise FittingError("slot_unavailable")
        if slot in self._fitted:
            raise FittingError("slot_occupied")

        candidate = {**self._fitted, slot: item}
        statistics = self._derive_statistics(candidate.values())
        if statistics["cpu_used"] > statistics["cpu_available"]:
            raise FittingError("cpu_exceeded")
        if statistics["powergrid_used"] > statistics["powergrid_available"]:
            raise FittingError("powergrid_exceeded")

        self._fitted = candidate
        del self._station_items[item_id]
        return self.snapshot()

    def unfit(self, slot_location: SlotLocation, slot_index: int, idempotency_key: str) -> FittingSnapshot:
        cached_result = self._idempotent_results.get(idempotency_key)
        if cached_result is not None:
            if isinstance(cached_result, FittingError):
                raise cached_result
            return cached_result
        try:
            result = self._unfit(slot_location, slot_index)
        except FittingError as error:
            self._idempotent_results[idempotency_key] = error
            raise
        self._idempotent_results[idempotency_key] = result
        return result

    def _unfit(self, slot_location: SlotLocation, slot_index: int) -> FittingSnapshot:
        if self.docked_station_id is None:
            raise FittingError("ship_not_docked")
        slot = (slot_location, slot_index)
        item = self._fitted.get(slot)
        if item is None:
            raise FittingError("slot_empty")
        item.station_id = self.docked_station_id
        self._station_items[item.item_id] = item
        del self._fitted[slot]
        return self.snapshot()

    def snapshot(self) -> FittingSnapshot:
        fitted_modules = tuple(
            FittedModule(
                slot_location=location,
                slot_index=index,
                item_id=item.item_id,
                definition_id=item.definition.definition_id,
                definition_version=item.definition.version,
                durability=item.durability,
            )
            for (location, index), item in sorted(self._fitted.items(), key=lambda entry: (entry[0][0], entry[0][1]))
        )
        return FittingSnapshot(
            ship_id=self.ship_id,
            hull_definition_id=self.hull.definition_id,
            docked_station_id=self.docked_station_id,
            fitted_modules=fitted_modules,
            statistics=self._derive_statistics(self._fitted.values()),
        )

    def _is_slot_valid(self, location: SlotLocation, index: int) -> bool:
        limit = self.hull.universal_hardpoint_count if location is SlotLocation.UNIVERSAL_HARDPOINT else self.hull.core_system_slot_count
        return 0 <= index < limit

    def _derive_statistics(self, modules: Iterable[ModuleItem]) -> dict[str, float]:
        statistics = dict(self.hull.base_statistics)
        statistics["cpu_used"] = 0.0
        statistics["powergrid_used"] = 0.0
        flat: list[StatisticModifier] = []
        percentages: list[StatisticModifier] = []
        multipliers: list[StatisticModifier] = []
        caps: list[StatisticModifier] = []
        floors: list[StatisticModifier] = []
        for item in modules:
            statistics["cpu_used"] += item.definition.cpu_demand
            statistics["powergrid_used"] += item.definition.powergrid_demand
            for modifier in item.definition.passive_effects:
                match modifier.operation:
                    case ModifierOperation.FLAT:
                        flat.append(modifier)
                    case ModifierOperation.PERCENT:
                        percentages.append(modifier)
                    case ModifierOperation.MULTIPLIER:
                        multipliers.append(modifier)
                    case ModifierOperation.CAP:
                        caps.append(modifier)
                    case ModifierOperation.FLOOR:
                        floors.append(modifier)
        for group in (flat, percentages, multipliers, caps, floors):
            for modifier in group:
                current = statistics.get(modifier.statistic, 0.0)
                if modifier.operation is ModifierOperation.FLAT:
                    statistics[modifier.statistic] = current + modifier.value
                elif modifier.operation is ModifierOperation.PERCENT:
                    statistics[modifier.statistic] = current * (1 + modifier.value)
                elif modifier.operation is ModifierOperation.MULTIPLIER:
                    statistics[modifier.statistic] = current * modifier.value
                elif modifier.operation is ModifierOperation.CAP:
                    statistics[modifier.statistic] = min(current, modifier.value)
                else:
                    statistics[modifier.statistic] = max(current, modifier.value)
        return statistics


STARTER_MINER: Final = HullDefinition(
    definition_id="hull.starter_miner",
    version=1,
    display_name="Starter Miner",
    universal_hardpoint_count=3,
    core_system_slot_count=2,
    base_statistics={
        "cpu_available": 100.0,
        "powergrid_available": 80.0,
        "cargo_volume": 80.0,
        "capacitor_capacity": 100.0,
        "capacitor_recharge": 6.0,
        "mining_yield": 1.0,
        "maximum_speed": 120.0,
        "shield_capacity": 60.0,
        "armor": 25.0,
        "hull_durability": 100.0,
    },
)

COMBAT_FRIGATE: Final = HullDefinition(
    definition_id="hull.combat_frigate",
    version=1,
    display_name="Combat Frigate",
    universal_hardpoint_count=4,
    core_system_slot_count=3,
    base_statistics={**STARTER_MINER.base_statistics, "cargo_volume": 35.0, "maximum_speed": 180.0, "shield_capacity": 100.0},
)

GENERALIST_HAULER: Final = HullDefinition(
    definition_id="hull.generalist_hauler",
    version=1,
    display_name="Generalist Hauler",
    universal_hardpoint_count=5,
    core_system_slot_count=4,
    base_statistics={**STARTER_MINER.base_statistics, "cargo_volume": 180.0, "maximum_speed": 75.0, "powergrid_available": 125.0},
)

MINING_LASER: Final = ModuleDefinition(
    definition_id="module.mining_laser.m1",
    version=1,
    display_name="M1 Mining Laser",
    family="mining_laser",
    fit_location=SlotLocation.UNIVERSAL_HARDPOINT,
    cpu_demand=18.0,
    powergrid_demand=14.0,
    durability_maximum=100.0,
    passive_effects=(StatisticModifier("mining_yield", ModifierOperation.PERCENT, 0.2),),
)

SHIELD_BOOSTER: Final = ModuleDefinition(
    definition_id="module.shield_booster.s1",
    version=1,
    display_name="S1 Shield Booster",
    family="shield_system",
    fit_location=SlotLocation.UNIVERSAL_HARDPOINT,
    cpu_demand=25.0,
    powergrid_demand=22.0,
    durability_maximum=100.0,
    passive_effects=(StatisticModifier("shield_capacity", ModifierOperation.FLAT, 30.0),),
)

CAPACITOR_BANK: Final = ModuleDefinition(
    definition_id="module.capacitor_bank.c1",
    version=1,
    display_name="C1 Capacitor Bank",
    family="core_system",
    fit_location=SlotLocation.CORE_SYSTEM,
    cpu_demand=12.0,
    powergrid_demand=16.0,
    durability_maximum=100.0,
    passive_effects=(StatisticModifier("capacitor_capacity", ModifierOperation.FLAT, 40.0),),
)


def create_demo_fitting_service() -> FittingService:
    """Provide deterministic development data until persistent pilots are available."""

    service = FittingService("ship.demo.1", "pilot.demo.1", STARTER_MINER, "station.kepler")
    service.add_station_item(ModuleItem("item.mining_laser.1", MINING_LASER, "station.kepler", "pilot.demo.1", 100.0))
    service.add_station_item(ModuleItem("item.shield_booster.1", SHIELD_BOOSTER, "station.kepler", "pilot.demo.1", 100.0))
    service.add_station_item(ModuleItem("item.capacitor_bank.1", CAPACITOR_BANK, "station.kepler", "pilot.demo.1", 100.0))
    return service