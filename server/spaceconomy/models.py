"""Durable PostgreSQL models for the initial Spaceconomy persistence slice."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
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
    position_x: Mapped[float] = mapped_column(Float, nullable=False, default=123_078)
    position_y: Mapped[float] = mapped_column(Float, nullable=False, default=480)
    position_z: Mapped[float] = mapped_column(Float, nullable=False, default=-2_691)
    docked_station_name: Mapped[str | None] = mapped_column(String(128))
    power_megajoules: Mapped[float] = mapped_column(Float, nullable=False, default=100)
    shields: Mapped[float] = mapped_column(Float, nullable=False, default=100)
    hull: Mapped[float] = mapped_column(Float, nullable=False, default=100)
    fuel_liters: Mapped[float] = mapped_column(Float, nullable=False, default=80)
    cargo_cubic_meters: Mapped[float] = mapped_column(Float, nullable=False, default=0)


class InventoryContainer(TimestampedModel, Base):
    """A pilot-owned physical storage location on a ship or at a station."""

    __tablename__ = "inventory_containers"
    __table_args__ = (
        CheckConstraint(
            "(ship_id IS NULL) <> (station_id IS NULL)", name="container_has_one_location"
        ),
        CheckConstraint("capacity_cubic_meters >= 0", name="container_capacity_valid"),
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