import pytest

from spaceconomy.fitting import (
    MINING_LASER,
    FittingError,
    FittingService,
    ModuleDefinition,
    ModuleItem,
    SlotLocation,
    STARTER_MINER,
    create_demo_fitting_service,
)


def test_fit_moves_a_docked_station_item_and_updates_derived_statistics() -> None:
    service = create_demo_fitting_service()

    snapshot = service.fit(
        "item.mining_laser.1",
        SlotLocation.UNIVERSAL_HARDPOINT,
        0,
        "fit-mining-laser",
    )

    assert snapshot.fitted_modules[0].item_id == "item.mining_laser.1"
    assert snapshot.statistics["mining_yield"] == 1.2
    assert snapshot.statistics["cpu_used"] == 18.0
    assert snapshot.statistics["powergrid_used"] == 14.0


def test_fit_rejects_resource_overage_without_mutating_the_ship() -> None:
    service = FittingService("ship.1", "pilot.1", STARTER_MINER, "station.kepler")
    oversized_module = ModuleDefinition(
        definition_id="module.oversized.1",
        version=1,
        display_name="Oversized Test Module",
        family="utility",
        fit_location=SlotLocation.UNIVERSAL_HARDPOINT,
        cpu_demand=101.0,
        powergrid_demand=1.0,
        durability_maximum=100.0,
    )
    service.add_station_item(ModuleItem("item.oversized.1", oversized_module, "station.kepler", "pilot.1", 100.0))

    with pytest.raises(FittingError, match="cpu_exceeded"):
        service.fit("item.oversized.1", SlotLocation.UNIVERSAL_HARDPOINT, 0, "fit-oversized")

    assert service.snapshot().fitted_modules == ()
    with pytest.raises(FittingError, match="cpu_exceeded"):
        service.fit("item.oversized.1", SlotLocation.UNIVERSAL_HARDPOINT, 0, "fit-oversized")
    assert service.snapshot().fitted_modules == ()


def test_repeated_idempotency_key_returns_original_fit_result() -> None:
    service = create_demo_fitting_service()

    accepted = service.fit("item.mining_laser.1", SlotLocation.UNIVERSAL_HARDPOINT, 0, "fit-once")
    replay = service.fit("item.mining_laser.1", SlotLocation.UNIVERSAL_HARDPOINT, 0, "fit-once")

    assert replay == accepted