import json
import math
import random

from spaceconomy.seed import FIELD_PROFILES
from spaceconomy.world import (
    SYSTEM_POINTS_OF_INTEREST,
    SYSTEM_MAP_CELL_SIZE_METERS,
    KEPLER_STATION_POSITION,
    LOCAL_BELT_MAXIMUM_DISTANCE_METERS,
    LOCAL_BELT_MINIMUM_DISTANCE_METERS,
    mineral_assay_for_profile,
    poi_field_cells,
    random_local_belt_position,
    random_poi_field_position,
)


EXOTIC_MINERALS = {"aetherium", "gravimetric_crystal", "nullite"}


def assay_entries(profile: str, seed: int) -> list[dict[str, object]]:
    return json.loads(mineral_assay_for_profile(FIELD_PROFILES[profile], seed))


def test_mineral_assays_are_deterministic_and_normalized() -> None:
    assay = mineral_assay_for_profile(FIELD_PROFILES["ferrous"], 42)
    entries = json.loads(assay)

    assert assay == mineral_assay_for_profile(FIELD_PROFILES["ferrous"], 42)
    assert len(entries) >= 2
    assert 99.9 <= sum(float(entry["percentage"]) for entry in entries) <= 100.1


def test_common_fields_never_yield_exotic_minerals() -> None:
    mineral_ids = {
        str(entry["definition_id"])
        for profile in ("ferrous", "silicate")
        for seed in range(100)
        for entry in assay_entries(profile, seed)
    }

    assert mineral_ids.isdisjoint(EXOTIC_MINERALS)


def test_rare_field_eventually_yields_an_exotic_anomaly() -> None:
    mineral_ids = {
        str(entry["definition_id"])
        for seed in range(1000)
        for entry in assay_entries("rare", seed)
    }

    assert mineral_ids & EXOTIC_MINERALS


def test_asteroid_fields_spawn_in_cells_bordering_fixed_points_of_interest() -> None:
    poi_cells = {
        cell
        for _, position in SYSTEM_POINTS_OF_INTEREST
        for cell in poi_field_cells(position)
    }
    spawned_cells = {
        (
            int(position[0] // SYSTEM_MAP_CELL_SIZE_METERS),
            int(position[2] // SYSTEM_MAP_CELL_SIZE_METERS),
        )
        for seed in range(1_000)
        for position in [random_poi_field_position(random.Random(seed))]
    }

    assert spawned_cells <= poi_cells
    assert spawned_cells == poi_cells


def test_station_local_belts_spawn_in_a_condensed_shell_outside_station_visibility() -> None:
    for seed in range(100):
        distance = math.dist(
            random_local_belt_position(random.Random(seed)), KEPLER_STATION_POSITION
        )
        assert LOCAL_BELT_MINIMUM_DISTANCE_METERS <= distance <= LOCAL_BELT_MAXIMUM_DISTANCE_METERS