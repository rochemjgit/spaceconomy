"""Durable PostgreSQL models for the initial Spaceconomy persistence slice."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class TimestampedModel:
    """Provide database-assigned UTC timestamps for durable rows."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Account(TimestampedModel, Base):
    """A login identity that can own one or more pilots."""

    __tablename__ = "accounts"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    first_name: Mapped[str] = mapped_column(String(128), nullable=False)
    last_name: Mapped[str] = mapped_column(String(128), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)


class AccountActivation(TimestampedModel, Base):
    """A single-use, hashed email confirmation token for a pending account."""

    __tablename__ = "account_activations"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(ForeignKey("accounts.id"), index=True, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RefreshSession(TimestampedModel, Base):
    """A revocable, hashed refresh token record."""

    __tablename__ = "refresh_sessions"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(ForeignKey("accounts.id"), index=True, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user_agent: Mapped[str | None] = mapped_column(String(512))


class Pilot(TimestampedModel, Base):
    """A player character owned by an account."""

    __tablename__ = "pilots"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    account_id: Mapped[UUID] = mapped_column(ForeignKey("accounts.id"), index=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    home_station_id: Mapped[UUID | None] = mapped_column(Uuid)


class PilotWallet(TimestampedModel, Base):
    """A pilot's spendable market credits."""

    __tablename__ = "pilot_wallets"
    __table_args__ = (CheckConstraint("balance_credits >= 0", name="wallet_balance_valid"),)

    pilot_id: Mapped[UUID] = mapped_column(ForeignKey("pilots.id"), primary_key=True)
    balance_credits: Mapped[int] = mapped_column(BigInteger, nullable=False, default=10_000)


class WalletTransaction(TimestampedModel, Base):
    """An immutable credit movement in a pilot's wallet ledger."""

    __tablename__ = "wallet_transactions"
    __table_args__ = (
        CheckConstraint("amount_credits <> 0", name="wallet_transaction_amount_valid"),
        CheckConstraint(
            "transaction_kind IN "
            "('initial_grant', 'market_purchase', 'market_sale', 'refinery_fee', "
            "'market_listing_fee', 'market_purchase_commission', 'market_buy_order_fee', "
            "'market_buy_order_fill', 'market_buy_order_sale')",
            name="wallet_transaction_kind_valid",
        ),
        UniqueConstraint("pilot_id", "command_id", name="uq_wallet_transaction_pilot_command"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    pilot_id: Mapped[UUID] = mapped_column(ForeignKey("pilots.id"), index=True, nullable=False)
    counterparty_pilot_id: Mapped[UUID | None] = mapped_column(ForeignKey("pilots.id"))
    amount_credits: Mapped[int] = mapped_column(BigInteger, nullable=False)
    transaction_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    command_id: Mapped[str] = mapped_column(String(128), nullable=False)
    settlement_id: Mapped[UUID] = mapped_column(Uuid, index=True, nullable=False)
    market_listing_id: Mapped[UUID | None] = mapped_column(Uuid, index=True)


class HullDefinition(TimestampedModel, Base):
    """An append-only, versioned ship hull definition."""

    __tablename__ = "hull_definitions"
    __table_args__ = (UniqueConstraint("definition_id", "version"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    definition_id: Mapped[str] = mapped_column(String(128), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    universal_hardpoint_count: Mapped[int] = mapped_column(Integer, nullable=False)
    core_system_slot_count: Mapped[int] = mapped_column(Integer, nullable=False)
    base_statistics: Mapped[str] = mapped_column(Text, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ModuleDefinition(TimestampedModel, Base):
    """An append-only, versioned module definition."""

    __tablename__ = "module_definitions"
    __table_args__ = (UniqueConstraint("definition_id", "version"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    definition_id: Mapped[str] = mapped_column(String(128), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    family: Mapped[str] = mapped_column(String(64), nullable=False)
    fit_location: Mapped[str] = mapped_column(String(32), nullable=False)
    cpu_demand: Mapped[float] = mapped_column(Float, nullable=False)
    powergrid_demand: Mapped[float] = mapped_column(Float, nullable=False)
    durability_maximum: Mapped[float] = mapped_column(Float, nullable=False)
    mass_kg: Mapped[float] = mapped_column(Float, nullable=False)
    volume_cubic_meters: Mapped[float] = mapped_column(Float, nullable=False)
    effective_range_meters: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    starter_grant: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ModuleEffect(TimestampedModel, Base):
    """One ordered statistic modifier belonging to a module definition version."""

    __tablename__ = "module_effects"
    __table_args__ = (UniqueConstraint("module_definition_id", "effect_index"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    module_definition_id: Mapped[UUID] = mapped_column(
        ForeignKey("module_definitions.id"), nullable=False
    )
    effect_index: Mapped[int] = mapped_column(Integer, nullable=False)
    statistic: Mapped[str] = mapped_column(String(128), nullable=False)
    operation: Mapped[str] = mapped_column(String(16), nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)


class Ship(TimestampedModel, Base):
    """A pilot-owned ship with a pinned, versioned hull definition."""

    __tablename__ = "ships"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'destroyed')", name="ship_status_valid"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    pilot_id: Mapped[UUID] = mapped_column(ForeignKey("pilots.id"), index=True, nullable=False)
    hull_definition_id: Mapped[UUID] = mapped_column(
        ForeignKey("hull_definitions.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    docked_station_id: Mapped[UUID | None] = mapped_column(Uuid, index=True)


class ShipLocation(TimestampedModel, Base):
    """The most recent durable simulation checkpoint for a ship."""

    __tablename__ = "ship_locations"

    ship_id: Mapped[UUID] = mapped_column(ForeignKey("ships.id"), primary_key=True)
    position_x: Mapped[float] = mapped_column(Float, nullable=False)
    position_y: Mapped[float] = mapped_column(Float, nullable=False)
    position_z: Mapped[float] = mapped_column(Float, nullable=False)
    heading_x: Mapped[float] = mapped_column(Float, nullable=False)
    heading_y: Mapped[float] = mapped_column(Float, nullable=False)
    heading_z: Mapped[float] = mapped_column(Float, nullable=False)
    velocity_x: Mapped[float] = mapped_column(Float, nullable=False)
    velocity_y: Mapped[float] = mapped_column(Float, nullable=False)
    velocity_z: Mapped[float] = mapped_column(Float, nullable=False)
    navigation_destination_id: Mapped[UUID | None] = mapped_column(Uuid)
    checkpointed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ShipState(TimestampedModel, Base):
    """The durable runtime state restored when a pilot launches."""

    __tablename__ = "ship_states"

    pilot_id: Mapped[UUID] = mapped_column(ForeignKey("pilots.id"), primary_key=True)
    position_x: Mapped[float] = mapped_column(Float, nullable=False, default=3_000_000_000)
    position_y: Mapped[float] = mapped_column(Float, nullable=False, default=480)
    position_z: Mapped[float] = mapped_column(Float, nullable=False, default=-50_000)
    docked_station_name: Mapped[str | None] = mapped_column(String(128))
    power_megajoules: Mapped[float] = mapped_column(Float, nullable=False, default=100)
    shields: Mapped[float] = mapped_column(Float, nullable=False, default=100)
    hull: Mapped[float] = mapped_column(Float, nullable=False, default=100)
    fuel_liters: Mapped[float] = mapped_column(Float, nullable=False, default=80)
    cargo_cubic_meters: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    sensor_last_scan_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NpcProfile(TimestampedModel, Base):
    """Durable personality and capabilities for a non-player pilot."""

    __tablename__ = "npc_profiles"
    __table_args__ = (
        CheckConstraint(
            "lifecycle_state IN ('active', 'paused', 'retired')",
            name="npc_profile_lifecycle_state_valid",
        ),
    )

    pilot_id: Mapped[UUID] = mapped_column(ForeignKey("pilots.id"), primary_key=True)
    archetype_key: Mapped[str] = mapped_column(String(64), nullable=False)
    backstory: Mapped[str] = mapped_column(Text, nullable=False)
    motivations: Mapped[str] = mapped_column(Text, nullable=False)
    capabilities: Mapped[str] = mapped_column(Text, nullable=False)
    lifecycle_state: Mapped[str] = mapped_column(String(16), nullable=False, default="active")


class NpcRuntime(TimestampedModel, Base):
    """Mutable server-owned runtime state for a non-player pilot."""

    __tablename__ = "npc_runtimes"

    pilot_id: Mapped[UUID] = mapped_column(ForeignKey("pilots.id"), primary_key=True)
    behavior_state: Mapped[str] = mapped_column(Text, nullable=False, default="idle")
    decision_source: Mapped[str] = mapped_column(
        String(32), nullable=False, default="deterministic"
    )
    target_x: Mapped[float | None] = mapped_column(Float)
    target_y: Mapped[float | None] = mapped_column(Float)
    target_z: Mapped[float | None] = mapped_column(Float)
    decision_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    warp_phase: Mapped[str | None] = mapped_column(String(32))
    warp_capacity: Mapped[float] = mapped_column(Float, nullable=False, default=100)
    warp_phase_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    warp_destination_x: Mapped[float | None] = mapped_column(Float)
    warp_destination_y: Mapped[float | None] = mapped_column(Float)
    warp_destination_z: Mapped[float | None] = mapped_column(Float)
    mining_target_asteroid_id: Mapped[UUID | None] = mapped_column(Uuid)
    mining_lock_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    mining_locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    mining_next_cycle_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SolarSystem(TimestampedModel, Base):
    """A navigable system with an authoritative spatial boundary."""

    __tablename__ = "solar_systems"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    system_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    radius_meters: Mapped[float] = mapped_column(Float, nullable=False)


class AsteroidField(TimestampedModel, Base):
    """A finite discoverable asteroid-field site retained after its depletion."""

    __tablename__ = "asteroid_fields"
    __table_args__ = (UniqueConstraint("system_id", "field_key"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    system_id: Mapped[UUID] = mapped_column(
        ForeignKey("solar_systems.id"), index=True, nullable=False
    )
    field_key: Mapped[str] = mapped_column(String(64), nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    position_x: Mapped[float] = mapped_column(Float, nullable=False)
    position_y: Mapped[float] = mapped_column(Float, nullable=False)
    position_z: Mapped[float] = mapped_column(Float, nullable=False)
    discovery_signature: Mapped[float] = mapped_column(Float, nullable=False)
    spawn_profile: Mapped[str] = mapped_column(Text, nullable=False)
    next_spawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class MineralDefinition(TimestampedModel, Base):
    """A versioned raw mineral definition used by asteroid assays."""

    __tablename__ = "mineral_definitions"
    __table_args__ = (UniqueConstraint("definition_id", "version"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    definition_id: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    classification: Mapped[str] = mapped_column(String(16), nullable=False)
    rarity_tier: Mapped[str] = mapped_column(String(16), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Asteroid(TimestampedModel, Base):
    """A finite, server-owned asteroid spawned within a discoverable field."""

    __tablename__ = "asteroids"
    __table_args__ = (
        CheckConstraint("initial_volume_cubic_meters > 0", name="asteroid_initial_volume_valid"),
        CheckConstraint("remaining_volume_cubic_meters >= 0", name="asteroid_remaining_volume_valid"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    field_id: Mapped[UUID] = mapped_column(ForeignKey("asteroid_fields.id"), index=True, nullable=False)
    spawn_seed: Mapped[int] = mapped_column(Integer, nullable=False)
    position_x: Mapped[float] = mapped_column(Float, nullable=False)
    position_y: Mapped[float] = mapped_column(Float, nullable=False)
    position_z: Mapped[float] = mapped_column(Float, nullable=False)
    radius_meters: Mapped[float] = mapped_column(Float, nullable=False)
    composition: Mapped[str] = mapped_column(String(64), nullable=False)
    mineral_assay: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    initial_volume_cubic_meters: Mapped[float] = mapped_column(Float, nullable=False)
    remaining_volume_cubic_meters: Mapped[float] = mapped_column(Float, nullable=False)
    depleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PilotDiscovery(TimestampedModel, Base):
    """A pilot-private sensor result for an extensible discoverable world object."""

    __tablename__ = "pilot_discoveries"
    __table_args__ = (UniqueConstraint("pilot_id", "discoverable_kind", "discoverable_id"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    pilot_id: Mapped[UUID] = mapped_column(ForeignKey("pilots.id"), index=True, nullable=False)
    discoverable_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    discoverable_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    scan_quality: Mapped[float] = mapped_column(Float, nullable=False)


class MinedOreLot(TimestampedModel, Base):
    """A pilot cargo lot retaining the source asteroid and raw composition."""

    __tablename__ = "mined_ore_lots"
    __table_args__ = (
        CheckConstraint("volume_cubic_meters > 0", name="mined_ore_lot_volume_valid"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    pilot_id: Mapped[UUID] = mapped_column(ForeignKey("pilots.id"), index=True, nullable=False)
    container_id: Mapped[UUID] = mapped_column(
        ForeignKey("inventory_containers.id"), index=True, nullable=False
    )
    asteroid_id: Mapped[UUID] = mapped_column(ForeignKey("asteroids.id"), index=True, nullable=False)
    composition: Mapped[str] = mapped_column(String(64), nullable=False)
    mineral_assay: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    volume_cubic_meters: Mapped[float] = mapped_column(Float, nullable=False)


class RefineryService(TimestampedModel, Base):
    """A station-owned refinery configuration with durable balance settings."""

    __tablename__ = "refinery_services"
    __table_args__ = (
        UniqueConstraint("station_id", "service_key", name="uq_refinery_service_station_key"),
        CheckConstraint("first_pass_seconds_per_cubic_meter > 0", name="refinery_first_pass_rate_valid"),
        CheckConstraint("second_pass_seconds_per_cubic_meter > 0", name="refinery_second_pass_rate_valid"),
        CheckConstraint("first_pass_efficiency >= 0 AND first_pass_efficiency <= 1", name="refinery_first_pass_efficiency_valid"),
        CheckConstraint("second_pass_efficiency >= 0 AND second_pass_efficiency <= 1", name="refinery_second_pass_efficiency_valid"),
        CheckConstraint("fee_credits >= 0", name="refinery_fee_valid"),
        CheckConstraint("active_job_capacity > 0", name="refinery_active_capacity_valid"),
        CheckConstraint("queue_capacity > 0", name="refinery_queue_capacity_valid"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    station_id: Mapped[UUID] = mapped_column(Uuid, index=True, nullable=False)
    service_key: Mapped[str] = mapped_column(String(64), nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    first_pass_seconds_per_cubic_meter: Mapped[float] = mapped_column(Float, nullable=False)
    second_pass_seconds_per_cubic_meter: Mapped[float] = mapped_column(Float, nullable=False)
    first_pass_efficiency: Mapped[float] = mapped_column(Float, nullable=False)
    second_pass_efficiency: Mapped[float] = mapped_column(Float, nullable=False)
    fee_credits: Mapped[int] = mapped_column(BigInteger, nullable=False)
    active_job_capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    queue_capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class RefineryJob(TimestampedModel, Base):
    """One reserved refinery input and its immutable processing quote."""

    __tablename__ = "refinery_jobs"
    __table_args__ = (
        CheckConstraint("stage IN ('crush', 'purify')", name="refinery_job_stage_valid"),
        CheckConstraint("state IN ('queued', 'processing', 'completed', 'cancelled', 'failed')", name="refinery_job_state_valid"),
        CheckConstraint("queue_sequence >= 0", name="refinery_job_sequence_valid"),
        CheckConstraint("quoted_duration_seconds > 0", name="refinery_job_duration_valid"),
        CheckConstraint("quoted_efficiency >= 0 AND quoted_efficiency <= 1", name="refinery_job_efficiency_valid"),
        CheckConstraint("quoted_fee_credits >= 0", name="refinery_job_fee_valid"),
        CheckConstraint(
            "(state IN ('queued', 'processing') AND "
            "((source_ore_lot_id IS NOT NULL "
            "AND source_inventory_item_id IS NULL AND stage = 'crush') "
            "OR (source_ore_lot_id IS NULL "
            "AND source_inventory_item_id IS NOT NULL AND stage = 'purify'))) "
            "OR state IN ('completed', 'cancelled', 'failed')",
            name="refinery_job_source_valid",
        ),
        UniqueConstraint("pilot_id", "idempotency_key", name="uq_refinery_job_pilot_idempotency"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    pilot_id: Mapped[UUID] = mapped_column(ForeignKey("pilots.id"), index=True, nullable=False)
    refinery_service_id: Mapped[UUID] = mapped_column(
        ForeignKey("refinery_services.id"), index=True, nullable=False
    )
    source_ore_lot_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("mined_ore_lots.id"), unique=True
    )
    source_inventory_item_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("inventory_items.id"), unique=True
    )
    stage: Mapped[str] = mapped_column(String(16), nullable=False)
    state: Mapped[str] = mapped_column(String(16), index=True, nullable=False)
    queue_sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    quoted_duration_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    quoted_efficiency: Mapped[float] = mapped_column(Float, nullable=False)
    quoted_fee_credits: Mapped[int] = mapped_column(BigInteger, nullable=False)
    expected_outputs: Mapped[str] = mapped_column(Text, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failure_reason: Mapped[str | None] = mapped_column(String(256))


class ManufacturingService(TimestampedModel, Base):
    """A station-owned manufacturing facility with bounded parallel work."""

    __tablename__ = "manufacturing_services"
    __table_args__ = (
        UniqueConstraint("station_id", "service_key", name="uq_manufacturing_service_station_key"),
        CheckConstraint("seconds_per_run > 0", name="manufacturing_service_duration_valid"),
        CheckConstraint("fee_credits >= 0", name="manufacturing_service_fee_valid"),
        CheckConstraint("active_job_capacity > 0", name="manufacturing_service_active_capacity_valid"),
        CheckConstraint("queue_capacity > 0", name="manufacturing_service_queue_capacity_valid"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    station_id: Mapped[UUID] = mapped_column(Uuid, index=True, nullable=False)
    service_key: Mapped[str] = mapped_column(String(64), nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    seconds_per_run: Mapped[float] = mapped_column(Float, nullable=False)
    fee_credits: Mapped[int] = mapped_column(BigInteger, nullable=False)
    active_job_capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    queue_capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ManufacturingRecipe(TimestampedModel, Base):
    """An immutable, versioned recipe that produces one module definition."""

    __tablename__ = "manufacturing_recipes"
    __table_args__ = (
        UniqueConstraint("recipe_id", "version", name="uq_manufacturing_recipe_version"),
        CheckConstraint("output_quantity > 0", name="manufacturing_recipe_output_quantity_valid"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    recipe_id: Mapped[str] = mapped_column(String(128), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    service_key: Mapped[str] = mapped_column(String(64), nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    output_module_definition_id: Mapped[UUID] = mapped_column(
        ForeignKey("module_definitions.id"), nullable=False
    )
    output_quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ManufacturingRecipeInput(TimestampedModel, Base):
    """One material requirement pinned to a manufacturing recipe version."""

    __tablename__ = "manufacturing_recipe_inputs"
    __table_args__ = (
        UniqueConstraint("manufacturing_recipe_id", "input_index"),
        CheckConstraint("input_index >= 0", name="manufacturing_recipe_input_index_valid"),
        CheckConstraint("quantity > 0", name="manufacturing_recipe_input_quantity_valid"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    manufacturing_recipe_id: Mapped[UUID] = mapped_column(
        ForeignKey("manufacturing_recipes.id"), index=True, nullable=False
    )
    input_index: Mapped[int] = mapped_column(Integer, nullable=False)
    definition_id: Mapped[str] = mapped_column(String(128), nullable=False)
    definition_version: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)


class ManufacturingJob(TimestampedModel, Base):
    """A durable manufacturing order with frozen terms and output."""

    __tablename__ = "manufacturing_jobs"
    __table_args__ = (
        CheckConstraint(
            "state IN ('queued', 'processing', 'completed', 'cancelled', 'failed')",
            name="manufacturing_job_state_valid",
        ),
        CheckConstraint("queue_sequence >= 0", name="manufacturing_job_sequence_valid"),
        CheckConstraint("quoted_duration_seconds > 0", name="manufacturing_job_duration_valid"),
        CheckConstraint("quoted_fee_credits >= 0", name="manufacturing_job_fee_valid"),
        UniqueConstraint("pilot_id", "idempotency_key", name="uq_manufacturing_job_pilot_idempotency"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    pilot_id: Mapped[UUID] = mapped_column(ForeignKey("pilots.id"), index=True, nullable=False)
    manufacturing_service_id: Mapped[UUID] = mapped_column(
        ForeignKey("manufacturing_services.id"), index=True, nullable=False
    )
    manufacturing_recipe_id: Mapped[UUID] = mapped_column(
        ForeignKey("manufacturing_recipes.id"), nullable=False
    )
    destination_container_id: Mapped[UUID] = mapped_column(
        ForeignKey("inventory_containers.id"), nullable=False
    )
    state: Mapped[str] = mapped_column(String(16), index=True, nullable=False)
    queue_sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    quoted_duration_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    quoted_fee_credits: Mapped[int] = mapped_column(BigInteger, nullable=False)
    expected_output: Mapped[str] = mapped_column(Text, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failure_reason: Mapped[str | None] = mapped_column(String(256))


class ManufacturingJobInput(TimestampedModel, Base):
    """An exact inventory reservation held by one manufacturing job."""

    __tablename__ = "manufacturing_job_inputs"
    __table_args__ = (
        UniqueConstraint("manufacturing_job_id", "input_index"),
        UniqueConstraint("inventory_item_id", name="uq_manufacturing_job_input_item"),
        CheckConstraint("input_index >= 0", name="manufacturing_job_input_index_valid"),
        CheckConstraint("quantity > 0", name="manufacturing_job_input_quantity_valid"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    manufacturing_job_id: Mapped[UUID] = mapped_column(
        ForeignKey("manufacturing_jobs.id"), index=True, nullable=False
    )
    inventory_item_id: Mapped[UUID | None] = mapped_column(ForeignKey("inventory_items.id"))
    input_index: Mapped[int] = mapped_column(Integer, nullable=False)
    definition_id: Mapped[str] = mapped_column(String(128), nullable=False)
    definition_version: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)


class InventoryLedgerEntry(TimestampedModel, Base):
    """An append-only audit record for authoritative inventory mutations."""

    __tablename__ = "inventory_ledger_entries"
    __table_args__ = (
        CheckConstraint(
            "event_kind IN ('manufacturing_reserved', 'manufacturing_completed', "
            "'manufacturing_cancelled')",
            name="inventory_ledger_event_kind_valid",
        ),
        CheckConstraint("quantity > 0", name="inventory_ledger_quantity_valid"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    pilot_id: Mapped[UUID] = mapped_column(ForeignKey("pilots.id"), index=True, nullable=False)
    manufacturing_job_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("manufacturing_jobs.id"), index=True
    )
    inventory_item_id: Mapped[UUID | None] = mapped_column(ForeignKey("inventory_items.id"))
    event_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    definition_id: Mapped[str] = mapped_column(String(128), nullable=False)
    definition_version: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    source_container_id: Mapped[UUID | None] = mapped_column(ForeignKey("inventory_containers.id"))
    destination_container_id: Mapped[UUID | None] = mapped_column(ForeignKey("inventory_containers.id"))
    command_id: Mapped[str] = mapped_column(String(128), nullable=False)


class JettisonedItem(TimestampedModel, Base):
    """A public, expiring in-space snapshot of an inventory item stack."""

    __tablename__ = "jettisoned_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="jettisoned_item_quantity_valid"),
        CheckConstraint("volume_per_unit >= 0", name="jettisoned_item_volume_valid"),
        CheckConstraint(
            "module_definition_id IS NULL OR quantity = 1",
            name="jettisoned_module_singleton",
        ),
        CheckConstraint(
            "(ore_asteroid_id IS NULL AND ore_composition IS NULL AND ore_mineral_assay IS NULL) "
            "OR (ore_asteroid_id IS NOT NULL AND ore_composition IS NOT NULL "
            "AND ore_mineral_assay IS NOT NULL AND module_definition_id IS NULL "
            "AND quantity = 1 AND volume_per_unit > 0)",
            name="jettisoned_ore_metadata_valid",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    definition_id: Mapped[str] = mapped_column(String(128), nullable=False)
    definition_version: Mapped[int] = mapped_column(Integer, nullable=False)
    module_definition_id: Mapped[UUID | None] = mapped_column(ForeignKey("module_definitions.id"))
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    durability: Mapped[float] = mapped_column(Float, nullable=False)
    volume_per_unit: Mapped[float] = mapped_column(Float, nullable=False)
    ore_asteroid_id: Mapped[UUID | None] = mapped_column(ForeignKey("asteroids.id"))
    ore_composition: Mapped[str | None] = mapped_column(String(64))
    ore_mineral_assay: Mapped[str | None] = mapped_column(Text)
    position_x: Mapped[float] = mapped_column(Float, nullable=False)
    position_y: Mapped[float] = mapped_column(Float, nullable=False)
    position_z: Mapped[float] = mapped_column(Float, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )


class InventoryContainer(TimestampedModel, Base):
    """A pilot-owned physical storage location on a ship or at a station."""

    __tablename__ = "inventory_containers"
    __table_args__ = (
        CheckConstraint(
            "(ship_id IS NULL) <> (station_id IS NULL)", name="container_has_one_location"
        ),
        CheckConstraint("capacity_cubic_meters >= 0", name="container_capacity_valid"),
        UniqueConstraint("pilot_id", "station_id", name="uq_pilot_station_container"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    pilot_id: Mapped[UUID] = mapped_column(ForeignKey("pilots.id"), index=True, nullable=False)
    ship_id: Mapped[UUID | None] = mapped_column(ForeignKey("ships.id"), unique=True)
    station_id: Mapped[UUID | None] = mapped_column(Uuid, index=True)
    container_type: Mapped[str] = mapped_column(String(32), nullable=False)
    capacity_cubic_meters: Mapped[float] = mapped_column(Float, nullable=False)


class InventoryItem(TimestampedModel, Base):
    """A durable item stack, with module definitions pinned when applicable."""

    __tablename__ = "inventory_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="inventory_item_quantity_valid"),
        CheckConstraint("durability >= 0", name="inventory_item_durability_valid"),
        CheckConstraint("volume_per_unit >= 0", name="inventory_item_volume_valid"),
        CheckConstraint(
            "module_definition_id IS NULL OR quantity = 1", name="inventory_module_singleton"
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    pilot_id: Mapped[UUID] = mapped_column(ForeignKey("pilots.id"), index=True, nullable=False)
    container_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("inventory_containers.id"), index=True
    )
    module_definition_id: Mapped[UUID | None] = mapped_column(ForeignKey("module_definitions.id"))
    definition_id: Mapped[str] = mapped_column(String(128), nullable=False)
    definition_version: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    durability: Mapped[float] = mapped_column(Float, nullable=False)
    volume_per_unit: Mapped[float] = mapped_column(Float, nullable=False)


class MarketListing(TimestampedModel, Base):
    """A station-held inventory stack offered for sale by its owning pilot."""

    __tablename__ = "market_listings"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="market_listing_quantity_valid"),
        CheckConstraint("unit_price_credits > 0", name="market_listing_price_valid"),
        CheckConstraint(
            "state IN ('active', 'sold', 'cancelled', 'expired')", name="market_listing_state_valid"
        ),
        CheckConstraint("duration_days IN (1, 7, 30)", name="market_listing_duration_valid"),
        UniqueConstraint("seller_pilot_id", "command_id", name="uq_market_listing_seller_command"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    station_id: Mapped[UUID] = mapped_column(Uuid, index=True, nullable=False)
    seller_pilot_id: Mapped[UUID] = mapped_column(
        ForeignKey("pilots.id"), index=True, nullable=False
    )
    inventory_item_id: Mapped[UUID] = mapped_column(
        ForeignKey("inventory_items.id"), unique=True, nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price_credits: Mapped[int] = mapped_column(BigInteger, nullable=False)
    duration_days: Mapped[int] = mapped_column(Integer, nullable=False)
    listing_fee_credits: Mapped[int] = mapped_column(BigInteger, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    command_id: Mapped[str] = mapped_column(String(128), nullable=False)


class MarketBuyOrder(TimestampedModel, Base):
    """Credits-reserved demand for a material or module at a station."""

    __tablename__ = "market_buy_orders"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="market_buy_order_quantity_valid"),
        CheckConstraint("unit_price_credits > 0", name="market_buy_order_price_valid"),
        CheckConstraint("duration_days IN (1, 7, 30)", name="market_buy_order_duration_valid"),
        CheckConstraint("state IN ('active', 'filled', 'cancelled', 'expired')", name="market_buy_order_state_valid"),
        UniqueConstraint("buyer_pilot_id", "command_id", name="uq_market_buy_order_buyer_command"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    station_id: Mapped[UUID] = mapped_column(Uuid, index=True, nullable=False)
    buyer_pilot_id: Mapped[UUID] = mapped_column(ForeignKey("pilots.id"), index=True, nullable=False)
    definition_id: Mapped[str] = mapped_column(String(128), nullable=False)
    definition_version: Mapped[int] = mapped_column(Integer, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price_credits: Mapped[int] = mapped_column(BigInteger, nullable=False)
    duration_days: Mapped[int] = mapped_column(Integer, nullable=False)
    listing_fee_credits: Mapped[int] = mapped_column(BigInteger, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    command_id: Mapped[str] = mapped_column(String(128), nullable=False)


class FittedModule(TimestampedModel, Base):
    """The one-to-one placement of a module inventory item into a ship slot."""

    __tablename__ = "fitted_modules"
    __table_args__ = (
        UniqueConstraint("ship_id", "slot_location", "slot_index"),
        CheckConstraint("slot_index >= 0", name="fitted_module_slot_index_valid"),
        CheckConstraint("durability >= 0", name="fitted_module_durability_valid"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    ship_id: Mapped[UUID] = mapped_column(ForeignKey("ships.id"), index=True, nullable=False)
    inventory_item_id: Mapped[UUID] = mapped_column(
        ForeignKey("inventory_items.id"), unique=True, nullable=False
    )
    module_definition_id: Mapped[UUID] = mapped_column(
        ForeignKey("module_definitions.id"), nullable=False
    )
    slot_location: Mapped[str] = mapped_column(String(32), nullable=False)
    slot_index: Mapped[int] = mapped_column(Integer, nullable=False)
    durability: Mapped[float] = mapped_column(Float, nullable=False)