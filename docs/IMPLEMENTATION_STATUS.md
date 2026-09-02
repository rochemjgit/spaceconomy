# Phase 1 implementation status

## Completed foundation

- Vite/TypeScript browser-client scaffold.
- Babylon.js stylized system-shell scene and isometric camera baseline.
- Versioned MessagePack envelope helpers and a client contract test.
- FastAPI service scaffold with a versioned health endpoint and test.
- PostgreSQL, Redis, and API development Compose configuration.
- Python and TypeScript quality-tool configuration baselines.

## Phase III fitting foundation

- Versioned hull and module definitions for the starter miner, combat frigate, and generalist hauler.
- Universal-hardpoint and core-system location validation without hull-role or module-family restrictions.
- Deterministic derived-stat aggregation with flat, percentage, multiplier, cap, and floor effect operations.
- Docked station fit/unfit operations with ownership, locality, durability, slot, CPU, powergrid, and accepted-command idempotency validation.
- Focused fitting-service tests covering accepted fits, resource rejection without mutation, and accepted-command retries.

## Phase III readiness

Phase III cannot yet extend an authoritative Phase II implementation: persistence, identity, docking authority, inventory/ledger, mining, scans, wrecks, and realtime events remain unimplemented scaffolding. The fitting domain currently uses deterministic development data and must be connected to those services before it is exposed as a player API.

## Next implementation slice

1. Implement Phase I and II persistence, identity, docking, station-local inventory, ledger, and mining/scan authority.
2. Persist the Phase III fitting definitions, ships, fit records, and derived-stat snapshots; replace development data with authenticated pilot state.
3. Add typed fit/unfit/load/unload and snapshot contracts, then integrate the fitting UI with server-confirmed state.
4. Implement capacitor/module lifecycle, charges, consumables, progression, and loss resolution in the Phase III order.

Celery is intentionally excluded until Phase 5.
