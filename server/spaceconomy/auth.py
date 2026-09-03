"""Account authentication backed by PostgreSQL refresh sessions and Redis presence."""

from __future__ import annotations

import hashlib
import logging
import secrets
import smtplib
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from typing import Annotated
from uuid import UUID

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_session
from .models import Account, AccountActivation, Pilot, RefreshSession, ShipState
from .redis import delete_session, set_session

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
password_hasher = PasswordHasher()
SessionDependency = Annotated[AsyncSession, Depends(get_session)]
logger = logging.getLogger(__name__)


class CredentialsRequest(BaseModel):
    """Credentials accepted for player registration and sign-in."""

    email: str = Field(max_length=320)
    password: str = Field(min_length=8, max_length=256)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
            raise ValueError("email must be valid")
        return normalized


class AccountRegistrationRequest(CredentialsRequest):
    """Details required to create a pending account."""

    first_name: str = Field(min_length=1, max_length=128)
    last_name: str = Field(min_length=1, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=256)

    @field_validator("first_name", "last_name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return value.strip()


class AccountRegistrationResponse(BaseModel):
    """Acknowledges that an activation email was requested."""

    message: str


class RefreshRequest(BaseModel):
    """The opaque refresh token required to rotate an authenticated session."""

    refresh_token: str = Field(min_length=32, max_length=256)


class PilotSummary(BaseModel):
    """The selectable identity shown after account authentication."""

    id: UUID
    display_name: str


class PilotCreationRequest(BaseModel):
    """The initial player character name chosen after account sign-in."""

    display_name: str = Field(min_length=1, max_length=32)

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str) -> str:
        return value.strip()


class AuthResponse(BaseModel):
    """Account authentication result and the pilots available for selection."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    pilots: list[PilotSummary]


class PilotSelectionRequest(BaseModel):
    """The pilot selected from an authenticated account's roster."""

    pilot_id: UUID


class PilotSelectionResponse(BaseModel):
    """The selected pilot's game access token."""

    access_token: str
    token_type: str = "bearer"
    pilot_id: UUID
    display_name: str
    ship_state: "ShipStateResponse"


class ShipStateResponse(BaseModel):
    """A pilot's saved launch position and ship condition."""

    position_x: float
    position_y: float
    position_z: float
    docked_station_name: str | None
    power_megajoules: float
    shields: float
    hull: float
    fuel_liters: float
    cargo_cubic_meters: float


class ShipStateSaveRequest(ShipStateResponse):
    """The current local ship state persisted before logout."""


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _send_activation_email(email: str, activation_token: str) -> None:
    activation_url = f"{settings.public_api_url}/api/v1/auth/activate?token={activation_token}"
    if settings.smtp_host is None:
        logger.warning("Account activation URL for %s: %s", email, activation_url)
        return
    message = EmailMessage()
    message["Subject"] = "Activate your Spaceconomy account"
    message["From"] = settings.smtp_from_email
    message["To"] = email
    message.set_content(f"Activate your Spaceconomy account: {activation_url}")
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        if settings.smtp_username and settings.smtp_password:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(message)


def _access_token(account_id: UUID, pilot_id: UUID | None = None) -> str:
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.jwt_access_minutes)
    claims = {"sub": str(pilot_id or account_id), "account_id": str(account_id), "exp": expires_at}
    if pilot_id is not None:
        claims["pilot_id"] = str(pilot_id)
    return jwt.encode(
        claims,
        settings.jwt_secret,
        algorithm="HS256",
    )


async def _create_tokens(
    session: AsyncSession, account: Account, request: Request
) -> AuthResponse:
    refresh_token = secrets.token_urlsafe(48)
    session.add(
        RefreshSession(
            account_id=account.id,
            token_hash=_token_hash(refresh_token),
            expires_at=datetime.now(UTC) + timedelta(days=settings.jwt_refresh_days),
            user_agent=request.headers.get("user-agent"),
        )
    )
    return AuthResponse(
        access_token=_access_token(account.id),
        refresh_token=refresh_token,
        pilots=[
            PilotSummary(id=pilot.id, display_name=pilot.display_name)
            for pilot in await session.scalars(select(Pilot).where(Pilot.account_id == account.id))
        ],
    )


def _account_id_from_authorization(authorization: str | None) -> UUID:
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "authentication is required")
    try:
        claims = jwt.decode(authorization[7:], settings.jwt_secret, algorithms=["HS256"])
        return UUID(claims["account_id"])
    except (jwt.PyJWTError, KeyError, ValueError) as error:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "authentication is invalid") from error


def _pilot_id_from_authorization(authorization: str | None) -> UUID:
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "authentication is required")
    try:
        claims = jwt.decode(authorization[7:], settings.jwt_secret, algorithms=["HS256"])
        return UUID(claims["pilot_id"])
    except (jwt.PyJWTError, KeyError, ValueError) as error:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "pilot authentication is invalid") from error


def _ship_state_response(ship_state: ShipState) -> ShipStateResponse:
    return ShipStateResponse(
        position_x=ship_state.position_x,
        position_y=ship_state.position_y,
        position_z=ship_state.position_z,
        docked_station_name=ship_state.docked_station_name,
        power_megajoules=ship_state.power_megajoules,
        shields=ship_state.shields,
        hull=ship_state.hull,
        fuel_liters=ship_state.fuel_liters,
        cargo_cubic_meters=ship_state.cargo_cubic_meters,
    )


@router.post(
    "/register",
    response_model=AccountRegistrationResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def register(
    registration: AccountRegistrationRequest,
    session: SessionDependency,
) -> AccountRegistrationResponse:
    """Create a pending account and send its one-time confirmation link."""
    if registration.password != registration.confirm_password:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "passwords do not match")
    activation_token = secrets.token_urlsafe(48)
    async with session.begin():
        existing = await session.scalar(select(Account).where(Account.email == registration.email))
        if existing is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "email is already registered")
        account = Account(
            email=registration.email,
            first_name=registration.first_name,
            last_name=registration.last_name,
            password_hash=password_hasher.hash(registration.password),
            status="pending",
        )
        session.add(account)
        await session.flush()
        session.add(
            AccountActivation(
                account_id=account.id,
                token_hash=_token_hash(activation_token),
                expires_at=datetime.now(UTC) + timedelta(hours=settings.account_activation_hours),
            )
        )
    try:
        _send_activation_email(account.email, activation_token)
    except (OSError, smtplib.SMTPException) as error:
        logger.exception("Unable to send account activation email for %s", account.email)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "unable to send activation email"
        ) from error
    return AccountRegistrationResponse(message="Check your email to activate your account.")


@router.get("/activate")
async def activate_account(token: str, session: SessionDependency) -> dict[str, str]:
    """Consume an activation link and make its account available for sign-in."""
    async with session.begin():
        activation = await session.scalar(
            select(AccountActivation)
            .where(AccountActivation.token_hash == _token_hash(token))
            .with_for_update()
        )
        if (
            activation is None
            or activation.used_at is not None
            or activation.expires_at <= datetime.now(UTC)
        ):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "activation link is invalid")
        account = await session.get(Account, activation.account_id)
        if account is None or account.status != "pending":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "activation link is invalid")
        account.status = "active"
        activation.used_at = datetime.now(UTC)
    return {"message": "Account activated. You can now sign in."}


@router.post("/login", response_model=AuthResponse)
async def login(
    credentials: CredentialsRequest,
    request: Request,
    session: SessionDependency,
) -> AuthResponse:
    """Verify credentials and create a persistent refresh session."""
    async with session.begin():
        account = await session.scalar(select(Account).where(Account.email == credentials.email))
        if account is None or account.status != "active":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")
        try:
            password_hasher.verify(account.password_hash, credentials.password)
        except VerifyMismatchError as error:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials") from error
        return await _create_tokens(session, account, request)


@router.post("/refresh", response_model=AuthResponse)
async def refresh(
    payload: RefreshRequest,
    request: Request,
    session: SessionDependency,
) -> AuthResponse:
    """Rotate a refresh token and revoke the presented token atomically."""
    async with session.begin():
        refresh_session = await session.scalar(
            select(RefreshSession)
            .where(RefreshSession.token_hash == _token_hash(payload.refresh_token))
            .with_for_update()
        )
        if (
            refresh_session is None
            or refresh_session.revoked_at is not None
            or refresh_session.expires_at <= datetime.now(UTC)
        ):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "refresh token is invalid")
        account = await session.get(Account, refresh_session.account_id)
        if account is None or account.status != "active":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "refresh token is invalid")
        refresh_session.revoked_at = datetime.now(UTC)
        return await _create_tokens(session, account, request)


@router.post("/create-pilot", response_model=PilotSummary, status_code=status.HTTP_201_CREATED)
async def create_pilot(
    payload: PilotCreationRequest,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> PilotSummary:
    """Create the first pilot selected by an authenticated account."""
    account_id = _account_id_from_authorization(authorization)
    async with session.begin():
        existing_pilot = await session.scalar(select(Pilot.id).where(Pilot.account_id == account_id))
        if existing_pilot is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "a pilot already exists for this account")
        duplicate_name = await session.scalar(select(Pilot.id).where(Pilot.display_name == payload.display_name))
        if duplicate_name is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "pilot name is already in use")
        pilot = Pilot(account_id=account_id, display_name=payload.display_name)
        session.add(pilot)
        await session.flush()
        session.add(ShipState(pilot_id=pilot.id, docked_station_name="KEPLER STATION"))
        return PilotSummary(id=pilot.id, display_name=pilot.display_name)


@router.post("/select-pilot", response_model=PilotSelectionResponse)
async def select_pilot(
    payload: PilotSelectionRequest,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> PilotSelectionResponse:
    """Issue a game token only for a pilot owned by the authenticated account."""
    account_id = _account_id_from_authorization(authorization)
    pilot = await session.scalar(
        select(Pilot).where(Pilot.id == payload.pilot_id, Pilot.account_id == account_id)
    )
    if pilot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pilot was not found")
    ship_state = await session.get(ShipState, pilot.id)
    if ship_state is None:
        ship_state = ShipState(pilot_id=pilot.id)
        session.add(ship_state)
        await session.commit()
    await set_session(
        str(pilot.id), {"account_id": str(account_id), "display_name": pilot.display_name}
    )
    return PilotSelectionResponse(
        access_token=_access_token(account_id, pilot.id),
        pilot_id=pilot.id,
        display_name=pilot.display_name,
        ship_state=_ship_state_response(ship_state),
    )


@router.put("/ship-state", status_code=status.HTTP_204_NO_CONTENT)
async def save_ship_state(
    payload: ShipStateSaveRequest,
    session: SessionDependency,
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Durably checkpoint the active pilot's ship before it leaves the game."""
    pilot_id = _pilot_id_from_authorization(authorization)
    async with session.begin():
        ship_state = await session.get(ShipState, pilot_id, with_for_update=True)
        if ship_state is None:
            ship_state = ShipState(pilot_id=pilot_id)
            session.add(ship_state)
        ship_state.position_x = payload.position_x
        ship_state.position_y = payload.position_y
        ship_state.position_z = payload.position_z
        ship_state.docked_station_name = payload.docked_station_name
        ship_state.power_megajoules = payload.power_megajoules
        ship_state.shields = payload.shields
        ship_state.hull = payload.hull
        ship_state.fuel_liters = payload.fuel_liters
        ship_state.cargo_cubic_meters = payload.cargo_cubic_meters


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    payload: RefreshRequest,
    session: SessionDependency,
) -> None:
    """Persistently revoke a refresh session and remove transient Redis session metadata."""
    async with session.begin():
        refresh_session = await session.scalar(
            select(RefreshSession)
            .where(RefreshSession.token_hash == _token_hash(payload.refresh_token))
            .with_for_update()
        )
        if refresh_session is None or refresh_session.revoked_at is not None:
            return
        refresh_session.revoked_at = datetime.now(UTC)
        pilots = await session.scalars(
            select(Pilot.id).where(Pilot.account_id == refresh_session.account_id)
        )
        pilot_ids = list(pilots)
    for pilot_id in pilot_ids:
        await delete_session(str(pilot_id))