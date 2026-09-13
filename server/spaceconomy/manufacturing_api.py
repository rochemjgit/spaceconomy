"""Docked manufacturing commands for the initial crafted module."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_session
from .inventory import _ensure_containers, _require_docked_pilot
from .models import (InventoryItem, InventoryLedgerEntry, ManufacturingJob,
                     ManufacturingJobInput, ManufacturingRecipe, ManufacturingRecipeInput,
                     ManufacturingService, ModuleDefinition)

router = APIRouter(prefix="/api/v1/manufacturing", tags=["manufacturing"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]


class QueueManufacturingJobRequest(BaseModel):
    recipe_id: str = Field(min_length=1, max_length=128)
    recipe_version: int = Field(ge=1)
    idempotency_key: str = Field(min_length=1, max_length=128)


class ManufacturingJobResponse(BaseModel):
    id: UUID
    state: str
    queue_sequence: int
    completes_at: datetime | None


async def _service(session: AsyncSession) -> ManufacturingService:
    service = await session.scalar(select(ManufacturingService).where(
        ManufacturingService.service_key == "starter_manufacturing",
        ManufacturingService.active.is_(True),
    ).with_for_update())
    if service is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "station manufacturing is unavailable")
    return service


@router.post("/jobs", response_model=ManufacturingJobResponse)
async def queue_job(
    payload: QueueManufacturingJobRequest,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> ManufacturingJobResponse:
    """Reserve exact station material stacks and start the selected recipe."""
    async with session.begin():
        pilot_id, _ = await _require_docked_pilot(session, authorization)
        _, station = await _ensure_containers(session, pilot_id)
        service = await _service(session)
        existing = await session.scalar(select(ManufacturingJob).where(
            ManufacturingJob.pilot_id == pilot_id,
            ManufacturingJob.idempotency_key == payload.idempotency_key,
        ).with_for_update())
        if existing is not None:
            return ManufacturingJobResponse(id=existing.id, state=existing.state,
                                            queue_sequence=existing.queue_sequence,
                                            completes_at=existing.completes_at)
        recipe = await session.scalar(select(ManufacturingRecipe).where(
            ManufacturingRecipe.recipe_id == payload.recipe_id,
            ManufacturingRecipe.version == payload.recipe_version,
            ManufacturingRecipe.service_key == service.service_key,
            ManufacturingRecipe.active.is_(True),
        ).with_for_update())
        if recipe is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "manufacturing recipe was not found")
        output = await session.get(ModuleDefinition, recipe.output_module_definition_id, with_for_update=True)
        if output is None or not output.active or recipe.output_quantity != 1:
            raise HTTPException(status.HTTP_409_CONFLICT, "manufacturing recipe output is unavailable")
        active = int(await session.scalar(select(func.count()).select_from(ManufacturingJob).where(
            ManufacturingJob.manufacturing_service_id == service.id,
            ManufacturingJob.state.in_(("queued", "processing")),
        )) or 0)
        if active >= service.queue_capacity:
            raise HTTPException(status.HTTP_409_CONFLICT, "manufacturing queue is full")
        requirements = list(await session.scalars(select(ManufacturingRecipeInput).where(
            ManufacturingRecipeInput.manufacturing_recipe_id == recipe.id
        ).order_by(ManufacturingRecipeInput.input_index)))
        now = datetime.now(UTC)
        job = ManufacturingJob(
            pilot_id=pilot_id, manufacturing_service_id=service.id, manufacturing_recipe_id=recipe.id,
            destination_container_id=station.id, state="processing", queue_sequence=active,
            quoted_duration_seconds=service.seconds_per_run, quoted_fee_credits=service.fee_credits,
            expected_output=json.dumps({"module_definition_id": str(output.id), "definition_id": output.definition_id,
                "definition_version": output.version, "quantity": 1, "durability": output.durability_maximum,
                "volume_per_unit": output.volume_cubic_meters}), idempotency_key=payload.idempotency_key,
            started_at=now, completes_at=now + timedelta(seconds=service.seconds_per_run),
        )
        session.add(job)
        await session.flush()
        for requirement in requirements:
            source = await session.scalar(select(InventoryItem).where(
                InventoryItem.pilot_id == pilot_id, InventoryItem.container_id == station.id,
                InventoryItem.module_definition_id.is_(None),
                InventoryItem.definition_id == requirement.definition_id,
                InventoryItem.definition_version == requirement.definition_version,
                InventoryItem.quantity >= requirement.quantity,
            ).order_by(InventoryItem.created_at).with_for_update())
            if source is None:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                                    f"insufficient {requirement.definition_id} for recipe")
            if source.quantity == requirement.quantity:
                source.container_id = None
                reserved = source
            else:
                source.quantity -= requirement.quantity
                reserved = InventoryItem(pilot_id=pilot_id, container_id=None, module_definition_id=None,
                    definition_id=source.definition_id, definition_version=source.definition_version,
                    quantity=requirement.quantity, durability=source.durability, volume_per_unit=source.volume_per_unit)
                session.add(reserved)
                await session.flush()
            session.add(ManufacturingJobInput(manufacturing_job_id=job.id, inventory_item_id=reserved.id,
                input_index=requirement.input_index, definition_id=reserved.definition_id,
                definition_version=reserved.definition_version, quantity=reserved.quantity))
            session.add(InventoryLedgerEntry(pilot_id=pilot_id, manufacturing_job_id=job.id,
                inventory_item_id=None, event_kind="manufacturing_reserved", definition_id=reserved.definition_id,
                definition_version=reserved.definition_version, quantity=reserved.quantity,
                source_container_id=station.id, destination_container_id=None,
                command_id=f"manufacturing:{payload.idempotency_key}"))
        return ManufacturingJobResponse(id=job.id, state=job.state, queue_sequence=job.queue_sequence,
                                        completes_at=job.completes_at)