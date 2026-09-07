"""Deterministic material conversion rules for station refinery jobs."""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class RefineryOutput:
    """One quoted whole-volume material output."""

    definition_id: str
    definition_version: int
    quantity_cubic_meters: int


def crush_outputs(
    mineral_assay: Iterable[Mapping[str, object]],
    input_volume_cubic_meters: float,
    efficiency: float,
) -> tuple[RefineryOutput, ...]:
    """Convert a raw ore assay into floor-rounded intermediate mineral ore."""
    _validate_positive_volume(input_volume_cubic_meters)
    _validate_efficiency(efficiency)
    outputs = []
    for entry in mineral_assay:
        mineral_id = str(entry["definition_id"])
        version = int(entry.get("definition_version", entry.get("version", 1)))
        percentage = float(entry["percentage"])
        if not math.isfinite(percentage) or percentage < 0:
            raise ValueError("mineral assay percentage must be finite and non-negative")
        quantity = math.floor(input_volume_cubic_meters * percentage / 100 * efficiency)
        if quantity:
            outputs.append(RefineryOutput(f"material.ore.{mineral_id}", version, quantity))
    return tuple(outputs)


def purify_output(
    intermediate_definition_id: str,
    definition_version: int,
    quantity_cubic_meters: int,
    efficiency: float,
) -> RefineryOutput | None:
    """Convert an intermediate mineral-ore inventory stack into pure material."""
    if not intermediate_definition_id.startswith("material.ore."):
        raise ValueError("purification requires an intermediate mineral-ore item")
    if definition_version < 1:
        raise ValueError("material definition version must be positive")
    if quantity_cubic_meters < 1:
        raise ValueError("material quantity must be positive")
    _validate_efficiency(efficiency)
    quantity = math.floor(quantity_cubic_meters * efficiency)
    if not quantity:
        return None
    mineral_id = intermediate_definition_id.removeprefix("material.ore.")
    return RefineryOutput(f"material.pure.{mineral_id}", definition_version, quantity)


def _validate_positive_volume(volume_cubic_meters: float) -> None:
    if not math.isfinite(volume_cubic_meters) or volume_cubic_meters <= 0:
        raise ValueError("input volume must be finite and positive")


def _validate_efficiency(efficiency: float) -> None:
    if not math.isfinite(efficiency) or not 0 <= efficiency <= 1:
        raise ValueError("refinery efficiency must be finite and between zero and one")
