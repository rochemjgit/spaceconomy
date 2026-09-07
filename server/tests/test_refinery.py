import pytest

from spaceconomy.refinery import RefineryOutput, crush_outputs, purify_output


def test_crushing_applies_efficiency_per_assay_component_and_rounds_down() -> None:
    outputs = crush_outputs(
        (
            {"definition_id": "iron", "definition_version": 1, "percentage": 50},
            {"definition_id": "copper", "definition_version": 1, "percentage": 50},
        ),
        input_volume_cubic_meters=10,
        efficiency=0.5,
    )

    assert outputs == (
        RefineryOutput("material.ore.iron", 1, 2),
        RefineryOutput("material.ore.copper", 1, 2),
    )


def test_purifying_intermediate_material_applies_a_second_floor_rounded_pass() -> None:
    output = purify_output("material.ore.iron", 1, quantity_cubic_meters=2, efficiency=0.5)

    assert output == RefineryOutput("material.pure.iron", 1, 1)


def test_purifying_rejects_non_intermediate_inventory_items() -> None:
    with pytest.raises(ValueError, match="intermediate"):
        purify_output("material.pure.iron", 1, quantity_cubic_meters=2, efficiency=0.5)
