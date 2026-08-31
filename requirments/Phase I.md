# Plan: Single-System Isometric Space MMO

## Context
- **Inspiration**: Eve Online (resource extraction, manufacturing, equipment-driven economy) + WoW (instanced PvE and open-world exploration/combat)
- **Core loops**: Mining, crafting/manufacturing, ship equipment, consumables, PvE combat, economy/trading
- **Client**: Browser (HTML5/WebGL)
- **Backend**: Python
- **Scale**: ~500 CCU in one authored star system with a compressed-realistic orbital layout
- **Navigation decision**: Newtonian turn-and-burn flight locally; warp/cruise travel only between server-defined destinations for strategic journeys
- **Explicit exclusions for initial release**: procedural galaxy generation, additional systems, PvP, quests, passive/time-based skills

## Recommended Stack
- **Client**: Babylon.js + Vite + TypeScript (WebGL, isometric camera, shaders/particle effects)
- **Backend**: FastAPI (async HTTP and WebSocket support)
- **Persistent data**: PostgreSQL + SQLAlchemy + Alembic
- **Ephemeral/realtime state**: Redis (sessions, rate limits, nearby-player pub/sub, game tick cache)
- **Background processing**: Celery + Redis, introduced with the Phase 5 manufacturing, node-respawn, and market-matching work rather than Phase 1
- **Auth**: JWT access/refresh tokens; Discord OAuth2 can follow basic account auth
- **Deployment**: Docker Compose, one server deployment initially; module boundaries retain a future multi-system path

---

## Starting System Blueprint
**Intent**: Make a single system feel immense without forcing real-time multi-hour transits. Its orbital arrangement is compressed but preserves recognisable inner/outer-system scale and travel decisions.

1. Create a primary star and three distinct rocky inner planets, ordered from closest to farthest orbit.
2. Give each rocky planet one orbiting station. Stations are the primary docking, respawn, storage, refining, manufacturing, fitting, and market hubs; their inventories and markets remain local to that station.
3. Place a broad inner asteroid-belt ring beyond the rocky planets. It is the initial high-traffic mining region, subdivided into spatially separated fields instead of one dense asset cluster.
4. Place two gas giants beyond the inner belt, each with visual moons/rings and differentiated PvE/resource identities.
5. Place a broad outer asteroid-belt ring beyond the gas giants, with longer travel time, more valuable/rarer resources, and greater PvE pressure.
6. Treat planet/star gravity and orbital motion as visual/world context in the first playable version. The player-flight simulation uses deterministic ship thrust and rotation rather than n-body orbital physics, avoiding unstable/fairness-sensitive multiplayer physics.

---

## Phase 1: Foundation and Playable System Shell
**Goal**: Deliver a local-developer vertical slice in which two or more authenticated pilots can enter the same persistent system, see nearby ships move, and fly their own ship in full 3D under server authority. The visual target is a polished stylized low-poly scene, not final art or complete gameplay loops.

### Confirmed Product Decisions
- **Release target**: Local vertical slice. Production hosting, public-scale operations, social login, and full 500-CCU validation are deferred.
- **Access**: Email/password registration with access and refresh JWTs.
- **Presentation**: Stylized low-poly ships and celestial bodies, with strong lighting, readable silhouettes, and restrained effects suitable for browser performance.
- **Flight space**: Full 3D local movement. The camera remains isometric, but pilots may use vertical thrust and navigate above or below the nominal orbital plane.
- **Multiplayer**: Nearby connected players are replicated and visibly move in the shared world. Player-to-player targeting, collision damage, trading, and chat are out of scope.
- **Starter location**: Account creation presents the three seeded orbital stations and persists the selected eligible starter station, pilot spawn transform, ship, cargo container, and starter fuel allocation atomically.
- **Travel pacing**: An adjacent warp takes approximately 30 seconds door-to-door, including alignment and spool. Keep route distance, phase durations, and speed values data-driven so pacing can be tuned without code changes.
- **Warp recovery**: A pilot reconnecting during warp resumes the remaining journey from the server's persisted authoritative arrival timestamp.
- **Fuel**: Warp consumes an item-based fuel stack from ship cargo in Phase 1; this phase includes only the minimal authoritative inventory capability needed for fuel, not the full Phase 2 inventory experience.
- **Controls**: Keyboard and mouse are the only required Phase 1 control scheme.
- **Realtime protocol**: Game WebSocket messages use a versioned MessagePack envelope; development tooling must provide decoded diagnostic logging and fixture inspection.

### Phase Deliverables
1. A reproducible monorepo and local development environment.
2. A data-seeded, visually coherent single star system with destinations usable by navigation.
3. Secure basic account/session handling and persistent pilot/ship state.
4. A versioned HTTP/WebSocket contract for realtime commands and state events.
5. Server-authoritative fixed-tick flight, with client prediction, reconciliation, interpolation, and presence replication.
6. Destination-to-destination warp/cruise that is validated and resolved exclusively by the server.
7. A responsive Babylon.js client with a clear HUD, usable keyboard/mouse controls, and stylized placeholder art.
8. Automated tests and a repeatable manual verification checklist for the vertical slice.

### Implementation Order
1. **Establish the runtime baseline**: scaffold the repository, configure local PostgreSQL/Redis/API/client services, environment settings, migrations, linting, type checks, tests, and CI.
2. **Freeze the initial contracts**: define versioned REST and MessagePack WebSocket envelopes, typed errors, input commands, bootstrap/snapshot events, and compatible serialization fixtures.
3. **Build identity and pilot creation**: implement registration/login/session rotation, station selection, idempotent pilot/ship/cargo/fuel creation, and persisted legal spawn state.
4. **Seed the authoritative world model**: add migrations and repeatable content for system bodies, stations, destinations, starter hull/fuel item, cargo stacks, visibility constants, and the permitted route graph.
5. **Implement and test deterministic local flight in isolation**: complete the server simulation, shared/client prediction math, input sequencing, flight assist, safe-state recovery, and replay tests before connecting final rendering.
6. **Add realtime session and presence behavior**: implement authenticated WebSockets, connection/reconnect state, spatial interest subscriptions, bounded MessagePack snapshots, backpressure handling, and multi-client integration tests.
7. **Build the client presentation around stable contracts**: implement the Babylon scene, low-poly assets, camera, keyboard/mouse input, local prediction, remote interpolation, HUD, diagnostics, and accessibility baseline.
8. **Implement transactional warp**: add route validation, alignment/spool/transit/arrival state transitions, fuel reservation/consumption/refunds, server-defined arrivals, reconnect resume, and travel presentation.
9. **Complete the vertical-slice validation pass**: run browser smoke tests, two-client/manual acceptance tests, service-restart recovery tests, telemetry measurements, performance profiling, and documentation cleanup.

**Ordering rule**: Do not begin client polish or warp implementation until the movement and MessagePack contract tests are stable. Do not begin warp implementation until route data and minimal fuel inventory transactions are present.

### 1. Repository, Tooling, and Runtime Baseline
1. Create `/client`, `/server`, `/contracts`, `/infra`, and `/docs` roots. Keep game constants and world-content definitions out of UI components and route handlers.
2. Initialize the client with Vite, TypeScript, Babylon.js, strict TypeScript settings, ESLint, formatting, unit tests, and a production build command.
3. Initialize the server with FastAPI, SQLAlchemy, Alembic, Pydantic settings, pytest, async test support, formatting, linting, and static type checking.
4. Add a Docker Compose development stack containing PostgreSQL, Redis, API, and client/static hosting. Support a single command that starts dependencies and a documented reset path that removes only local development data.
5. Store configuration in environment variables. Commit an `.env.example` containing only safe defaults; do not commit passwords, JWT signing keys, or database URLs containing credentials.
6. Define developer commands for database migration, system seeding, test execution, client build, server launch, and combined local startup.
7. Add CI for formatting/linting, type checks, unit tests, client production build, and Alembic migration validation. Container-image publishing and deployment pipelines are not Phase 1 requirements.

**Done when**: A new contributor can clone the repository, configure local environment values, start the services, apply migrations, seed the system, register a player, and open the browser client without manual database edits.

### 2. Shared Contracts and System Boundaries
1. Define versioned schemas in `/contracts` for REST responses, WebSocket commands, events, errors, and world-content records. Generate or validate client TypeScript types from the same schema source where practical.
2. Use a consistent event envelope containing `version`, `event_type`, `request_id` when applicable, server simulation time, and a typed payload. Return typed error events rather than silently dropping invalid commands.
3. Define command envelopes for authentication, input updates, warp requests, destination discovery, heartbeat, and clean disconnect. Inputs express player intent, never an authoritative position or velocity.
4. Split server responsibilities into modules: identity/authentication, persistence, world content, realtime gateway, simulation, navigation, and observability. HTTP route handlers and WebSocket handlers must call domain services rather than embed game rules.
5. Introduce a stable entity identity format and separate immutable content IDs from runtime entity IDs. This supports later instances without leaking one player's runtime objects into another namespace.
6. Add structured logs with request/session/player correlation IDs. Record security-relevant failures, warp validation decisions, connection lifecycle changes, and simulation exceptions.

**Done when**: The client can exchange typed commands and events with the server; malformed, unauthenticated, expired, and unsupported requests have deterministic error responses.

### 3. Identity, Account, and Pilot Lifecycle
1. Implement account registration using normalized email addresses, password complexity requirements, and a modern adaptive password hash such as Argon2id. Never log raw passwords, tokens, or password-hash values.
2. Implement login, short-lived access tokens, refresh-token rotation, token revocation on logout, and an authenticated `me`/session endpoint. Prefer refresh tokens in secure, HttpOnly, SameSite cookies; document the local-development exception if one is needed.
3. Rate-limit registration, login, refresh, and WebSocket authentication attempts. Return generic login failures so account existence is not disclosed.
4. During first account setup, let the player select one of the three configured starter stations. In one idempotent transaction, create a pilot, starter ship, cargo container with capacity matching the hull, starter fuel stack, persisted spawn transform, and selected known destinations.
5. Persist a pilot's last safe location, ship fitting placeholder, ship transform, and selected known destinations. On reconnect, restore a legal world state; recover invalid or missing positions to the starter station.
6. Keep display name selection and account recovery deliberately small for this milestone. Email verification, password reset email, Discord OAuth, profiles, and social systems remain follow-up work.

**Done when**: A user can register, log in from a second browser session, refresh a session, log out, and reconnect with the same pilot and persisted ship location.

### 4. Data Model, Migrations, and Seed Content
1. Create migrations and models for accounts, refresh sessions, pilots, ships, hull definitions, item definitions, minimal inventory containers/stacks, systems, celestial bodies, stations, points of interest, destination routes, discovered destinations, transforms, and append-only transaction-ledger foundations. Defer general inventory-transfer workflows to Phase 2.
2. Keep static content data-driven. Seed definitions from reviewed JSON/YAML or Python data fixtures, then persist them in the database with stable IDs. Runtime code should query content records rather than encode names, coordinates, or travel values.
3. Seed exactly one system with a primary star; three distinct rocky inner planets; one orbital station per planet; multiple named inner-belt fields; two gas giants with visual moons/rings; and multiple outer-belt fields.
4. Each destination must include a content ID, name, category, world position, arrival position/orientation, discovery state, visibility band, warp eligibility, and optional cooldown metadata. Each permitted route must separately define origin destination, target destination, game distance, door-to-door duration, alignment/spool/transit durations, fuel item and quantity, arrival transform, and enabled state.
5. Use a documented right-handed world-coordinate convention in meters or game units, with $x$ and $z$ defining the orbital plane and $y$ representing vertical altitude. Use double precision for server world positions if the chosen system scale requires it; convert carefully for client rendering.
6. Preserve a logical orbital scale even though distances are compressed. Establish configurable bands for tactical interaction, local presence replication, body detail/LOD, destination selection, and warp entry/arrival.
7. Seed one starter hull with known mass, thrust, torque, maximum linear/angular velocity, damping/flight-assist values, warp capability, and simple placeholder capacity fields. Balance is provisional but must be repeatable.

**Done when**: Running the seed command repeatedly produces the same authored content without duplicates, and every destination displayed by the client resolves to a valid persisted record.

### 5. Realtime Gateway and Presence Replication
1. Authenticate the WebSocket upgrade or first command with a valid access token, bind the connection to a pilot/session, and reject duplicate or revoked sessions according to a documented policy.
2. Maintain an in-memory connection registry and a Redis-backed presence/region mechanism so the boundary can later scale beyond one API process. Phase 1 may run one simulation worker but must not depend on browser state as a source of truth.
3. Partition shared space into configurable spatial cells. Publish snapshots only to pilots inside the relevant interest radius/cells, including a small hysteresis margin to prevent rapid subscribe/unsubscribe churn.
4. Send initial world/bootstrap state after connection: pilot identity, owned ship state, nearby replicated entities, known destinations, static-content revision, and current server time.
5. Send compact, versioned MessagePack snapshots for nearby ships and event-based changes for joins, leaves, warp state, and destination discovery. Begin with 10 Hz presentation snapshots, an interpolation buffer, bounded extrapolation, and a visible degraded-connection state once the buffer can no longer hide late data. Define and measure a maximum message size before implementation.
6. Include ping/heartbeat, idle timeout, reconnect handling, backpressure limits, and message-rate limits. Use a bounded per-connection outbound queue; discard superseded snapshots where safe and close persistently slow clients safely, logging the reason.
7. Do not implement player collision resolution in this phase. Ships may overlap visually; all gameplay collision, targeting, and damage systems are deferred.

**Done when**: Two authenticated browser clients connected near the same station see each other's join, movement, warp departure/arrival, disconnect, and reconnect without receiving their authoritative state from another browser.

### 6. Server-Authoritative Flight Simulation
1. Run the movement simulation at one fixed, documented rate (initial target: 20 Hz) using a monotonic server clock and bounded catch-up steps. Broadcast presentation snapshots at a separately configurable rate (initial target: 10 Hz).
2. Accept a compact intent state: forward/reverse, left/right strafe, vertical thrust, yaw/pitch/roll or selected turn axes, flight-assist toggle, and sequence number. Clamp values to valid ranges and discard stale/out-of-order commands.
3. Model each ship with position, linear velocity, orientation, angular velocity, mass, thrust limits, torque limits, speed caps, and damping. Integrate motion deterministically enough for authoritative replay and diagnostic tests.
4. Apply acceleration and torque in ship-local axes, then transform them into world space. Enforce maximum acceleration, angular acceleration, linear velocity, and angular velocity server-side.
5. Provide flight assist as server-side stabilization/braking: when thrust is released, apply acceleration opposite the current velocity, capped at the hull's configurable maximum braking acceleration, rather than instantly setting velocity to zero. A player can disable it for inertia-driven flight; the identical fixed-step formula must power both server simulation and client prediction.
6. Treat all client transforms as visual predictions only. The client sends sampled input intent, predicts from the last acknowledged state, keeps a short input history, reconciles to server snapshots, and smooths small corrections without hiding large corrections.
7. Interpolate other pilots from buffered snapshots. Use extrapolation only for a tightly bounded interval and expose a degraded connection indicator instead of allowing uncontrolled visual divergence.
8. Validate every simulation tick against finite numeric values and legal world bounds. If validation fails, reset the pilot to the last server-validated safe transform, persist and broadcast a corrective snapshot, and produce an operator-visible diagnostic record. Update the safe transform on legal spawn, completed warp arrival, and regular validated local-flight checkpoints.
9. Implement unit tests for thrust, inertia, braking, rotation, speed caps, input sequencing, illegal transform rejection, and deterministic replay of a fixed input sequence.

**Done when**: A client cannot teleport, set velocity, or exceed ship limits by modifying browser messages; a controlled turn-and-burn stop is repeatable at normal latency; remote ships move smoothly under ordinary local-network conditions.

### 7. Warp/Cruise Navigation
1. Expose a destination panel/map list that shows stations and belt fields known to the pilot, their category, approximate distance, and eligibility state. In Phase 1, seed starter-known destinations rather than requiring exploration mechanics.
2. Implement a clear state machine: `local_flight` → `aligning` → `spooling` → `in_warp` → `arriving` → `local_flight`, plus failure/cancellation transitions. Persist state changes needed for safe reconnects.
3. Validate each warp request server-side: destination exists and is known, a permitted route exists from the current destination/state, pilot is not docked or in an incompatible state, ship is within configured initiation constraints, cooldown is complete, and the required fuel stack is available in ship cargo.
4. During alignment/spool, continue authoritative local simulation and allow cancellation under defined rules. During warp, hide or simplify tactical local movement, remove the ship from normal local-presence replication, and broadcast the travel state to relevant nearby pilots.
5. Resolve arrival at a server-defined safe transform rather than a client-provided coordinate. Apply arrival cooldown/protection state as a placeholder for later combat rules.
6. Use an initial target of about 30 seconds door-to-door for adjacent major destinations. Store alignment, spool, and transit durations in the route definition, derive their total from the configurable route distance/cruise-speed curve, and apply minimum/maximum caps to protect session pacing.
7. Reserve and consume fuel server-side using an atomic transaction. Define cancellation/refund rules explicitly: no fuel cost before successful spool start; refund fully for server-side validation/error failures before transit; and consume reserved fuel once transit begins. Persist origin, destination, warp state, started time, and authoritative arrival time together so reconnects resume the remaining journey safely.
8. Add visual feedback for alignment, spool, active travel, remaining time, cancellation/failure, and arrival. Use lightweight effects suitable for the low-poly visual direction.

**Done when**: A pilot can select an eligible station or belt, complete a server-authorized warp, reconnect safely during or after travel, and cannot warp to unknown, arbitrary, or tactically prohibited coordinates.

### 8. Client World, Camera, HUD, and Controls
1. Build the Babylon.js bootstrap, asset-loading boundary, scene lifecycle, render loop, and cleanup behavior. Keep rendering, input, network client, world state, and UI panels separate so future screens do not require scene rewrites.
2. Implement an adjustable isometric perspective camera that tracks the local ship, supports orbit/zoom/pan within safe limits, maintains useful framing during vertical movement, and has a reset-to-ship action. Camera motion must not change authoritative ship orientation or flight.
3. Render a stylized starfield, restrained nebula backdrop, primary star lighting, rocky planets, gas giants, rings/moons, stations, asteroid-field markers, and low-poly ships. Use emissive materials, bloom, particles, and post-processing sparingly, with a quality toggle.
4. Implement distance-aware representation: high-detail local ship/station models, simplified distant bodies, and icon/marker representations at system-map distance. Avoid rendering the full asteroid belts as individual high-cost meshes in Phase 1.
5. Provide keyboard/mouse controls with visible control hints and a remappable-input design boundary. Include forward/reverse/strafe/vertical thrust, rotation, flight-assist toggle, warp panel, destination selection, interaction placeholder, and camera reset.
6. Build a responsive HUD with ship speed, velocity vector or relative-motion indicator, heading/orientation cue, flight-assist state, selected destination, current warp state, connection quality, nearby pilot markers, notifications, and session/logout controls.
7. Show clear recoverable errors for disconnection, expired login, failed command validation, unavailable destination, and server resynchronization. Never let UI optimistic state be treated as completed gameplay state until server confirmation arrives.
8. Define a basic accessibility baseline: readable scalable UI, sufficient contrast, non-color-only state cues, keyboard-operable panels, reduced-motion option, and no critical feedback that depends only on bloom or particles.

**Done when**: The browser client remains clear and usable on common desktop resolutions, presents a coherent stylized system, and lets a player understand movement, nearby presence, connection status, and warp progress without debug tools.

### 9. Test Plan, Telemetry, and Exit Criteria
1. Create API tests for registration, login, token refresh/rotation, logout, authorization failures, first-pilot creation, and reconnect persistence.
2. Create simulation tests for deterministic movement, limits, invalid input, sequence ordering, warp state transitions, eligibility checks, arrival transforms, and disconnect/reconnect recovery.
3. Create integration tests using a real or containerized PostgreSQL/Redis service for migration, seed idempotency, WebSocket authentication, multi-client presence, and server rejection of client-authored transforms.
4. Add client unit tests for input mapping, prediction/reconciliation helpers, snapshot interpolation, state reducers, and warp UI states. Add a browser smoke test for registration-to-flight-to-warp where practical.
5. Capture development telemetry: connected pilots, active connections, simulation-tick duration, dropped/invalid commands, outbound snapshot size/rate, WebSocket disconnect reasons, warp success/failure counts, and client frame-time samples when consented/appropriate.
6. Establish provisional local acceptance budgets: the simulation tick must complete comfortably within its 50 ms interval; normal websocket messages must remain compact; and the client should target 60 FPS on a representative development machine, with quality reduction available when needed. Record actual measurements rather than treating targets as proof of 500-CCU readiness.
7. Write a manual test script covering a fresh registration, duplicate/invalid login paths, two-client visibility, full 3D movement, flight-assist braking, forced network reconnect, successful and rejected warp requests, browser refresh, service restart, and persisted-state recovery.

### Risk Register and Mitigations
| Risk | Impact | Mitigation | Verification |
|---|---|---|---|
| Browser-side full-3D prediction diverges from authority | Visible jitter, incorrect correction, or hard-to-reproduce movement defects | Implement a lightweight custom fixed-step movement module rather than Babylon physics; share movement constants and formulas between server and client; retain acknowledged input history and use deterministic replay fixtures. | Replay the same recorded input sequence on server and client; inject latency/jitter in integration tests and measure correction frequency and magnitude. |
| Snapshot latency causes remote ships to jump | Poor multiplayer readability at 10 Hz updates or under network loss | Buffer remote snapshots for a fixed interpolation delay, tightly bound extrapolation, and show degraded connection state when data becomes stale. Keep simulation and presentation tick rates separately configurable. | Test normal, delayed, reordered, and dropped snapshots; confirm visual interpolation remains smooth and stale data is visibly reported. |
| MessagePack obscures protocol defects | Slower debugging and accidental incompatible clients | Version every envelope, maintain schema/fixture tests, reject unsupported versions with typed errors, and emit decoded diagnostic logs only in development. | Decode recorded fixtures in client/server contract tests; assert unsupported versions and malformed payloads are rejected safely. |
| Station crowds or a slow browser overload realtime delivery | Excess bandwidth, growing memory, or server stalls | Use spatial interest cells and hysteresis; set maximum snapshot size and per-client outbound queue depth; coalesce superseded snapshots and disconnect persistently slow clients. | Multi-client integration test at a shared station; track queue depth, message size, disconnect reason, and tick duration under an intentionally slow receiver. |
| Compressed system size causes client float precision errors | Distant bodies or ships visually drift, shake, or render incorrectly | Set an initial world-unit scale before content is seeded; store authoritative positions as server doubles; use a client-local render origin/rebasing strategy if measurements require it. | Add precision tests at the furthest seeded positions and manually verify render stability after repeated warps. |
| Early item-based fuel expands Phase 1 into full inventory work | Delayed navigation milestone and unnecessary UI complexity | Restrict Phase 1 inventory to one authoritative cargo container, stack operations needed for starter fuel, and transactional warp debit/refund; defer transfer, split/merge UI, refining, and generic inventory interactions to Phase 2. | Fresh-pilot, insufficient-fuel, cancellation, server-failure, restart, and completed-warp tests verify no fuel duplication or loss outside stated rules. |
| Warp state is lost or duplicated across crash/reconnect | Pilots become stranded, duplicate fuel, or arrive inconsistently | Persist route, origin, destination, state, reserved fuel, and authoritative arrival time atomically; resume from server time on reconnect; recover invalid records to the last safe transform and log the event. | Restart the API during each warp phase and reconnect from a new browser session; assert one legal final location and one correct fuel outcome. |
| Route rules are implemented ad hoc | Future routes/gates require rewrites or permit invalid travel | Seed a directed route graph with enabled state, timing, fuel, and arrival transform. Navigation validates the route record, never arbitrary coordinate pairs. | Test missing, disabled, unknown, and valid routes; verify only valid server-defined arrivals occur. |
| Celery introduces unused local complexity | Slower onboarding and more failure modes without Phase 1 benefit | Do not run a Celery worker in Phase 1 Docker Compose. Retain documented integration points and introduce it only with Phase 5 background workloads. | A clean Phase 1 local startup requires only PostgreSQL, Redis, API, and client/static hosting. |
| Authentication/session misuse compromises the vertical slice | Account enumeration, credential exposure, or duplicate active sessions | Use Argon2id, refresh rotation/revocation, secure cookie defaults, generic auth failures, rate limits, correlation IDs, and a documented duplicate-session replacement policy. | Automated tests cover login abuse limits, revoked/expired tokens, refresh reuse, duplicate connections, and unauthenticated WebSocket attempts. |

### Milestone Acceptance Scenario
1. Start the local stack, apply migrations, and seed the authored system.
2. Register two accounts; each receives one pilot and a starter ship at the chosen starter station.
3. Log in through two browser sessions and verify both ships appear in the same nearby space.
4. Fly one ship using forward/reverse, strafe, vertical thrust, and rotation; toggle flight assist and perform a turn-and-burn stop. Verify the other browser sees smooth replicated movement.
5. Modify a browser message to attempt a teleport or excessive velocity. Verify the server rejects/ignores it and logs the event without corrupting the pilot state.
6. Select a known belt or station destination, complete a valid warp, and verify the second player observes departure/arrival state changes.
7. Attempt a warp to an arbitrary/unknown destination and while in an invalid navigation state. Verify the server returns a typed failure without moving the ship.
8. Refresh the browser or reconnect, then restart the API service. Verify the pilot returns to a legal persisted location/state.

**Phase 1 is complete when**: The acceptance scenario succeeds from a clean local setup, all required automated checks pass, no client-supplied transform can become authoritative, and the project has a documented technical baseline for the Phase 2 inventory/mining work.

### Explicitly Deferred From Phase 1
- Docking interaction UI and station services beyond spawning, storage placeholders, and navigation destinations.
- Mining, combat, NPCs, PvE sites, loot, manufacturing, market trading, fitting, consumables, and active skill progression.
- Ship collisions, player targeting, PvP, chat, parties, and social systems.
- Final art, audio production, mobile controls, localization, public account recovery, and external OAuth.
- Distributed simulation ownership, multi-region deployment, and validation at the 500-CCU production target.

### Remaining Design Question
1. Is a developer/admin seed account acceptable for local test automation, in addition to the email/password user flow? If yes, restrict it to non-production environments and make its creation explicit and auditable.

---
