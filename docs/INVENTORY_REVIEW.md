# Inventory review and upgrade

## Confirmed gameplay rules

- Personal Kepler station storage is unlimited and accessible for transfers only while docked.
- Raw ore is physical cargo, measured in cubic meters. All its movements preserve the source asteroid, composition and mineral assay.
- Jettisoned cargo is public salvage. Any nearby undocked pilot can collect the entire object if it fits; expired objects are removed.
- Bulk loading is best effort. Items too large for the remaining space are skipped; smaller items and partial ore can still load. Leftovers are reported and never discarded.
- Normal item quantities are whole units. Modules are individual objects. Definition versions, durability and unit volume must match before item stacks merge.

## Resolved issues

- Repeated free-module grants when station storage became empty.
- Hold overfilling because transfer and pickup checks ignored ore.
- Module pickup producing unusable multi-module stacks.
- Inventory hiding all ore whenever at least one ordinary item was present.
- Raw ore lacking normal transfer, split, merge, jettison and recovery actions.
- Remote station split/merge while undocked and space mutation responses revealing station contents.
- Bulk loading stopping at the first oversized item and decimal exact-fit errors.
- Ship capacity initialization using the newest starter hull instead of the ship's pinned hull.
- Stale cargo checkpoints overriding actual inventory volume.
- Stale modal responses, wrong-view refreshes, disappearing filter focus and uncaught mutation failures.
- Duplicate UI submissions and docking transitions occurring before the checkpoint succeeded.
- World pruning attempting to remove an asteroid referenced by public ore.

## Migration 12

[20260905_12_inventory_ore_containers.py](../server/alembic/versions/20260905_12_inventory_ore_containers.py) adds ore container ownership, public ore provenance, station-container uniqueness and singleton-module constraints. Existing ore is backfilled into ship cargo; legacy module stacks are expanded without discarding items. Duplicate station containers are coalesced without merging item identities.

Stop API writers and take a PostgreSQL custom-format backup before running this migration. Ambiguous legacy ship ownership stops the migration for manual reconciliation. The old schema cannot express the new ore locations and split lots, so automatic downgrade is intentionally blocked: rollback requires a reviewed recovery plan and the pre-upgrade backup.

The local development database was backed up outside the repository, upgraded from revision 11 to 12, and the rebuilt API restarted successfully on 2026-09-05. API health, all ore container locations, and singleton inventory modules were verified afterward. No backup or credentials are committed.

## Verification

- Server: **47 passed** using PostgreSQL scratch schemas, including concurrent duplicate transfers, competing pickups and capacity races. The SQLite default suite passes with the PostgreSQL-only cases skipped.
- Migration tests exercise populated legacy data, stack expansion, station deduplication, ore backfill, constraints and safe failure on ambiguous state.
- Client: **42 passed**, production build passed and ESLint passed. Tests cover quantities, assays in search, stale responses, dialog submission ownership and checkpoint-gated transitions.
- Browser: docked transfers and refresh checked against the upgraded API, including empty station storage not regenerating modules. Transferred modules were returned to their original storage. Mocked browser checks covered the ore/flight interactions and failure states without risking player cargo.
- Non-blocking warnings: large Babylon.js production bundle and a Starlette test-client dependency deprecation.

The optional PostgreSQL tests require `SPACECONOMY_TEST_DATABASE_URL`; they create and drop unique scratch schemas and never target application tables. Default inventory tests use an isolated in-memory SQLite database. Additional Python test dependencies are listed in [test requirements](../server/tests/requirements.txt).

## Remaining boundaries

- Movement, positions and docking are still client-reported prototype state. Server-owned movement/range validation is required before treating salvage or docking as cheat-resistant.
- PostgreSQL transactions and row locks prevent race corruption, but durable command IDs, retry deduplication and immutable audit entries remain future work. After a network failure the UI asks the player to refresh rather than blindly resubmitting a mutation.
- The world still exposes only Kepler station and a single active-ship workflow. This change does not implement multi-station asset browsing or ship selection.
- Refining, markets, crafting, container reservations and bulk multi-selection remain outside this inventory upgrade.
- Actual pointer-driven drag gestures and live in-space ore jettison/recovery were not exercised against player-owned cargo; API integration and mocked UI tests cover those operations.