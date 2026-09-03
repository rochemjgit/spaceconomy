# Persistence Plan: PostgreSQL and Redis

## Purpose

Establish the durable and realtime data foundation for Spaceconomy. PostgreSQL and Redis both run as Docker Compose containers. PostgreSQL is the authoritative record for player, world, inventory, fitting, and economy state. Redis accelerates sessions, idempotency lookups, cached snapshots, presence, rate limits, and realtime event fan-out.

This plan implements the complete Phase 1 data schema now, while only exposing gameplay APIs whose supporting rules already exist or are necessary to bootstrap an authenticated player.

## Current Baseline

- `compose.yaml` already defines PostgreSQL, Redis, and the FastAPI API container.
- `server/spaceconomy/config.py` provides database and Redis connection URLs, but neither is wired into application lifecycle code.
- `server/spaceconomy/api.py` exposes only the health endpoint.
- `server/spaceconomy/fitting.py` provides deterministic in-memory fitting rules and tests. It must remain the rules engine, with persistence added around it rather than inside it.
- SQLAlchemy, asyncpg, Alembic, Redis, Argon2, and JWT dependencies are already declared in `server/pyproject.toml`.

## Authority Rules

### PostgreSQL: Durable Authority

PostgreSQL stores all state needed to reconstruct the world after an API or Redis restart:

- Accounts, password hashes, refresh-token records, pilots, and active ships.
- Authored system content: system, celestial bodies, stations, belts, points of interest, and navigation destinations.
- Versioned hull, module, and module-effect catalog definitions.
- Ship ownership, durable docking state, last durable location checkpoint, fitting slots, inventory containers, and item instances.
- Immutable item/currency ledger entries and durable idempotent command results.

Every authoritative player-state mutation uses one PostgreSQL transaction. The transaction includes the state change, any ledger entry, and the command result. A failed validation writes no gameplay state or ledger mutation.

### Redis: Disposable Realtime Accelerator

Redis is not an authority for economy or player state. Loss of Redis must degrade to PostgreSQL-backed operation without duplicating a command or losing durable data.

Redis stores:

- Authenticated session metadata with a bounded TTL.
- Cached idempotent command responses after their PostgreSQL transaction commits.
- Cached ship fitting and inventory snapshots that can be rebuilt from PostgreSQL.
- Connection/presence records, current simulation transforms, rate-limit counters, and WebSocket subscriptions.
- Pub/sub events for ship, pilot, station, and future sector channels.

Redis keys are environment namespaced. Initial conventions:

| Key | TTL | Purpose |
| --- | --- | --- |
| `spaceconomy:{env}:session:{pilot_id}` | 5 minutes, refreshed while connected | Active ship, docking state, connection metadata |
| `spaceconomy:{env}:idempotency:{pilot_id}:{command}:{key}` | 24 hours | Cached durable command outcome |
| `spaceconomy:{env}:fitting:{ship_id}` | 30 seconds | Derived fitting snapshot |
| `spaceconomy:{env}:inventory:{container_id}` | 30 seconds | Container snapshot |
| `spaceconomy:{env}:presence:{pilot_id}` | 30 seconds, refreshed while connected | Transient nearby-player state |

Publish events only after the relevant PostgreSQL transaction commits. Events include a versioned type, entity ID, mutation/version marker, and enough data for the client to update or invalidate its view.

## Container Topology

PostgreSQL and Redis must run only as Docker Compose services:

- The API container connects to `postgres:5432` and `redis:6379` through the Compose network.
- PostgreSQL retains its named `postgres_data` volume.
- Redis is disposable cache and realtime infrastructure; no gameplay design relies on Redis persistence.
- Host port mappings exist for local developer tools and tests, but production service-to-service traffic remains internal to Compose.
- The API does not start before PostgreSQL and Redis health checks pass.
- Migrations and seed work run as explicit one-shot Compose commands or a dedicated migration service, never through `Base.metadata.create_all()` on API startup.

## Data Model

Organize SQLAlchemy models by ownership under `server/spaceconomy/models/`.

### Identity

- `Account`: UUID, normalized unique email/handle, Argon2 password hash, status, created/updated timestamps.
- `RefreshSession`: hashed refresh token, account, expiry, revocation timestamp, user-agent/device metadata.
- `Pilot`: account owner, display name, active ship, home station, creation timestamp.

### World

- `SolarSystem`: system identity, display metadata, coordinate convention/version.
- `CelestialBody`: type, parent, authored transform/orbital presentation metadata, visual/LOD metadata.
- `Station`: celestial-body association, docking transform, services, respawn capability.
- `PointOfInterest` and `NavigationDestination`: destination kind, coordinates, discovery/eligibility metadata.

### Catalog

- `HullDefinition`: stable definition ID, version, slot counts, base statistics, active status.
- `ModuleDefinition`: stable definition ID, version, family, fitting location, CPU/powergrid/durability values, active status.
- `ModuleEffect`: ordered definition effect rows containing statistic, operation, and value.

Definitions are seeded database content. Ship and item instances retain both definition ID and definition version so later balancing never silently rewrites historical state.

### Ships, Inventory, and Audit

- `Ship`: owner pilot, hull definition/version, name, active/destroyed state, current docked station, timestamps.
- `ShipLocation`: durable coordinate, heading, velocity, navigation destination, and checkpoint timestamp. Future tick state remains transient in Redis until checkpointed.
- `InventoryContainer`: owner, container type, station or ship association, capacity/volume metadata.
- `InventoryItem`: item UUID, owning pilot, definition/version, stack quantity, durability, current container.
- `FittedModule`: ship, slot location/index, inventory item, definition/version, durability.
- `ItemLedgerEntry`: immutable movement, consumption, creation, destruction, or currency event with source/destination and causal command ID.
- `CommandResult`: pilot, command type, idempotency key, accepted/rejected result, stable error code or serialized response, recorded timestamp.

Use UUID primary keys, UTC timestamps, foreign keys, positive quantity/durability checks, and unique constraints for catalog version rows, each ship slot, active pilot ship, and `(pilot_id, command_type, idempotency_key)`.

## Implementation Sequence

### 1. Database and Redis Lifecycle

Create:

- `server/spaceconomy/db.py`: async SQLAlchemy engine, `async_sessionmaker`, declarative base, and FastAPI session dependency.
- `server/spaceconomy/redis.py`: Redis client lifecycle, key helpers, cache operations, and pub/sub adapter.

Extend `Settings` with connection-pool sizing, Redis TTL configuration, access/refresh token lifetimes, and environment-safe secret validation. Add a FastAPI lifespan that creates and closes both clients cleanly.

### 2. Alembic and Initial Schema

Add `server/alembic.ini`, `server/alembic/env.py`, migration configuration, and a first revision that creates the full Phase 1 schema. Alembic imports model metadata and uses a synchronous-compatible PostgreSQL URL for migrations.

The API never creates schema implicitly. Local and CI workflows use:

```powershell
docker compose up -d postgres redis
docker compose run --rm api alembic upgrade head
```

### 3. Deterministic Seed Data

Create `server/spaceconomy/seed.py` as an idempotent upsert command. It seeds:

- The primary star, three rocky planets, three orbital stations, inner belt, two gas giants, outer belt, points of interest, and navigation destinations from the Phase 1 system blueprint.
- Existing starter hull/module data from `fitting.py`, including definition versions and effects.

Run seeding independently after migrations:

```powershell
docker compose run --rm api python -m spaceconomy.seed
```

Running the seed command twice must not create duplicate content.

### 4. Repositories and Application Services

Create repositories for accounts, world/catalog reads, pilots, ships, inventory, fitting, ledger entries, and command results. Repositories perform persistence queries only.

Create application services that own:

- Transaction boundaries and row locking.
- Pilot ownership and docking authorization.
- PostgreSQL and Redis idempotency lookup/recording.
- Cache invalidation and post-commit event publication.
- Mapping between ORM records and domain dataclasses.

Use `SELECT ... FOR UPDATE` for fitting and inventory mutations. A unique database constraint remains the final protection against duplicate commands or two modules occupying a slot.

### 5. Fitting Persistence

Keep `FittingService` synchronous, deterministic, and free from database or Redis calls. Add a hydration boundary that accepts persisted docked state, hull/module definitions, station items, and fitted items.

The fit/unfit command flow is:

1. Authenticate the pilot from the access JWT.
2. Check Redis idempotency cache, then durable `CommandResult` in PostgreSQL.
3. Lock the owned ship, item, and target slot state.
4. Hydrate and run `FittingService` validation.
5. Atomically update fitted/inventory locations, append one ledger entry, and store the accepted or rejected command result.
6. Commit PostgreSQL.
7. Invalidate fitting and inventory caches, store the cached result, and publish a fitting-changed event.

Idempotent retries return the original durable outcome, including an original validation error, without another ledger entry or state mutation.

### 6. Identity and Player Bootstrap

Add routers for registration, login, token refresh, logout, and an authenticated player bootstrap response.

Registration creates, in one transaction:

- Account and pilot.
- Starter ship docked at a starter station.
- Station storage and ship-cargo containers.
- Starter module item instances.

Store Argon2 password hashes and only hashed refresh-token values. Access JWTs are short-lived; refresh tokens rotate and can be revoked.

### 7. Player-State APIs and Realtime Boundary

Add typed Pydantic contracts and authenticated endpoints for:

- Player bootstrap state.
- Ship fitting snapshot, fit, and unfit.
- Docking state.
- Station storage and ship-cargo snapshots.

Add WebSocket JWT authentication using the versioned MessagePack envelope in `client/src/network/protocol.ts`. Bridge Redis pub/sub events only to authorized connected sockets. Store connection and presence state in Redis and remove it during disconnect.

Define durable location checkpoint storage now, but defer authoritative flight simulation, client prediction/reconciliation, mining, combat, market, and manufacturing rules until their respective phases.

### 8. Docker and Operational Hardening

Update Compose and server configuration to provide:

- Explicit API, migration, and seed execution paths.
- Environment variables through `.env` and an `.env.example` without secrets.
- PostgreSQL and Redis detailed readiness checks in addition to API liveness.
- Named PostgreSQL data volume and documented backup/restore workflow.
- Redis outage behavior that reports degraded readiness but preserves API safety through PostgreSQL fallback.

Celery is deliberately deferred until Phase 5.

## Verification

1. Start PostgreSQL and Redis using Docker Compose; apply migrations and run the seed command twice without duplicate rows.
2. Run `pytest tests/test_fitting.py`, `ruff check .`, and `mypy` inside `server`; existing fitting behavior and error codes must remain unchanged.
3. Add database integration fixtures using isolated test transactions/schemas and flush the Redis namespace for each test.
4. Verify registration creates starter account, pilot, ship, containers, and items; verify login, refresh rotation, and logout/revocation.
5. Verify fitting moves exactly one owned station item to one ship slot, creates one immutable ledger entry and one command result, and leaves no state/ledger mutation after rejected validation.
6. Submit concurrent/repeated fitting commands, including after Redis cache eviction, and verify a single durable outcome and ledger event.
7. Verify cache misses/hits/invalidation and post-commit events. Stop Redis and confirm protected read/mutation APIs safely use PostgreSQL fallback.
8. Verify authenticated WebSocket clients receive fitting-change events and disconnect cleanup removes presence/subscriptions.
9. Manually verify that a pilot can register, reconnect after an API restart, recover the same station/ship/inventory state, fit a starter module, unfit it, and reconnect again with the same state.

## Deliberate Deferrals

- Celery/background processing until manufacturing and market work in Phase 5.
- Flight simulation, client prediction/reconciliation, mining, refining, combat, PvE instances, market matching, and active-skill rules.
- Full client HUD networking integration beyond bootstrap and fitting-state consumption.
- Multi-system topology, high availability, replication, and production-scale sharding.
