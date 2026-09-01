## Phase 4: PvE Combat And Open-World Sites

**Goal**: Deliver server-authoritative, target-lock-and-module PvE across the shared authored star system. Players find physical combat locations, engage NPCs, recover loot, and face cargo loss plus ship destruction on defeat. Player-versus-player targeting, damage, and hostile effects do not exist.

## Phase Boundary

Phase IV consumes Phase I's fixed-rate authoritative flight, proximity events, server-defined destinations, and persistent player locations. It consumes Phase II's cargo, station storage, wreck access rules, inventory ledger, and mining-field locations. It consumes Phase III's universal hardpoints/core-system slots, derived statistics, module lifecycles, capacitor, charges, active skills, secure loss resolution, and destruction contract.

The initial release contains shared open-world PvE only. Every site is a physical location in the single authored system: patrol areas near the three orbital stations, contested inner-belt fields, specialised gas-giant sites, and outer-belt anomalies. Instances are intentionally a placeholder: their entry locations, discovery, rewards, and combat contracts must remain compatible with a later isolated encounter implementation, but no procedural generation, instance lifecycle, party system, or instance content is included in this phase.

Phase IV does not add PvP, security zones, quests, mission boards, system-to-system travel, manufacturing, market trading, insurance, or station repair services.

## Player Loop

1. A pilot fits a ship at an orbital station with combat-capable modules and charges under Phase III rules, then travels to a discovered physical PvE site.
2. The client receives nearby NPCs and site state through proximity events. The pilot selects an NPC and sends a target-lock intent.
3. The server validates that the target is an active NPC in the same shared-world namespace and within the ship's derived sensor range. On success it creates an authoritative target lock.
4. The pilot activates fitted modules against the locked NPC. The server applies the Phase III global activation lockout, module cooldown, capacitor, loaded-charge, range, tracking, and ship-state rules before resolving an effect.
5. NPCs acquire, pursue, orbit, attack, flee, or reset according to their data-driven archetype and current encounter state. A destroyed NPC produces a wreck with server-resolved loot.
6. The pilot opens a wreck only when in permitted interaction range, then transfers valid loot into available cargo under Phase II inventory rules.
7. On player ship destruction, Phase III resolves every ship-contained item into dropped wreck loot or permanent destruction. The pilot respawns at their configured orbital station in a replacement starter ship state; ship purchase, insurance, and station repairs follow in Phase V.

## Combat Model

### Targeting And Eligibility

Combat is lock-and-activate rather than manual aiming. A target lock is an authoritative record containing the locking ship, target entity, acquisition timestamp, target identity/version, and lock state. Clients may request acquisition, release, or inspect locks, but never create a usable combat target locally.

Initial valid hostile targets are NPC entities only. At the combat-command boundary, reject attempts to lock a player ship, player wreck, station, celestial body, neutral world object, missing entity, despawned entity, or an entity outside the shared-world namespace. A valid lock also requires that the player's ship is alive, undocked, not warping, not in a respawn transition, and inside derived sensor range. A lock breaks when either entity despawns, is destroyed, leaves sensor range for a configured grace period, enters an incompatible state, or the player releases it.

Modules may require a target lock, may operate without one, or may target only the owning ship. A hostile module definition must declare `npc_only` as its allowed target class. The combat effect engine rejects any hostile effect whose resolved target is not an active NPC even if an invalid target-lock record was somehow presented.

### Simulation Ownership And Tick

The combat service runs server-side at a fixed initial rate of 10 Hz. It operates on authoritative flight snapshots from the movement simulation and uses a monotonic server tick number plus simulation time. The client renders interpolated position, health, module, and impact events but does not decide range, hit, damage, cooldown completion, destruction, loot, or AI transitions.

For each tick, process entities in stable entity-ID order:

1. Apply expiration, destruction cleanup, lock-break, capacitor/shield recharge, repair effects, and scheduled respawn actions due at the current tick.
2. Advance each NPC AI state and produce validated AI intents.
3. Accept at most one queued player or NPC module activation per entity according to the Phase III global activation lockout and module state.
4. Validate activation prerequisites against the current authoritative snapshot, deduct capacitor and charges exactly once, and create an immediate effect or scheduled projectile/missile entity.
5. Resolve scheduled effects, projectile/missile impacts, damage, repairs, and status effects in deterministic order.
6. Detect destruction, execute the applicable NPC or player destruction transaction, then batch outbound state changes and combat events.

All temporary combat entities carry a stable ID, spawn tick, owner/source ID, definition/version, position/velocity where applicable, expiry tick, and source event ID. Timers and scheduled effects use simulation ticks rather than browser clocks.

### Weapon Resolution

Initial weapons use data-driven module definitions from Phase III and resolve through three delivery models:

| Delivery model | Initial role | Resolution |
| --- | --- | --- |
| Beam/laser | Reliable short-to-medium range energy damage | Validates lock and range at activation or each configured cycle; applies damage immediately on a successful resolution tick. |
| Projectile | Ammunition-backed direct-fire damage | Creates a server-owned projectile with speed, lifetime, collision radius, and damage payload; impact requires the target still to be valid. |
| Missile | Longer-range ammunition-backed damage | Creates a server-owned guided entity with speed, turn rate, flight time, and explosion profile; damage scales from configured target-size and velocity factors. |

A weapon definition declares its delivery model, damage packet(s), optimal and maximum range, tracking or guidance data, cycle time, capacitor cost, charge requirements, and effect version. A module activation starts only after Phase III validates the global lockout, individual cooldown, durability, loaded charge, and capacitor. Rejected attempts consume no charge or capacitor and create no projectile, missile, or damage event.

For beam and projectile weapons, the server evaluates a deterministic hit chance from weapon tracking, target angular velocity relative to the attacker, target signature, range, and definition data. The random sample is generated from a cryptographically secure server source at effect creation and persisted with a combat event ID, definition version, and resolved outcome. The result is recorded once and never rerolled by reconnecting or retransmitting a command. Initial balancing may set hit chance to guaranteed for early NPCs while retaining the same contract.

### Damage, Defense, And Destruction

Damage consists of typed packets such as kinetic, thermal, electromagnetic, and explosive. Each packet has a non-negative raw value and source metadata. At resolution, calculate damage after the target's current resistance for that type:

$$
D_{resolved} = \max(0, D_{raw} \times (1 - R_{type}))
$$

where $R_{type}$ is clamped to the configured safe range. Apply resolved damage to shields first, then armor, then hull. Shield regeneration and active repairs use authoritative Phase III module and timed-effect state. A ship is destroyed when hull reaches zero; health never becomes negative.

Phase III-derived hull, shield, armor, resistance, repair, capacitor, weapon, sensor, thrust, and movement statistics are the only inputs to combat calculations. Skill modifiers apply at their declared calculation boundary: weapon modifiers when an attack resolves, defense modifiers when damage or repair resolves, and piloting modifiers through the movement-derived state already supplied to combat.

NPC destruction creates a wreck and resolves its configured drop table. Player destruction delegates all item outcomes to the Phase III loss resolver: fitted modules, loaded charges, cargo, and ship-contained consumables independently drop or are destroyed according to their versioned loss profiles. The player wreck retains Phase II's five-minute owner-only period, ten-minute public period, and 15-minute expiry. NPC wreck access is governed by the loot-ownership rules below. Destroyed players respawn at their configured orbital station and cannot issue flight, targeting, or module commands until the respawn state completes.

## NPCs And AI

### Archetypes

Begin with general-purpose NPC archetypes rather than a large fixed enemy roster. Archetypes are data definitions that combine hull statistics, module fit, behavior profile, resistance profile, signature, orbit preferences, reward profile, and difficulty band. Content can grow by adding definitions rather than code branches.

| Archetype | Behavior focus | Initial placement |
| --- | --- | --- |
| Scout | Fast patrol, low durability, close-range pressure | Beginner station patrols and inner belt |
| Raider | General combat opponent with balanced weapons and defense | Contested inner-belt fields |
| Sentinel | Durable area defender with longer engagement range | Gas-giant specialised sites |
| Harrier | Fast high-pressure attacker that may disengage at low health | Gas-giant sites and outer belt |
| Anomaly guardian | High durability, stronger drops, cooperative pressure | Outer-belt anomalies |

Exact statistics, module fits, spawn compositions, drop rates, and names are content data. Each NPC instance snapshots the archetype, behavior, loot-table, and definition versions used for it so later balance changes do not alter an already active entity.

### AI State Machine

Each NPC runs one authoritative state machine with these initial states: `patrol`, `acquire`, `pursue`, `orbit`, `attack`, `flee`, `return`, and `reset`.

- `patrol`: Follow a deterministic route or hold point inside the site's configured boundary while searching for eligible player ships.
- `acquire`: Choose an eligible player target using data-driven threat and range rules, then request an NPC target lock.
- `pursue`: Use Phase I flight controls to close toward optimal range, respecting acceleration and turn limits.
- `orbit`: Maintain a configured radial band and relative velocity around the current target where flight constraints permit.
- `attack`: Activate available NPC modules when range, lock, capacitor, cooldown, and target rules pass.
- `flee`: Move toward a configured retreat point when health, threat, or site rules require it. Fleeing NPCs may reset but do not warp away unless a future definition explicitly adds that behavior.
- `return`: Travel back to the site's anchor after losing a target or exceeding the leash boundary.
- `reset`: Clear threat and locks, restore configured combat state, and resume patrol after a reset delay.

AI emits intents into the same validation path used by player modules and movement. NPCs never mutate health, position, target locks, loot, or cooldowns directly. An NPC's target selection may consider only eligible player ships; it must never choose a player as a legal target for a player-issued hostile effect.

## Authored Open-World Sites

### Site Definitions And Locations

A PvE site is a persistent, data-driven physical location in the one authored system. It references a Phase I point of interest, coordinates, radius, anchor body or field, discovery state, difficulty band, spawn policy, NPC groups, leash/reset settings, reward profile, and content version. Sites use the shared-world entity namespace and proximity broadcaster; a pilot can see other pilots at the same site but cannot target or damage them.

Seed these location categories from the high-level system blueprint:

| Region | Initial site role | Difficulty and rewards |
| --- | --- | --- |
| Three orbital-station approaches | Clearly signposted beginner patrol locations | Low-risk Scout groups, starter salvage, basic materials, and introductory weapon/defense XP. |
| Inner asteroid-belt fields | Contested mining protection and opportunistic combat | Raider groups that create meaningful but manageable danger beside baseline ore. |
| First gas giant | Defensive industrial or ring-side sites | Sentinel groups, specialised raw materials, and mixed module drops. |
| Second gas giant | High-mobility pursuit sites | Harrier groups, more demanding capacitor and positioning pressure, and rarer components. |
| Outer asteroid-belt ring | Resource-rich anomaly locations | Guardian groups, highest initial PvE pressure, cooperative-scale option, and valuable loot. |

Sites are destinations eligible for Phase I warp/cruise only when the player has discovered or otherwise knows the site. The server validates that the destination is available, the ship is not under tactical engagement, and normal warp requirements pass. Arrival places the ship at a safe, configured entry coordinate outside collision and immediate weapon range rather than directly inside an NPC group.

### Spawn, Reset, And Cooperative Scaling

Each site has one of these initial spawn policies: `persistent_patrol`, `wave`, or `cooldown_respawn`. A persistent patrol keeps a configured group active; a wave begins when eligible players enter the site boundary; a cooldown respawn schedules the group only after prior completion or reset. Spawn decisions run server-side, are idempotent by site-cycle ID, and respect configured minimum/maximum active entity caps.

NPCs have an anchor, leash distance, reset delay, and reset policy. When a player leaves the site, exceeds the leash boundary, dies, or becomes otherwise ineligible, NPCs clear the target and return/reset rather than pursuing indefinitely through the system. A site cannot spawn an NPC inside a station exclusion zone, another active entity's collision radius, or a player arrival safe zone.

Outer-belt anomaly sites may enable cooperative scaling. At cycle start, the server snapshots the count of eligible player ships inside the participation boundary and chooses a predefined composition or stat modifier tier. Scaling never reacts every tick, never uses client-reported party size, and must cap at a configured maximum. The selected tier appears in the site-state event and audit record.

## Rewards, Wrecks, And Recovery

NPC loot uses versioned, data-driven tables with weighted entries, quantity ranges, eligibility requirements, and optional guaranteed salvage/material outcomes. Initial loot categories are salvage, raw materials, components, modules, consumables, and charges. Rolls use secure server randomness and record table/version, source NPC, event ID, and resolved entries. The client cannot influence a loot table, its random sample, or final item quantities.

On NPC destruction, the server calculates contribution from valid combat actions and selects an owner for a five-minute owner-only loot window. The default owner is the player with highest valid damage contribution; ties resolve deterministically by earliest qualifying contribution then entity ID. A later party system may replace this policy, but it is not required now. After five minutes, NPC wreck contents become public for ten minutes and expire at 15 minutes, matching the shared Phase II temporary-wreck lifecycle.

Wreck opening and loot transfers require the wreck to exist, be in interaction range, be accessible to the pilot at the current server time, and contain the requested item quantity. The server atomically checks cargo capacity and changes wreck/cargo inventory while writing immutable item-ledger entries. A destroyed player may recover their own dropped cargo and equipment under the same owner/public/expiry rules, provided another pilot has not recovered it first.

## Client Experience

The HUD extends Phase III's module rack without replacing it. It includes a target panel with locked NPC identity, archetype, distance, target-lock state, shield/armor/hull bars, range indicators, and clear lock failure reasons. Module buttons show compatible locked-target requirement, global activation lockout, individual cooldown, loaded charges, capacitor state, and active/cycling/reload states from authoritative events.

Combat presentation uses client-side interpolation and local effects for beam paths, projectile trails, missile paths, impacts, damage feedback, shield hits, and destruction. Visual effects are cosmetic and must reconcile to server combat events. Health, lock, damage, cooldown, loot, and destruction UI always display the latest authoritative sequence/version and discard stale updates.

The world view differentiates PvE-site difficulty, discovery, activity, and physical boundaries without obscuring navigation. Nearby site UI exposes the site's name, region, danger band, current cycle state, participating-NPC count, and cooperative-scaling tier when active. The client does not promise a site is safe, complete, or lootable until the server event confirms it.

Wreck interaction shows only authoritative dropped items, ownership timing, expiry timing, cargo capacity, and transfer failures. On player defeat, a destruction summary distinguishes recovered-in-wreck items from permanently destroyed items, identifies the respawn station, and disables combat controls until the ship is live again.

## Server Contracts And Persistence

Use typed WebSocket contracts for `request_target_lock`, `release_target_lock`, `activate_module`, `cancel_module`, `inspect_combat_target`, `inspect_site`, `open_wreck`, `transfer_wreck_item`, and `request_destruction_summary`. Existing Phase III module activation contracts may be extended rather than duplicated. Every mutable player request carries an idempotency key and returns either an accepted event sequence or a stable validation error code.

Authoritative outbound envelopes include target-lock changes, target snapshots, NPC spawn/despawn, site-cycle changes, module activation/cooldown, projectile/missile creation and impact, damage/repair batches, health snapshots, AI-state changes where relevant for presentation, wreck creation/access/expiry, loot transfer results, player destruction, and respawn completion. Events include entity IDs, simulation tick or timestamp, definition versions, and monotonically increasing entity-state versions.

Persist PostgreSQL models for NPC archetype/version, behavior profile/version, PvE site/version, site cycle, spawn group, NPC instance, AI state, target lock, threat/contribution record, combat event, scheduled effect/projectile/missile state, health state, damage/repair result, loot table/version, loot resolution, wreck ownership window, and destruction/respawn record. Reuse Phase II inventory/wreck/item-ledger records and Phase III module, skill, loss-profile, and destruction-resolution records.

Redis may cache active combat snapshots, spatial buckets, scheduled-tick work, nearby event fan-out, and rate-limit counters. PostgreSQL remains authoritative for accepted commands, damage outcomes, destruction, loot, item movement, NPC/site lifecycle transitions, and respawn state. After reconnecting, clients fetch nearby authoritative entity/site snapshots and their current combat/module/destruction state before applying live events.

## Validation And Abuse Controls

- Reject every player-issued hostile lock, damage, repair-to-hostile, debuff, projectile, missile, or effect command whose target is not an active NPC. Apply the same NPC-only rule inside the effect resolver so no alternate command path creates PvP damage.
- Validate authentication, active alive ship, shared-world namespace, target existence/class, sensor range, lock state, module target policy, weapon range, cooldown, global activation lockout, capacitor, charge state, ship state, and idempotency key at the command boundary.
- Treat client inputs as intent only. Never accept client positions, velocities, target validity, range, hit rolls, damage values, health, resistances, capacitor, charge counts, cooldowns, AI state, loot results, contribution, site state, or random outcomes.
- Serialize or lock mutations affecting the same ship, NPC, wreck, site cycle, inventory stack, or destruction event. Repeated network messages return their original result and must never fire a second weapon, apply duplicate damage, create duplicate loot, or reroll destruction.
- Bound all combat inputs and content definitions: non-negative damage/repair, maximum entity/projectile counts, valid damage types, safe resistance ranges, positive tick/lifetime values, valid site radii, NPC leash limits, and drop-table weights/quantity ranges.
- Rate-limit target lock, module activation, wreck interaction, site inspection, and combat event requests. Record audit events for invalid targeting, impossible position/range, duplicate requests, invalid resource states, failed loot attempts, despawn races, and all combat/loot RNG outcomes.

## Future Instance Compatibility Placeholder

Do not implement instances in this phase. Preserve an extension path by making `world_scope_id` explicit on combat entities, target locks, site cycles, scheduled effects, wrecks, and outbound events. Open-world entities use the persistent system scope. A future instance can allocate an isolated scope, entry/rejoin policy, encounter seed, cleanup process, and return coordinate without changing combat, target-lock, NPC, loot, or destruction authority rules.

Future procedural or authored encounter generation must produce validated site/encounter definitions using the same archetype, spawn-group, loot-table, and combat contracts. It must not execute arbitrary behavior scripts or bypass entity caps, target restrictions, secure RNG, item-ledger, or loss-resolution rules.

## Implementation Order

1. Add versioned combat, NPC, site, target-lock, contribution, loot, wreck-ownership, destruction, and respawn models/migrations; add `world_scope_id` to the new combat-facing records.
2. Seed initial NPC archetypes, behavior profiles, weapon/defense module definitions, loot tables, and the station, inner-belt, gas-giant, and outer-belt site definitions.
3. Implement the 10 Hz combat tick, typed NPC-only target locks, authoritative health/defense state, deterministic event ordering, and batched nearby events.
4. Implement beam, projectile, and missile resolution using Phase III lifecycle, capacitor, charge, cooldown, derived-stat, and secure-RNG contracts.
5. Implement the data-driven NPC state machine, threat/contribution tracking, leash/reset behavior, spawn policies, and optional outer-belt cooperative scale tiers.
6. Implement NPC destruction, loot-table resolution, wreck ownership/public/expiry windows, atomic loot transfer, player destruction integration, and station respawn.
7. Deliver target, combat, site, wreck, and defeat UX with interpolation/reconciliation, then validate reconnect and stale-event behavior.
8. Add load/soak coverage for active combat entities and document the instance extension boundary without implementing it.

## Acceptance Tests

- A pilot can travel to a discovered physical station patrol, inner-belt field, gas-giant site, or outer-belt anomaly through ordinary movement or eligible server-defined warp; arrival uses a safe entry position and does not create an instance.
- A player can lock and activate hostile modules only against a live NPC in sensor range. Attempts to lock or harm another player, a station, a wreck, or any non-NPC entity are rejected at both the command boundary and the effect-resolution boundary.
- Module activation applies the Phase III global lockout, individual cooldown, capacitor, charge, durability, and target/range rules exactly once. Duplicate or rejected requests consume no additional resource and create no duplicate combat entity or damage event.
- Beam, projectile, and missile modules resolve from server-owned state. Reconnects, retries, late packets, and client-supplied hit/damage/position values cannot change the recorded outcome.
- Damage uses the target's authoritative shield, armor, hull, and resistance state; repairs and destruction resolve in stable tick order; no health becomes negative or exceeds its valid maximum.
- Each seeded NPC archetype transitions only through its defined authoritative AI states, respects site leash/reset rules, and cannot mutate combat state outside the shared combat validation path.
- Site spawn, reset, and cooperative scaling are controlled by the server, obey entity caps and safe zones, and persist enough cycle/version data to recover correctly after reconnect or restart.
- Destroying an NPC creates a correctly owned loot wreck; the owner has five minutes of exclusive access, the wreck becomes public for ten additional minutes, and it expires at 15 minutes. Loot transfers are atomic, capacity-checked, and ledgered.
- Destroying a player delegates every cargo, fitted-module, loaded-charge, and consumable outcome to Phase III loss resolution. The player respawns at the configured orbital station, cannot act while destroyed, and can recover dropped items only while their wreck remains accessible.
- Combat XP is emitted only after valid server-resolved weapon, defense, piloting, or salvage actions and is processed by Phase III's bounded active-skill progression service.
- All active combat entities, locks, scheduled effects, wrecks, and events carry a world scope. The shared-world implementation requires no party, instance lifecycle, or procedural encounter generator, while retaining an isolated-scope extension path.