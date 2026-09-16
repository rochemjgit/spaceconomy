"""Validated mineral content and deterministic zone-class assays."""

import math
import random
from pathlib import Path
from typing import Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, model_validator


class MineralContent(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    definition_id: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    display_name: str = Field(min_length=1, max_length=128)
    industrial_role: str = Field(min_length=1, max_length=256)
    visual_family: Literal["metallic", "crystalline", "rocky", "icy"]
    display_color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    starter_weight: float = Field(gt=0, allow_inf_nan=False)
    deep_weight: float = Field(gt=0, allow_inf_nan=False)


class ZoneClassContent(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    zone_class: int = Field(ge=1, le=10)
    display_color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    component_weights: tuple[float, ...] = Field(min_length=6, max_length=6)

    @model_validator(mode="after")
    def validate_weights(self) -> ZoneClassContent:
        if any(not math.isfinite(weight) or weight < 0 for weight in self.component_weights):
            raise ValueError("Component weights must be finite and non-negative")
        if sum(self.component_weights) <= 0:
            raise ValueError("At least one component count must be possible")
        return self


class MineralCatalog(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    version: int = Field(ge=1)
    minerals: tuple[MineralContent, ...] = Field(min_length=6)
    zone_classes: tuple[ZoneClassContent, ...]

    @model_validator(mode="after")
    def validate_catalog(self) -> MineralCatalog:
        identifiers = [mineral.definition_id for mineral in self.minerals]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("Mineral identifiers must be unique")
        if sorted(zone.zone_class for zone in self.zone_classes) != list(range(1, 11)):
            raise ValueError("Exactly one profile is required for each class from 1 to 10")
        return self

    def zone(self, zone_class: int) -> ZoneClassContent:
        if isinstance(zone_class, bool) or not isinstance(zone_class, int):
            raise ValueError("Zone class must be an integer from 1 to 10")
        for zone in self.zone_classes:
            if zone.zone_class == zone_class:
                return zone
        raise ValueError("Zone class must be an integer from 1 to 10")

    def weights(self, zone_class: int) -> dict[str, float]:
        self.zone(zone_class)
        fraction = (zone_class - 1) / 9
        return {
            mineral.definition_id: mineral.starter_weight
            + (mineral.deep_weight - mineral.starter_weight) * fraction
            for mineral in self.minerals
        }


def load_mineral_catalog() -> MineralCatalog:
    path = Path(__file__).resolve().parent.parent / "catalog" / "minerals.json"
    return MineralCatalog.model_validate_json(path.read_text(encoding="utf-8"))


class ZoneRegion(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    min_x: float
    max_x: float
    min_z: float
    max_z: float


class ResourceZone(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    zone_id: str
    zone_class: int = Field(ge=1, le=10)
    display_color: str
    regions: list[ZoneRegion]


ZONE_CELL_SIZE_METERS = 100_000_000
ZONE_GRID_MINIMUM_CELL = -50
ZONE_GRID_MAXIMUM_CELL = 50


def _value_noise(seed: int, cell_x: int, cell_z: int, scale: int) -> float:
    """Return deterministic bilinear value noise at one zone cell center."""
    grid_x, offset_x = divmod(cell_x - ZONE_GRID_MINIMUM_CELL, scale)
    grid_z, offset_z = divmod(cell_z - ZONE_GRID_MINIMUM_CELL, scale)
    fraction_x = offset_x / scale
    fraction_z = offset_z / scale

    def sample(sample_x: int, sample_z: int) -> float:
        return random.Random(f"{seed}:{scale}:{sample_x}:{sample_z}").random()

    lower_left = sample(grid_x, grid_z)
    lower_right = sample(grid_x + 1, grid_z)
    upper_left = sample(grid_x, grid_z + 1)
    upper_right = sample(grid_x + 1, grid_z + 1)
    lower = lower_left + (lower_right - lower_left) * fraction_x
    upper = upper_left + (upper_right - upper_left) * fraction_x
    return lower + (upper - lower) * fraction_z


def _smooth_zone_classes(seed: int) -> dict[tuple[int, int], int]:
    """Generate a varied cell field whose cardinal neighbors differ by at most one."""
    classes = {
        (cell_x, cell_z): min(
            10,
            max(
                1,
                round(
                    1
                    + 9
                    * min(
                        1,
                        max(
                            0,
                            (
                                0.7 * _value_noise(seed, cell_x, cell_z, 12)
                                + 0.3 * _value_noise(seed, cell_x, cell_z, 4)
                                - 0.5
                            ) * 1.4 + 0.5,
                        ),
                    )
                ),
            ),
        )
        for cell_x in range(ZONE_GRID_MINIMUM_CELL, ZONE_GRID_MAXIMUM_CELL)
        for cell_z in range(ZONE_GRID_MINIMUM_CELL, ZONE_GRID_MAXIMUM_CELL)
    }
    changed = True
    while changed:
        changed = False
        for cell_x, cell_z in classes:
            neighbor_classes = [
                classes[neighbor]
                for neighbor in ((cell_x - 1, cell_z), (cell_x + 1, cell_z), (cell_x, cell_z - 1), (cell_x, cell_z + 1))
                if neighbor in classes
            ]
            constrained_class = min(classes[cell_x, cell_z], min(neighbor_classes) + 1)
            if constrained_class != classes[cell_x, cell_z]:
                classes[cell_x, cell_z] = constrained_class
                changed = True
    return classes


def _primary_star_zone_class(cell_x: int, cell_z: int) -> int | None:
    """Return the fixed radial class near the primary star, if one applies."""
    distance = math.hypot(cell_x + 0.5, cell_z + 0.5)
    if distance <= 3:
        return 10
    if distance < 10:
        return 10 - math.ceil((distance - 3) / 2)
    return None


def _blend_primary_star_boundary(classes: dict[tuple[int, int], int]) -> None:
    """Keep the fixed stellar bands adjacent to the outer blended field."""
    fixed_cells = {
        cell for cell in classes
        if _primary_star_zone_class(*cell) is not None
    }
    pending = list(fixed_cells)
    while pending:
        cell = pending.pop()
        for neighbor in ((cell[0] - 1, cell[1]), (cell[0] + 1, cell[1]), (cell[0], cell[1] - 1), (cell[0], cell[1] + 1)):
            if neighbor not in classes or neighbor in fixed_cells:
                continue
            minimum_class = classes[cell] - 1
            if classes[neighbor] < minimum_class:
                classes[neighbor] = minimum_class
                pending.append(neighbor)


def resource_zone_classes(
    seed: int = 20260914, cell_class_overrides: Mapping[tuple[int, int], int] | None = None
) -> dict[tuple[int, int], int]:
    """Return effective zone classes after any administrator cell overrides."""
    classes = _smooth_zone_classes(seed)
    for cell in classes:
        radial_class = _primary_star_zone_class(*cell)
        if radial_class is not None:
            classes[cell] = radial_class
    _blend_primary_star_boundary(classes)
    for cell, zone_class in (cell_class_overrides or {}).items():
        if cell not in classes or not 1 <= zone_class <= 10:
            raise ValueError("Resource cell overrides must target a known cell with class 1 through 10")
        classes[cell] = zone_class
    return classes


def _regions_by_class(classes: dict[tuple[int, int], int]) -> dict[int, list[ZoneRegion]]:
    """Coalesce matching cell runs into rectangles for efficient existing zone lookup."""
    regions: dict[int, list[ZoneRegion]] = {zone_class: [] for zone_class in range(1, 11)}
    for cell_z in range(ZONE_GRID_MINIMUM_CELL, ZONE_GRID_MAXIMUM_CELL):
        start_x = ZONE_GRID_MINIMUM_CELL
        while start_x < ZONE_GRID_MAXIMUM_CELL:
            zone_class = classes[start_x, cell_z]
            end_x = start_x + 1
            while end_x < ZONE_GRID_MAXIMUM_CELL and classes[end_x, cell_z] == zone_class:
                end_x += 1
            regions[zone_class].append(ZoneRegion(
                min_x=start_x * ZONE_CELL_SIZE_METERS,
                max_x=end_x * ZONE_CELL_SIZE_METERS,
                min_z=cell_z * ZONE_CELL_SIZE_METERS,
                max_z=(cell_z + 1) * ZONE_CELL_SIZE_METERS,
            ))
            start_x = end_x
    return regions


def resource_zones(
    catalog: MineralCatalog, system_radius: float, origin_x: float, origin_z: float,
    seed: int = 20260914, cell_class_overrides: Mapping[tuple[int, int], int] | None = None,
) -> list[ResourceZone]:
    if not math.isfinite(system_radius) or system_radius <= 0:
        raise ValueError("System radius must be finite and positive")
    if not all(math.isfinite(value) for value in (origin_x, origin_z)):
        raise ValueError("Zone origin must be finite")
    regions = _regions_by_class(resource_zone_classes(seed, cell_class_overrides))
    return [
        ResourceZone(
            zone_id=f"kepler-class-{zone.zone_class}", zone_class=zone.zone_class,
            display_color=zone.display_color, regions=regions[zone.zone_class],
        )
        for zone in sorted(catalog.zone_classes, key=lambda zone: zone.zone_class)
    ]


def zone_for_position(
    zones: list[ResourceZone], position_x: float, position_z: float
) -> ResourceZone:
    for zone in zones:
        for region in zone.regions:
            inside_x = region.min_x <= position_x < region.max_x or position_x == region.max_x == 5_000_000_000
            inside_z = region.min_z <= position_z < region.max_z or position_z == region.max_z == 5_000_000_000
            if inside_x and inside_z:
                return zone
    raise ValueError("Position is outside configured resource zones")


def generate_assay(
    catalog: MineralCatalog,
    zone_class: int,
    spawn_seed: int,
    versions: dict[str, int],
) -> list[dict[str, str | int | float]]:
    """Select distinct components and conserve exactly 100,000 thousandths of a percent."""
    zone = catalog.zone(zone_class)
    weights = catalog.weights(zone_class)
    if set(versions) != set(weights) or any(version < 1 for version in versions.values()):
        raise ValueError("Every catalog mineral requires a valid pinned definition version")
    generator = random.Random(spawn_seed)
    component_count = generator.choices(range(1, 7), weights=zone.component_weights, k=1)[0]
    selected = []
    for _ in range(component_count):
        mineral_id = generator.choices(list(weights), weights=list(weights.values()), k=1)[0]
        selected.append(mineral_id)
        del weights[mineral_id]
    if component_count == 1:
        portions = [100_000]
    else:
        dominant = generator.randint(55_000, 85_000)
        secondary_weights = [generator.uniform(1, 10) for _ in selected[1:]]
        secondary_total = sum(secondary_weights)
        portions = [dominant] + [
            int((100_000 - dominant) * weight / secondary_total)
            for weight in secondary_weights
        ]
        portions[-1] += 100_000 - sum(portions)
    return [
        {"definition_id": mineral_id, "definition_version": versions[mineral_id],
         "percentage": portion / 1000}
        for mineral_id, portion in zip(selected, portions, strict=True)
    ]