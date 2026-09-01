## Phase 2: Resource Extraction, Items, and Inventory

**Goal**: Mining is a satisfying foundational activity that produces the inputs for every economy loop. It extends the Phase I authored system with shared resource fields, server-authoritative extraction, local station logistics, and the first use-based skill: asteroid scanning.

## Phase Boundary

Phase II builds on Phase I authentication, WebSocket envelopes, authoritative flight, destinations, warp/cruise, the three orbital stations, and the transaction-ledger foundation. It adds functional docking and a docked station scene because station-local storage, fitting, and refining require a validated station state and a clear place to perform those actions.

Phase II deliberately delivers only the mining equipment needed for the loop: fitting and removing mining lasers at a station. The broader hull-fitting budgets, module families, charges, combat, and general active-skill framework remain Phase III work. Environmental field hazards can affect navigation and visibility, but hostile NPCs and combat sites remain Phase IV work.

## Player Loop

1. At a docked orbital station, the pilot moves a mining laser from local station storage into a valid mining slot on their ship.
2. The pilot undocks, uses normal flight or eligible warp/cruise routes to reach an inner- or outer-belt field, and selects an asteroid.
3. The pilot scans the asteroid. A baseline scan takes 8-12 seconds and produces an approximate private reading of its composition, quality, remaining yield, and relevant hazard information.
4. The pilot may mine before scanning, accepting uncertain content and quality. A target-lock-and-cycle mining laser extracts ore into cargo while sufficient volume and energy are available.
5. When cargo capacity, asteroid depletion, danger, or travel choice ends the run, the pilot returns to a station. Cargo may also be jettisoned into a temporary space container when a tactical decision requires it.
6. The pilot docks into a station hangar, reviews the active station and ship state, transfers ore to that station's local storage, fits or removes mining lasers, creates refinery jobs, and may log out. The server completes each job based on elapsed time and delivers refined material to the same station storage.

## Design Principles

- The entire resource economy is server-authoritative. Clients issue intents; they never calculate yield, alter inventory, deplete asteroids, or complete a refining job.
- Storage is station-local. Moving inputs between orbital stations is a meaningful logistics decision from the first release.
- Asteroids are a shared world resource. Every pilot in a field observes the same remaining yield and depletion events.
- Scanning rewards repeated valid use. It is information gathering, not an action gate: mining an unscanned asteroid remains allowed.
- Exact grade count, ore catalog, material catalog, yields, and timing values are data-driven balancing content. The implementation must not assume a fixed number of quality grades.
- Cargo creates the primary mining-trip pressure. Energy, asteroid availability, travel distance, and hazards complement it without replacing the volume decision.

## Items And Containers

### Item Definitions

Create data-driven item definitions for raw ore, refined materials, components, mining modules, ammunition/charges, fuel, consumables, and future equipment. Each definition includes a stable identifier, display data, category, stack limit, unit volume, tradability/binding policy, rarity, and optional quality-grade rules.

An inventory stack references an item definition and records its quantity, container location, and quality grade when the definition supports grades. Grade is a discrete data value, not a generated random affix. Items with identical definition and grade may merge only when the destination capacity permits it.

Quality is discovered through asteroid scanning and represented on mined ore. Refining uses grade as a configurable material-yield modifier. It does not introduce different material-grade item definitions in this phase.

### Containers

Every container has both a maximum slot count and total volume capacity. Capacity validation must run before every mutation.

| Container | Location | Access | Constraints |
| --- | --- | --- | --- |
| Ship cargo | Active ship | Pilot while ship state permits | Slots and volume; primary mining destination |
| Station storage | One specific orbital station | Pilot only while docked at that station | Slots and volume; never shared across stations |
| Wreck | Space at destruction location | Owner during grace period, then public | Slots and volume; expires after 15 minutes |
| Jettisoned container | Space at ejection location | Owner during grace period, then public | Slots and volume; expires after 15 minutes |
| Refinery input reservation | One specific refinery job | Job service only | Locked until completion or valid cancellation |

Ship destruction turns eligible cargo into a wreck at the authoritative destruction location. The owner has exclusive access for five minutes; the contents are public for the remaining ten minutes. Jettisoned cargo follows the same access and expiry rules. On expiry, the container and any remaining contents are removed and a ledger event records the destruction.

### Inventory Operations

Support split, merge, move, and jettison operations. A move validates the pilot, source ownership or public-loot permission, source quantity, destination slot and volume capacity, docked/space access state, and an idempotency key. It then updates the source and destination atomically and writes an immutable item-ledger event.

Transfers to or from station storage require a validated docked state at that exact station. Transfers to wrecks and jettisoned containers require authoritative proximity and access validation. Refinery job creation reserves the selected ore from station storage atomically so it cannot be transferred, refined twice, or sold by a later economy phase.

## Resource Fields And Asteroids

The inner belt is divided into spatially separated, high-traffic fields with accessible baseline ore. The outer belt uses distinct, more distant fields with rarer or higher-yield ore, longer travel commitment, and stronger environmental navigation pressure. Both belts must be seeded from data rather than scene-specific code.

Each field definition includes its system position, visual theme, warp/cruise destination metadata, availability band, hazard configuration, asteroid spawn table, respawn policy, and visibility/LOD metadata. Each asteroid instance records its field, world transform, visual variant, composition profile, quality profile, remaining yield, current lifecycle state, and respawn time when depleted.

Asteroid composition and grade are not exposed as exact values before scanning. A scan stores a private result for the scanning pilot until that asteroid depletes or respawns. It is not broadcast to nearby pilots and does not persist as permanent character knowledge. Depletion or respawn invalidates prior scans because the asteroid's resource state has changed.

Asteroids have physical collision geometry. They block ship movement and may deal capped minor collision damage based on validated impact conditions. This is navigation risk, not a substitute for Phase IV combat. Field hazards may slow movement, impair visibility or sensors, and add collision risk; they must not create player-versus-player damage paths or require NPC combat.

### Shared Depletion And Respawn

Mining cycles reduce the authoritative remaining yield of the targeted asteroid. The server broadcasts state changes to nearby pilots at a rate suitable for the client HUD and scene updates, and broadcasts a definitive depletion event once yield reaches zero. A depleted asteroid cannot be scanned or mined. The respawn worker restores it according to the field's controlled respawn policy and issues an availability event.

Concurrent mining cycles resolve in the simulation's authoritative order. If an asteroid has less remaining yield than a completed cycle requests, the final cycle receives only the remaining valid yield. The server must never create more ore than the asteroid held.

## Scanning And Active Progression

Scanning is the initial active skill slice and establishes the pattern expanded in Phase III. A pilot initiates a scan only when the asteroid exists, is in range, is not depleted, and the ship can perform the action. A baseline scan takes 8-12 seconds. The server owns scan progress and completion; reconnecting does not let a client complete or accelerate an interrupted scan.

The scan result is approximate rather than a perfect item inspector. It reports confidence-bounded composition, quality, remaining yield, and detectable local hazards. Higher scanning skill improves both scan reliability/time and information precision. Exact formulas, tiers, caps, and advancement thresholds remain data-driven balancing work, but skill progress is awarded only after a server-verified completed scan and must be rate-limited with per-action caps.

The system records immutable scan-completion and skill-progression events so balancing can be changed or migrated later. No passive or elapsed-time skill gain is allowed.

## Mining Equipment And Extraction

Mining lasers are station-fitted modules. Equipping or removing one requires docking, local station-storage ownership, valid ship compatibility, and a successful atomic inventory update. Phase II may use a minimal mining-slot compatibility contract, leaving general fitting budgets and module stat aggregation to Phase III.

To start a mining cycle, the pilot's ship must have a fitted operational mining laser, the target asteroid must be in range and available, the ship must be in a permitted local-flight state, and cargo must have at least enough capacity for the resolved yield or the operation must use a documented partial-yield rule. The server validates capacitor/energy availability, starts the cycle, and sends progress events. Cycles use long-session balancing targets; their exact duration, energy cost, range, and yield are module data.

At a completed cycle, the server resolves yield from the module, valid ship state, asteroid composition, quality data, and any approved modifiers; subtracts the extracted amount from shared asteroid yield; inserts the ore into ship cargo; records item and extraction ledger events; and broadcasts updates. The client renders beam, sound, particles, and feedback only from accepted server state. It must stop or reject mining with explicit reasons for invalid target, range, depletion, insufficient energy, full cargo, lost module state, or invalid ship state.

## Docking, Storage, And Refining

Docking is a server-validated state transition. The ship must be at a valid orbital-station docking point, satisfy Phase I movement/state rules, and not be in an incompatible action or travel state. The client may show docking availability from replicated nearby-world data, but selecting dock never changes the scene or enables services until an accepted docking event provides the station ID, assigned bay, and authoritative docked state.

While docked, movement input and space-only actions are disabled. Local station storage, mining-laser fitting, cargo transfer, and refinery job operations become available only for the exact docked station. Undocking is a server-validated transition that rejects active incompatible operations, restores the normal space action set, and places the ship at a server-defined safe launch transform outside the station. Reconnect restores the persisted docked state at the same station when valid; it never recreates a docked state from client UI state.

### Docked Scene And Station Experience

Docking transitions the client from the flight scene to a station-specific hangar scene. Phase II may use shared modular hangar geometry with station-specific identity, lighting, signage, exterior viewport treatment, and assigned-bay metadata; it must not imply that all three stations share one inventory or service state. The current Kepler hangar prototype is presentation-only and becomes the scene-lifecycle baseline rather than an authority boundary.

The docked scene presents the active ship on its bay, the station name and bay, an unambiguous docked state, and a compact station-service navigation surface. Required services are Ship Cargo, Station Storage, Mining Fitting, and Refinery Jobs. Services may be panels over the hangar scene or a dedicated station UI layer, but all operations remain available only while the server-confirmed docked state is current. The scene is a place for management, not avatar movement, combat, or a separate social-space feature.

Station panels make the local context legible: the station name, cargo slots and volume, station-storage slots and volume, fitted mining-laser slots, reservation state, and refinery job state. Inventory views show item display data, quantity, grade where applicable, unit volume, total stack volume, and capacity remaining. Controls for split, merge, move, fit, remove, jettison, create job, cancel job, and undock are enabled only when replicated state supports them; commands include an idempotency key and show accepted, pending, and rejected outcomes without locally finalizing an inventory change.

The fitting service limits Phase II interaction to mining-compatible slots. It identifies an empty, fitted, unavailable, or incompatible slot; supports fitting from this station's storage and removing back to this station's storage; and reports capacity, ownership, compatibility, or docking failures in place. It does not expose Phase III hull-budget, combat-module, charge, or general-equipment controls.

The refinery service lets a pilot select eligible ore in this station's storage, choose valid quantities, inspect duration and expected output range, submit multiple jobs, and view running, complete, cancelled, and failed job states. Reserved ore is visibly unavailable to other station actions. Completed output remains assigned to this station's storage and is not silently moved to ship cargo. A pilot may leave the station or log out while jobs run; the next valid docked/reconnect snapshot shows authoritative status.

The docked UI preserves access to session, connection, notification, and error feedback. It hides flight-only controls, minimap/flight telemetry, targeting reticle, and space HUD while docked. It provides a keyboard-operable service navigation path, focus handling for modal confirmations where used, readable capacity warnings, reduced-motion behavior for scene transitions, and responsive layouts that keep capacity and primary actions visible on common desktop resolutions.

The client owns only the visual transition, panel state, and optimistic pending indicators. Docking, undocking, bay assignment, inventory contents, capacity, module fit state, job state, and all operation outcomes are server-authoritative. On a rejected command, stale docked-state event, disconnect, station change, or undock confirmation, the client discards invalid local panel state and reconciles from the latest snapshot.

Refining is a timed server-side job, not an immediate conversion. A pilot creates a job only while docked at the station holding the input ore. Phase II supports unlimited concurrent refinery jobs; timing is the intended production commitment, not shared queue contention. A job records its station, owner, input stacks and quantities, recipe/version, applied efficiency and quality-yield values, start time, completion time, state, and output destination.

Job input is reserved immediately. The background worker completes due jobs even when the pilot is offline, consumes the reservation, delivers outputs to the originating station's local storage, and writes immutable conversion and inventory-ledger events. Completion must be idempotent so retries cannot duplicate materials. Cancellation policy, if enabled, must be data-driven and define whether inputs return in full, return with loss, or are not recoverable; it cannot bypass reservation or ledger rules.

## Client Experience

The extraction HUD presents the selected asteroid, scan state and confidence, estimated composition/quality/yield after a scan, local hazard warnings, mining-cycle progress, accepted yield, cargo slots and volume, and current speed/vector state. It reports failures as clear action feedback instead of silently ending a cycle. Within valid station docking range, the space HUD presents dock availability and a pending docking state, but retains flight control until server confirmation.

The docked station experience presents only the active station's storage, mining-laser fit state, cargo transfer controls, refinery input selection, job duration, expected yield range, running/completed jobs, output destination, ship bay, and server-confirmed docked state. The client distinguishes private containers, public containers, and expired/invalid targets. Scene rendering gives asteroids distance-aware visual variants and shows shared depletion, mining effects, collision geometry, and field-hazard effects without granting hidden resource information.

## Server Contracts And Persistence

Use typed HTTP/WebSocket contracts for at least: inventory move/split/merge/jettison, asteroid scan start/cancel, mining start/stop, docking request/accepted/rejected, undocking request/accepted/rejected, docked station snapshots including station and bay identity, refinery job create/cancel/query, container access, and state snapshots. Every mutable command carries an idempotency key and returns either an accepted event sequence or a stable validation error code.

Persist inventory stacks, station storage locations, asteroid instances and lifecycle state, private scan results, wrecks, jettisoned containers, refinery jobs/reservations, and item/extraction/refining/skill ledger events in PostgreSQL. Redis may cache nearby field state and fan out proximity events, but it is not the source of truth for yields, ownership, jobs, or inventory. Use background workers for asteroid respawn and refinery completion.

Authoritative event envelopes must cover inventory changes, scan lifecycle and result, mining lifecycle and yield, asteroid depletion/respawn, container ownership/expiry, docking changes, and refinery-job lifecycle. Clients reconnect by fetching persistent state and reconciling it with current nearby-world events.

## Validation And Abuse Controls

- Validate identity, ownership, proximity, docking state, ship/module state, target state, range, capacity, and energy at the authoritative command boundary.
- Enforce rate limits for scan, mining, inventory, container, and refinery commands.
- Use transactional inventory mutations and ledger writes so failed requests leave no partial transfer, reservation, yield, or output.
- Reject client-supplied positions, yields, scan outcomes, asteroid state, job-completion timestamps, and container permissions.
- Make background completion, container expiry, and respawn tasks idempotent and safe to retry.
- Emit audit data for impossible yield, inventory, collision, and movement conditions for future operator tooling.

## Implementation Order

1. Create item, quality, container, inventory-stack, ledger, field, asteroid, scan, temporary-container, and refinery-job persistence models and migrations.
2. Implement transactional inventory operations, capacity validation, station-local storage, temporary-container ownership/expiry, and ledger events.
3. Seed data-driven inner- and outer-belt fields, asteroid profiles, hazards, and respawn rules; implement shared authoritative depletion and respawn.
4. Add docking state transitions, the docked scene lifecycle, and the station storage/fitting surface for mining lasers.
5. Implement scan lifecycle, private approximate results, use-based skill events, and client-visible scan feedback.
6. Implement mining-cycle validation, energy use, yield resolution, cargo delivery, proximity broadcasts, and visual/audio event consumption.
7. Implement timed refinery jobs, reservations, offline completion, output delivery, and job UI.
8. Complete the extraction HUD, docked station experience, scene-state, reconnect, and failure-state coverage; then run multiplayer and persistence verification.

## Acceptance Tests

- A player can dock at one orbital station, fit a mining laser from that station's storage, and cannot fit it remotely or from another station's storage.
- A pilot who receives a docked-state confirmation enters that station's hangar and can access only its storage, mining-fitting, and refinery services; a client-side scene change, stale docked event, or disconnect cannot grant station access.
- A pilot can undock only through a server-accepted transition, returns to a valid server-defined launch transform, and sees flight controls return only after the undock event; reconnecting while docked restores the same station context and active jobs.
- Station panels show pending, accepted, and rejected inventory, fitting, and refinery actions without duplicating items or treating a local UI update as a completed transaction.
- Two nearby players observe the same asteroid yield decrease and receive one consistent depletion event; concurrent final cycles cannot over-extract it.
- A player can mine an unscanned asteroid, while a completed scan returns only that player an approximate result that becomes invalid on depletion or respawn.
- Repeated valid scans award bounded, server-recorded scanning progress; interrupted or spoofed scan completions do not.
- Cargo respects both slot and volume limits for merges, splits, mining output, transfers, wreck recovery, and jettisoning.
- A destroyed ship creates a recoverable wreck; its owner has five minutes of exclusive access, it becomes public afterward, and it and jettisoned containers remove remaining contents after 15 minutes.
- A pilot can dock with ore, transfer it to local storage, create multiple refinery jobs, log out, and receive outputs into that same station's storage after server-side completion.
- A reconnect restores inventory, local storage, running refinery jobs, private valid scan results, and authoritative nearby asteroid state without client-authoritative changes.
- Invalid position, target, range, energy, capacity, ownership, docking, job-time, or inventory requests are rejected and create no items or materials.