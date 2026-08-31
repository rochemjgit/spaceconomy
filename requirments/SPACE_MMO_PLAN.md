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
- **Background processing**: Celery + Redis (manufacturing timers, node respawns, market matching)
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
**Goal**: A player logs in, enters the one persistent open-world system, sees and pilots their ship with a polished isometric presentation and deliberate turn-and-burn motion.

1. Scaffold the monorepo: `/client` (Babylon.js/Vite/TypeScript), `/server` (FastAPI/Python), and a schema contract location.
2. Configure code quality and local services: Python linting/type checks/tests, TypeScript linting/tests, Docker Compose for PostgreSQL, Redis, API, and static client hosting.
3. Implement account creation/login, password hashing, JWT access/refresh flow, basic player session and logout; defer social OAuth until the core loop is proven.
4. Create initial migrations and models for player/pilot, ship/hull, item definition, inventory/cargo, world system, celestial body, station, point of interest, location/coordinates, navigation route, and transaction-ledger foundations.
5. Seed the handcrafted system blueprint: primary star; three inner rocky planets with one orbital station each; an inner asteroid-belt ring; two gas giants; and an outer asteroid-belt ring. Store all spatial locations and body metadata data-driven for future systems.
6. Define a compressed-realistic coordinate convention, visibility/LOD bands, and navigation distances. Keep the whole system spatially coherent while intentionally shortening orbital radii to a game-session scale.
7. Implement FastAPI WebSocket authentication, connection lifecycle, command routing, outbound event envelopes, and proximity/presence broadcasting.
8. Create the Babylon.js scene: attractive isometric camera controls, starfield/nebula treatment, lighting/bloom, distance-aware celestial-body rendering, placeholder ship/environment assets, HUD shell, and responsive layout.
9. Implement server-authoritative local flight at a fixed simulation rate: position, linear velocity, heading/angular velocity, ship mass, forward/reverse/strafe thrust, turn torque, acceleration limits, inertia, and optional flight-assist braking. Render client-side prediction/reconciliation and interpolation.
10. Implement warp/cruise navigation only between discovered/known server-defined destinations—stations, belts, PvE sites, and future gates. Validate initiation distance, ship state, cooldown/fuel requirements, and arrival server-side; prohibit it during local tactical engagement.

**Verification**: A new player registers at an orbital station, enters the authored system, accelerates, turns, and performs a turn-and-burn stop under server-authoritative flight, warps between an eligible station/belt destination, reconnects to persisted state, and cannot force a client-authoritative position.

---

## Phase 2: Resource Extraction, Items, and Inventory
**Goal**: Mining is a satisfying foundational activity that produces the inputs for every economy loop.

1. Establish item taxonomy and data-driven definitions: raw ore, refined materials, components, ship modules, ammunition/charges, fuel, and consumables. Define stack limits, volume, rarity, and binding/tradability rules.
2. Finish inventory and cargo operations: slot/volume capacity, stack split/merge, transfers between ship cargo, station storage, wrecks, and future trade containers; enforce all mutations server-side and record ledger events.
3. Build the system's handcrafted resource-field composition: accessible baseline ores in inner-belt fields; rare/high-yield ores and hazards in distant outer-belt fields; asteroid sizes/yields, visual variants, availability bands, and controlled server-side respawn/depletion rules.
4. Add mining equipment slots and mining-laser activation: target validation, cycle time, capacitor/energy cost, yield calculation, cargo delivery, depletion broadcasts, and mining visual/audio events.
5. Create an extraction HUD: target details, mining cycle/progress, cargo capacity, yields, local speed/vector state, and clear failure/action feedback.
6. Add station refining that converts ore to materials, including configurable efficiencies and losses. Require docking at one of the three orbital stations; expose station-local storage from the start so future logistical choices remain possible.

**Verification**: Players locate an inner- or outer-belt field, equip and operate a mining laser, fill cargo with ore, navigate or warp to an orbital station, refine the ore, and see inventory persist after reconnecting.

---

## Phase 3: Ship Fitting, Consumables, and Active Skills
**Goal**: Equipment choices materially affect mining and PvE; skills advance through repeated, valid gameplay actions rather than elapsed time.

1. Model ship hulls, fitting slots, power/CPU-style budgets, module compatibility, durability, and base combat/mining statistics.
2. Implement fitting at stations: equip/unequip validation, item movement, stat aggregation, and a client fitting screen that clearly exposes trade-offs.
3. Deliver initial modules: mining lasers and upgrades, propulsion, shields, armor/hull support, weapon families, and utility modules. Use data-driven effects instead of hard-coded module behavior where possible.
4. Implement consumables and charges: ammunition, repair/boost items, mining crystals or charges, cooldowns, stacks, consumption, and buff/debuff duration events.
5. Define active skill categories—such as mining, refining, manufacturing, piloting, weapons, defense, and salvage—and award experience only after server-verified actions complete.
6. Implement a first-pass active-skill formula with diminishing returns, per-action caps/rate limits, level thresholds, and data-driven effect modifiers. Preserve event history so progression can be rebalanced/migrated later.
7. Add skill, fitting, equipment, and consumable UX to the HUD/inventory screens.

**Verification**: Fitting a module changes validated ship performance; charges/consumables are consumed correctly; mining and combat actions award bounded skill XP; higher active skill levels visibly improve their corresponding actions.

---

## Phase 4: PvE Combat and Open-World Sites
**Goal**: PvE is playable both in the shared system and through repeatable instanced encounters; no player-versus-player damage path exists.

1. Implement the server-side fixed-rate combat simulation (initially ~10 Hz): targeting/range checks, cooldowns, projectile/laser/missile resolution, shields, hull, resistances, destruction, and event batching.
2. Create NPC archetypes and simple combat AI state machines: patrol, acquire target, pursue/orbit, attack, flee, and reset. Keep stats, drops, and behavior configuration data-driven.
3. Populate authored open-world PvE sites across the system: beginner patrols near inner-planet stations; contested mining fields in the inner belt; specialised sites around each gas giant; and tougher, resource-rich anomalies in the outer belt. Add escalating difficulty, spawn/reset control, and optional cooperative target scaling.
4. Add instanced PvE site lifecycle: party/solo entry, isolated entity namespace, encounter seed, join/rejoin rules, completion/failure handling, cleanup, and return to the shared system.
5. Add PvE rewards: wrecks, salvage, raw materials/components, module/consumable drops, and server-validated loot ownership windows.
6. Enforce PvE-only combat by rejecting all player-to-player target locks, damage, and hostile effects at the combat-command boundary.
7. Build combat UX: target panel, distance/range cues, health/shield states, module cooldowns/charges, threat/damage feedback, loot interaction, and defeat/repair/respawn flow.

**Verification**: A fitted player clears an open-world NPC site and an instanced encounter, receives loot, consumes ammunition/repairs as applicable, respawns after defeat, and cannot damage or target another player.

---

## Phase 5: Manufacturing, Trade, and System Economy
**Goal**: Mining feeds an equipment-centric player economy inside the single system.

1. Define data-driven recipes and blueprints for components, modules, consumables, ammunition, ship replacements, and refining inputs/outputs.
2. Add manufacturing facilities at the station: input reservation, job queue, recipe duration, completion processing, cancellation rules, output delivery, and capacity limits.
3. Apply active manufacturing/refining skills at server calculation boundaries, including efficiency, speed, and/or quality modifiers selected during balancing.
4. Build an in-system market with buy/sell orders, escrow/reservation, price-time priority matching, sales tax/fees, expiry/cancellation, and an immutable currency/item transaction ledger.
5. Provide NPC vendors for starter equipment and carefully managed material/currency sinks, ensuring new players can begin mining and recovery after ship loss.
6. Deliver modern market/manufacturing UIs: item search/filtering, price history, order forms, manufacturing queue progress, recipe dependencies, and clear fee/volume displays.
7. Add economy telemetry: material creation/destruction, currency sinks/faucets, price and volume metrics, active listings, and job completion rates.

**Verification**: A player mines and refines ore, manufactures a consumable or ship module, lists it for sale, and another player purchases it with fully auditable item/currency transfers.

---

## Phase 6: Multiplayer Operations, Polish, and Beta Readiness
**Goal**: A stable, visually cohesive PvE beta at the target concurrency, without adding quests or PvP.

1. Add social basics needed for cooperative instances: global/system/party chat, friend presence, party formation, invites, and party entry into instances. Defer corporations and territory systems.
2. Add operator tools: account/player lookup, forced relocation, item/currency grants with audit trail, content/spawn toggles, account suspension, and economy dashboards.
3. Harden authoritative controls: input validation, connection/message rate limits, idempotency keys for inventory/economy commands, audit events, and anomaly alerts for impossible movement, loot, or skill gain.
4. Profile and improve API, database, Celery, Redis, WebSocket, and Babylon.js rendering performance; add visual LOD, batching, and degraded-mode UX where required.
5. Create repeatable load and soak tests covering login, movement, mining cycles, combat ticks, market operations, and instance churn at 500 concurrent simulated clients.
6. Establish beta release operations: backups/restore drill, DB migrations/rollback strategy, environment configuration/secrets, logging/metrics/alerts, patch notes, and player feedback intake.

**Verification**: A 500-CCU representative load/soak test remains within established latency/error budgets; player/world/economy state survives restart and restore; a cooperative party completes an instance; no quests, galaxy generation, or PvP code is required to run the beta.

---

## Dependencies and Parallel Work
- Phase 1 blocks all later work.
- In Phase 2, inventory foundations block mining/refining; visual resource work can proceed in parallel with server resource models.
- Phase 3 fitting/charge foundations should precede mining and combat balancing; active-skill event capture should ship with those actions.
- Phase 4 combat simulation blocks NPC/open-world and instance content; open-world site content and instance lifecycle can then proceed in parallel.
- Phase 5 recipes/ledger foundations block manufacturing and market matching; both UI tracks can proceed once contracts stabilize.
- Phase 6 begins observability/hardening as soon as Phase 1 exists, while full scale testing waits for the core loops.

## Scope Boundaries
### Included
- One fixed, hand-authored star system
- Shared open world plus instanced PvE sites
- Server-authoritative movement, extraction, equipment, progression, combat, inventory, crafting, and market economy
- Browser client with a modern WebGL isometric visual style
- Active use-based skills

### Deliberately Deferred
- Additional systems, procedural generation, system-to-system travel, and galaxy map
- PvP, security-zone rules, corps/alliances, territory warfare
- Quests, mission boards, narrative quest chains, and NPC quest givers
- Passive/time-based skill training
- Native/desktop client
