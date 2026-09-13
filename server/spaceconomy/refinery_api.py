"""Docked refinery queue APIs backed by durable station jobs."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_session
from .inventory import _ensure_containers, _require_docked_pilot
from .market import _wallet
from .models import InventoryItem, MinedOreLot, RefineryJob, RefineryService, WalletTransaction
from .refinery import RefineryOutput, crush_outputs, purify_output

router = APIRouter(prefix="/api/v1/refinery", tags=["refinery"])
SessionDependency = Annotated[AsyncSession, Depends(get_session)]


class RefineryOutputResponse(BaseModel):
    definition_id: str
    definition_version: int
    quantity_cubic_meters: int


class RefineryJobResponse(BaseModel):
    id: UUID
    stage: str
    state: str
    queue_sequence: int
    quoted_duration_seconds: float
    quoted_efficiency: float
    quoted_fee_credits: int
    expected_outputs: list[RefineryOutputResponse]
    started_at: datetime | None
    completes_at: datetime | None


class RefineryServiceResponse(BaseModel):
    id: UUID
    display_name: str
    fee_credits: int
    queue_capacity: int
    active_job_capacity: int
    first_pass_seconds_per_cubic_meter: float
    first_pass_efficiency: float
    second_pass_seconds_per_cubic_meter: float
    second_pass_efficiency: float


class RefinerySnapshotResponse(BaseModel):
    server_time: datetime
    service: RefineryServiceResponse
    jobs: list[RefineryJobResponse]


class QueueRefineryJobRequest(BaseModel):
    source_kind: Literal["raw_ore", "intermediate"]
    source_id: UUID
    idempotency_key: str = Field(min_length=1, max_length=128)


def _output_response(output: RefineryOutput) -> RefineryOutputResponse:
    return RefineryOutputResponse(
        definition_id=output.definition_id,
        definition_version=output.definition_version,
        quantity_cubic_meters=output.quantity_cubic_meters,
    )


def _job_response(job: RefineryJob) -> RefineryJobResponse:
    return RefineryJobResponse(
        id=job.id,
        stage=job.stage,
        state=job.state,
        queue_sequence=job.queue_sequence,
        quoted_duration_seconds=job.quoted_duration_seconds,
        quoted_efficiency=job.quoted_efficiency,
        quoted_fee_credits=job.quoted_fee_credits,
        expected_outputs=[RefineryOutputResponse(**output) for output in json.loads(job.expected_outputs)],
        started_at=job.started_at,
        completes_at=job.completes_at,
    )


def _service_response(service: RefineryService) -> RefineryServiceResponse:
    return RefineryServiceResponse.model_validate(service, from_attributes=True)


async def _starter_service(session: AsyncSession) -> RefineryService:
    service = await session.scalar(
        select(RefineryService)
        .where(RefineryService.service_key == "starter_refinery", RefineryService.active.is_(True))
        .with_for_update()
    )
    if service is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "station refinery is unavailable")
    return service


async def _snapshot(
    session: AsyncSession, pilot_id: UUID, service: RefineryService
) -> RefinerySnapshotResponse:
    jobs = list(
        await session.scalars(
            select(RefineryJob)
            .where(RefineryJob.pilot_id == pilot_id, RefineryJob.refinery_service_id == service.id)
            .order_by(RefineryJob.queue_sequence)
        )
    )
    return RefinerySnapshotResponse(
        server_time=datetime.now(UTC), service=_service_response(service), jobs=[_job_response(job) for job in jobs]
    )


@router.get("/docked", response_model=RefinerySnapshotResponse)
async def docked_refinery(
    session: SessionDependency, authorization: Annotated[str | None, Header()] = None
) -> RefinerySnapshotResponse:
    """Return the caller's durable Kepler refinery queue while docked."""
    async with session.begin():
        pilot_id, _ = await _require_docked_pilot(session, authorization)
        service = await _starter_service(session)
        return await _snapshot(session, pilot_id, service)


@router.post("/jobs", response_model=RefinerySnapshotResponse)
async def queue_job(
    payload: QueueRefineryJobRequest,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> RefinerySnapshotResponse:
    """Reserve one complete station input and queue it for refinery processing."""
    async with session.begin():
        pilot_id, _ = await _require_docked_pilot(session, authorization)
        _, station_container = await _ensure_containers(session, pilot_id)
        service = await _starter_service(session)
        existing = await session.scalar(
            select(RefineryJob)
            .where(RefineryJob.pilot_id == pilot_id, RefineryJob.idempotency_key == payload.idempotency_key)
            .with_for_update()
        )
        if existing is not None:
            return await _snapshot(session, pilot_id, service)
        wallet = await _wallet(session, pilot_id)
        if wallet.balance_credits < service.fee_credits:
            raise HTTPException(status.HTTP_409_CONFLICT, "insufficient wallet credits")
        active_jobs = list(
            await session.scalars(
                select(RefineryJob)
                .where(
                    RefineryJob.pilot_id == pilot_id,
                    RefineryJob.refinery_service_id == service.id,
                    RefineryJob.state.in_(("queued", "processing")),
                )
                .with_for_update()
            )
        )
        if len(active_jobs) >= service.queue_capacity:
            raise HTTPException(status.HTTP_409_CONFLICT, "refinery queue is full")
        stage: str
        outputs: tuple[RefineryOutput, ...]
        duration: float
        efficiency: float
        source_ore_lot_id: UUID | None = None
        source_inventory_item_id: UUID | None = None
        if payload.source_kind == "raw_ore":
            lot = await session.scalar(
                select(MinedOreLot)
                .where(MinedOreLot.id == payload.source_id, MinedOreLot.container_id == station_container.id)
                .with_for_update()
            )
            if lot is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "station raw ore lot was not found")
            stage = "crush"
            efficiency = service.first_pass_efficiency
            duration = lot.volume_cubic_meters * service.first_pass_seconds_per_cubic_meter
            outputs = crush_outputs(json.loads(lot.mineral_assay), lot.volume_cubic_meters, efficiency)
            source_ore_lot_id = lot.id
        else:
            item = await session.scalar(
                select(InventoryItem)
                .where(InventoryItem.id == payload.source_id, InventoryItem.container_id == station_container.id)
                .with_for_update()
            )
            if item is None or not item.definition_id.startswith("material.ore."):
                raise HTTPException(status.HTTP_404_NOT_FOUND, "station intermediate material was not found")
            if item.volume_per_unit != 1:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "intermediate material must use cubic-meter units")
            stage = "purify"
            efficiency = service.second_pass_efficiency
            duration = item.quantity * service.second_pass_seconds_per_cubic_meter
            output = purify_output(item.definition_id, item.definition_version, item.quantity, efficiency)
            outputs = () if output is None else (output,)
            source_inventory_item_id = item.id
        processing_count = sum(job.state == "processing" for job in active_jobs)
        now = datetime.now(UTC)
        state = "processing" if processing_count < service.active_job_capacity else "queued"
        next_sequence = int(
            await session.scalar(
                select(func.coalesce(func.max(RefineryJob.queue_sequence), -1)).where(
                    RefineryJob.pilot_id == pilot_id, RefineryJob.refinery_service_id == service.id
                )
            )
        ) + 1
        session.add(
            RefineryJob(
                pilot_id=pilot_id,
                refinery_service_id=service.id,
                source_ore_lot_id=source_ore_lot_id,
                source_inventory_item_id=source_inventory_item_id,
                stage=stage,
                state=state,
                queue_sequence=next_sequence,
                quoted_duration_seconds=duration,
                quoted_efficiency=efficiency,
                quoted_fee_credits=service.fee_credits,
                expected_outputs=json.dumps([output.__dict__ for output in outputs]),
                idempotency_key=payload.idempotency_key,
                started_at=now if state == "processing" else None,
                completes_at=now + timedelta(seconds=duration) if state == "processing" else None,
            )
        )
        wallet.balance_credits -= service.fee_credits
        if service.fee_credits:
            session.add(
                WalletTransaction(
                    pilot_id=pilot_id,
                    counterparty_pilot_id=None,
                    amount_credits=-service.fee_credits,
                    transaction_kind="refinery_fee",
                    command_id=f"refinery:{payload.idempotency_key}",
                    settlement_id=uuid4(),
                )
            )
        await session.flush()
        return await _snapshot(session, pilot_id, service)