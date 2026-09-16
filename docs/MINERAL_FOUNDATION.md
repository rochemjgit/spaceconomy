# Mineral Economy Foundation

## Implementation Stage

The first stage implements catalog content, persistent mineral metadata,
class-aware generation, and administrative inspection. It does not launch a
new live asteroid population. `asteroid_spawning_enabled` defaults to `False`.
The API is running with mineral metadata and private asteroid scans. On
September 14 the live mineral roster was initialized with the mineral-only
seed operation after a PostgreSQL backup. All 13 resources have roles; seven
legacy definitions remain retired. The resumed environment contains 60 active
fields, which were preserved. Spawning remains disabled.

## Content and Geography

The versioned source is [minerals.json](../server/catalog/minerals.json).
It defines iron, nickel, aluminum, titanium, silicon, cobalt, carbon, sulfur,
water ice, calcium, platinum, gold, and silver, with industrial roles and
visual metadata. These roles describe intended uses, not implemented recipes.

All 13 resources have positive selection weights in every class. Mineral
weights interpolate linearly between Class 1 and Class 10. Component-count
weights independently control the chance of a 1-6 component assay. Class 1
favors homogeneous and two-component asteroids; Class 10 favors complex
assays. The initial weights are provisional balance values.

Geography covers the full 100 by 100 X/Z chart, from -5 billion to +5 billion
meters on each axis. Each rectangular region spans 10 by 10 chart cells.
Seed 20260914 reproducibly distributes all ten classes across 100 regions,
independently of station positions and the system's circular spawn boundary.
Randomly oriented region pairs receive consecutive classes, so every region
shares an edge with at least one region one class higher or lower. Other
borders may have larger class differences. Interiors of regions have one class.
Minimum bounds are inclusive; maximum bounds are exclusive except at the
outer chart edge. Stable class IDs remain `kepler-class-1` through
`kepler-class-10`, each containing rectangular `regions` instead of ring radii.
Both maps and the generator share these definitions. The game map still shows
only private discoveries, fixed landmarks, and the pilot's own ship.
Existing field profiles and assays are not rewritten by this geography change.

## Persistence and Generation

- Migration `20260914_37` adds industrial role, visual family, and display color.
  It deactivates the seven superseded definitions without deleting identities
  or rekeying historical references. Downgrade drops the new columns but does
  not reactivate retired entries.
- Catalog seeding creates missing version-1 definitions and initializes blank
  legacy metadata. Existing admin names, availability, and initialized visual
  metadata survive reseeding. Existing rarity fields are retained for
  compatibility but do not control mineral generation.
  `spaceconomy.seed.seed_mineral_catalog()` initializes only minerals, without
  modifying fitting, manufacturing, refinery settings, or world content.
- Enabled spawning requires every catalog resource to have an active database
  definition. The highest active version is pinned into new assays. Disabling
  a required mineral prevents spawning visibly; there is no ferrous fallback.
- A spawn seed deterministically selects distinct minerals and their shares.
  Shares conserve exactly 100,000 thousandths of a percent. The first component
  is dominant: 100% for a homogeneous asteroid, otherwise 55-85%.
- Fields persist their zone ID, class, and catalog version in `spawn_profile`.
  Asteroid assays persist independently; metadata and content edits do not
  rewrite existing assays. Keep versioned content in source control when
  changing balance values.
- Disabled spawning does not create or expire asteroid fields. Unrelated
  jettison and market expiry maintenance continues. Startup no longer fills
  empty historical assays using obsolete profiles.

## Administration

`GET /api/v1/admin/minerals` returns metadata and membership in the spawn
catalog. `PATCH /api/v1/admin/minerals/{id}` validates metadata, rejects nulls
and identity/version changes, and persists edits transactionally.

The Minerals view exposes names, roles, surface families, color swatches,
and availability. Saving one row preserves unsaved edits in neighboring rows.
Retired definitions are listed separately. Zone complexity distributions are
read-only. The class map uses both numeric labels and cool-to-warm colors.

`GET /api/v1/admin/resource-zones` returns geography, component-count weights,
mineral selection weights, catalog version, and spawning status. System-state
responses also include the same geographic zone definitions. Weight changes
currently require a reviewed catalog edit, not live asteroid editing.

## Before Launch

1. Resolve existing field-retirement policy before enabling spawning. The
  replenishment helper currently deletes source-linked ore and refinery
  records, while an older inventory regression expects source preservation.
  Also decide how to transition the 60 pre-existing fields to the new content.
2. Connect visual metadata to deterministic asteroid geometry and surface hints.
3. Validate mineral/version references through mining and both refinery passes,
   preserving processing of valid historical references. No refinery behavior
   or yield-density scaling is changed by this stage.
4. Add and balance production sinks for all 13 resources. Module, ship, and
   consumable manufacturing support is not completed in this stage.
5. Validate authenticated gameplay scans and PostgreSQL concurrent scans,
  then accept economy tests before explicitly enabling spawning. The live
  backup is `spaceconomy-before-mineral-seed-20260914.dump` in the local
  user's temporary directory.

## Private Asteroid Scans

`POST /api/v1/mining/asteroids/{asteroid_id}/scan` returns the asteroid's exact
stored assay and versions only to the authenticated pilot. The pilot must be
undocked, have discovered the active field, have a fitted sensor, be within
its range according to saved ship position, and have sufficient capacitor
power. Depleted or inaccessible asteroids cannot be scanned. Field scans and
asteroid scans share the existing power cost and cooldown.

The normal asteroid list, extraction broadcasts, and newly written public
snapshots omit `mineral_assay`. Extracted ore and inventory retain their assay.
The public composition name remains a dominant-resource hint; it is not the
complete assay. Existing historical Redis snapshots are not rewritten by
this change.

In flight, open an asteroid's Details panel and use its scan icon. Results are
held only in the current pilot UI instance and cleared when the selected
target changes or is depleted. Delayed results cannot populate a different
target or a detached session. Both scan actions synchronize returned power
into the flight scene, not just the HUD. Position checkpoints remain the
existing client-reported model; this does not add server-authoritative flight.

Hazards, hostile encounters, anomalies, gravity effects, and quality grades
remain outside this foundation stage.

## Verification

From `server`, run:

```powershell
python -m pytest tests/test_mineral_assays.py -q
python -m pytest tests/test_admin.py -q -k mineral
python -m pytest tests/test_inventory.py -q -k "asteroid_assay or asteroid_scan or depleted_asteroid or field_scan_blocks"
```

From `client`, run:

```powershell
npm test -- --run src/admin.test.ts src/main.test.ts
npm run build
```

Coverage includes deterministic samples in all ten classes, exact percentage
conservation, pinned versions, migration identity preservation, persisted
field generation, safe reseeding, admin validation, independent row saves,
and shared ring/marker projection during zoom. Database tests use isolated
SQLite and do not establish PostgreSQL row-lock concurrency behavior.
The scan contract has ten focused backend regressions; the touched client
suites have 31 passing tests. The combined inventory/mineral/refinery run has
59 passes, five PostgreSQL-only skips, and the pre-existing replenishment
default/retention failure described above. The client production build passes.

Live admin checks at 1440px and 390px verify 13 populated rows, seven retired
definitions, and no page overflow without API mocks. Screenshot capture timed
out, so visual screenshot acceptance is incomplete. The deployed scan route
returns 401 without credentials and the live public asteroid schema excludes
assays. Authenticated gameplay scanning is covered by isolated API and DOM
tests, not a live player session.