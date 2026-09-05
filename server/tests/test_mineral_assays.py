import json

from spaceconomy.seed import FIELD_PROFILES
from spaceconomy.world import mineral_assay_for_profile


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