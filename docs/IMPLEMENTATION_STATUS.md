# Implementation status

## Completed foundation

- Vite/TypeScript browser-client scaffold.
- Babylon.js stylized system-shell scene and isometric camera baseline.
- Versioned MessagePack envelope helpers and a client contract test.
- FastAPI service with versioned health, auth, ship state, realtime, and mining endpoints.
- PostgreSQL, Redis, and API development Compose configuration.
- PostgreSQL migrations and idempotent seed data for identity, ships, inventory, Kepler, asteroid fields, and asteroids.
- Account activation, multiple pilots, saved ship state, loading-room flow, and docked/in-space handoff scaffolding.
- Redis-backed realtime pilot presence, movement, targeting, and mining beam events.
- Private sensor discovery with capacitor cost/cooldown, server-owned asteroid replenishment, and discovery-scoped local asteroid snapshots.
- Transactional asteroid extraction that locks ship/asteroid state, durably updates ore depletion plus ship cargo, and stores composition-preserving raw ore lots separately by source asteroid.
- Versioned mineral catalog plus deterministic multi-mineral asteroid assays. Assays are immutable snapshots copied into raw ore lots; common fields stay scientific while rare anomaly variants can contain constrained fictional endgame minerals. Refining is not implemented.
- Public in-space jettison and pickup for item stacks, individual modules, and assay-preserving raw ore: cargo renders for nearby pilots, expires after five configurable minutes, and can be collected by any in-range ship with sufficient capacity.

## Inventory management (2026-09-05)

- Container-owned raw ore supports station storage, partial transfers, splitting, compatible merging, jettison and recovery without losing its source or assay.
- Cargo capacity includes both items and ore; saved cargo totals are derived from inventory rather than trusted client checkpoints.
- Single transfers are exact and atomic. Bulk loading moves what fits, skips oversized entries and reports leftovers; station storage remains unlimited.
- Starter modules are granted only on first storage creation. Modules remain individual objects, including after public pickup; migration 12 safely separates legacy module stacks.
- Station operations require docking. Ship splitting/merging remains available in space without exposing station contents.
- Both inventory views provide combined search/sort, selection details, quantity dialogs, explicit transfers and drag/drop, public-jettison confirmation, refresh, pending/error feedback and synchronized cargo HUD values.
- Dock/undock transitions wait for a successful server checkpoint; stale inventory reads cannot overwrite a newer view or mutation.
- Validation: 47 server tests passed with PostgreSQL scratch schemas, including five concurrent-command cases; 42 client tests, client lint and production build passed. Live docked bulk transfers and empty-storage refresh were verified and the moved items returned to their original station.
- See [inventory review](INVENTORY_REVIEW.md) for migration and remaining limitations.

## Phase III fitting foundation

- Versioned hull and module definitions for the starter miner, combat frigate, and generalist hauler.
- Universal-hardpoint and core-system location validation without hull-role or module-family restrictions.
- Deterministic derived-stat aggregation with flat, percentage, multiplier, cap, and floor effect operations.
- Docked station fit/unfit operations with ownership, locality, durability, slot, CPU, powergrid, and accepted-command idempotency validation.
- Focused fitting-service tests covering accepted fits, resource rejection without mutation, and accepted-command retries.

## Mining authority boundary

Asteroids, discoveries, cargo, scans, and extraction outcomes are durable PostgreSQL state. Babylon renders only server snapshot records and applies ore/cargo changes only after extraction succeeds. Current ship movement remains client-predicted, so prototype local-interest and extraction range checks accept a bounded client position. Replacing this with server-owned transforms and area-of-interest routing is the next authority milestone.

## In-game navigation map (2026-09-13)

- World dimensions are 100 by 100 cells, each **100,000 km per side**, not 100,000 square km of area. The region spans 10 million km on each axis; the primary star is at (0, 0, 0).
- The map opens centered on the ship at a sensor-relative local scale. Its top-down X/Z projection uses equal distance scales on both axes; selected destinations retain their actual X/Y/Z coordinates for distance and warp calculations.
- Screen-space markers preserve local coordinate precision. An adaptive 1/2/5 grid and distance ruler subdivide cells locally and aggregate them at system scale. Individual sensor-range contacts disappear at broader scales; charted destinations remain selectable from the list even when markers overlap.
- Wheel zoom is proportional, animated, and anchored at the cursor, including repeated wheel input. Dragging pans without selecting a POI. Controls include ship recentering, whole-system overview, scanning, refresh, and zoom; the focused map also supports arrow-key panning, +/- zoom, and Home recentering.
- Successful server scans reveal destinations and add survey footprints. Discoveries reload from the existing server bootstrap; footprint overlays currently cover only scans performed in the current client session, not historical scan coverage. Failed scans reveal nothing. Map scanning and warp are unavailable while docked.
- Validation covers camera precision, aspect ratio, cursor anchoring, resizing, detail levels, sensor-range filtering, scan success/failure, drag selection, and warp coordinates. Desktop and mobile visual checks use mocked API data, not live flight or live-server warp validation.

## Next implementation slice

1. Move flight transforms, area-of-interest, and extraction range checks to the system server; add client prediction/reconciliation.
2. Add refinery recipes and commands that consume raw ore lots to produce mineral stacks, plus immutable ledger/idempotency records for inventory and extraction/refining.
3. Persist the Phase III fitting definitions, ships, fit records, and derived-stat snapshots; replace development data with authenticated pilot state.
4. Add typed fit/unfit/load/unload contracts, then integrate fitting UI with server-confirmed state.

Celery is intentionally excluded until Phase 5.
