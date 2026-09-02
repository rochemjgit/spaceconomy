## Phase 3: Ship Fitting, Consumables, and Active Skills

**Goal**: Equipment choices materially affect mining and the Phase IV PvE combat loop. Pilots progress through repeated, server-verified gameplay actions rather than elapsed time, while ship loss produces a meaningful equipment sink.

## Phase Boundary

Phase III extends Phase II's authoritative inventory, station-local storage, docking, capacitor-backed mining cycles, scanning progression events, temporary wrecks, and item ledger. It replaces the Phase II mining-only fit contract with a full data-driven ship fitting model and makes the existing wreck process resolve every ship-contained item through loss RNG.

### Repository Readiness

Implementation must not present presentation-only client state or development fixtures as Phase III authority. Before a player-facing Phase III endpoint is enabled, Phase II must provide authenticated pilot identity, persisted active-ship ownership, authoritative docked-station state, station-local inventory transactions, item-ledger writes, and wreck ownership/access rules. Until those prerequisites exist, Phase III work is limited to isolated domain definitions and deterministic tests; fit, activation, consumption, progression, and loss commands must not mutate client-provided state.

This phase provides the hull, module, charge, consumable, capacitor, skill, and event contracts that Phase IV combat consumes. It does not implement NPCs, player damage, targeting, projectile resolution, combat sites, salvage gameplay, manufacturing, market trading, or a player-versus-player damage path. Phase V consumes the progression event history and applies refining/manufacturing modifiers at their respective calculation boundaries.

## Player Loops

### Fitting And Preparation

1. While docked at a specific orbital station, the pilot opens the fitting screen for their active ship.
2. The pilot moves modules from that station's local storage into vacant universal hardpoints or core-system slots, and moves compatible charges into fitted modules that accept them.
3. The server validates ownership, docking, slot availability, CPU, powergrid, and operational state. It calculates the resulting ship statistics and returns both the accepted fitting state and any blocked trade-offs.
4. The pilot can save an optional named fitting template containing only item-definition and slot-layout references. Applying a template still requires the exact locally stored items and full server validation.
5. The pilot undocks with the fitted ship, uses capacitor-backed modules for mining or later combat, and returns to a station to change equipment.

### Consumables And Loss

1. The pilot loads ammunition, mining charges, or crystals into a compatible fitted module while docked, or reloads in space only when that module's data permits it.
2. The pilot activates a consumable or module. The server validates the global activation lockout, module cooldown, capacitor, charges, target/state requirements, and applies the resolved effects.
3. On valid completion or activation, the server consumes the designated charge or consumable stack, starts relevant cooldowns, and publishes buff/debuff or module-state events.
4. When a ship is destroyed in Phase IV, the server independently resolves every fitted module, loaded charge, cargo stack, and active consumable effect through configured RNG. Each item or stack portion either becomes wreck loot or is permanently destroyed.
5. The resulting wreck uses Phase II's five-minute owner-only access, ten-minute public access, and 15-minute expiry. The pilot respawns at the configured station and must acquire or fit a replacement ship.

### Active Skills

1. A pilot completes a valid action, such as a mining cycle, asteroid scan, refinery completion, manufactured job contribution, distance-flown piloting action, weapon hit, damage mitigation, or salvaging action.
2. The owning server subsystem emits an immutable action-completion event only after it has completed its authoritative inventory, world, or combat mutation.
3. The progression service determines the applicable skill, action category cap, anti-repeat rate limit, current-level multiplier, and any data-driven modifiers, then records an awarded, reduced, or rejected XP result.
4. On crossing a threshold, the service raises the skill level and publishes a skill-update event. The action's corresponding server calculation begins using the new modifier on subsequent valid actions.

## Design Principles

- The server exclusively validates fits, derives ship statistics, activates modules, consumes charges, resolves item-loss RNG, and awards XP. Clients present intents and authoritative results only.
- Any ship can equip any module type in any universal hardpoint or core-system slot. Hull differentiation comes from slot counts, CPU/powergrid capacity, base statistics, cargo, capacitor, durability, and hardpoint count, not category-locked fitting.
- Fitting trade-offs must remain legible. More powerful modules consume finite CPU and powergrid, active modules draw capacitor, and every activation shares a small global activation/reactivation lockout in addition to its own cooldown.
- Effects are data, not module-specific server branches. A module definition describes its modifiers, activation behavior, targets, charge rules, and effect payload; an effect engine evaluates those definitions.
- Charges and consumables are item stacks. Consumption, reloading, buffs, cooldowns, and expiry are authoritative state changes with inventory and event history.
- Active skill XP comes only from completed, valid actions. It never accrues while offline, idling, moving a client-side timer, or repeatedly failing an action.
- Skill progression follows a logarithmic long-tail curve: early levels are reachable through normal play; each later level requires materially more valid activity for a smaller marginal improvement.
- Ship destruction is an intentional material sink. Item survival and loss are independently randomized from server-owned seeds and data-driven drop/destruction probabilities; clients cannot predict or supply outcomes.
- RNG uses a cryptographically secure server source and writes the resolved probability table/version and outcome to the audit ledger, enabling investigation and future balance migration without exposing future rolls.

## Hulls, Slots, And Statistics

### Initial Hull Roster

Seed three player-acquirable hull definitions. Exact values remain balancing data, but their role and trade-off profile are fixed.

| Hull | Intended role | Relative profile |
| --- | --- | --- |
| Starter miner | Accessible extraction and scanning | Strong cargo and mining-oriented base stats; lower defense and fitting budget |
| Combat frigate | Mobile Phase IV PvE | Strong maneuverability and defense; lower cargo; balanced fitting budget |
| Generalist hauler | Logistics and flexible builds | Highest cargo and broad fitting capacity; slowest movement and weaker base defense |

A hull definition includes a stable ID, display metadata, category, mass, collision size, cargo slots/volume, hull durability, shield capacity/recharge, armor value, capacitor capacity/recharge, base CPU, base powergrid, universal hardpoint count, core-system slot count, movement attributes, sensor attributes, and versioned base-stat payload. It also defines insurance/replacement data for the later economy, but this phase does not implement purchase or payout flows.

### Slot Model And Compatibility

Each active ship exposes two fit locations:

| Location | Purpose | Rules |
| --- | --- | --- |
| Universal hardpoint | Active or passive equipment such as mining lasers, weapons, propulsion, shield, armor/hull, or utility modules | Any module may be fitted; availability is limited only by the slot count and aggregate validation |
| Core-system slot | Persistent ship systems such as reactors, capacitor banks, sensor suites, cargo expanders, or defensive support | Any core-system module may be fitted; availability is limited only by the slot count and aggregate validation |

Module category does not lock a slot or hull. A mining-heavy combat frigate and a weapon-equipped hauler are valid builds when they satisfy resources and operational rules. Definitions may declare a preferred location for UI sorting, but it is advisory and must never become a compatibility rejection.

A fitted-item record references its ship, slot location/index, immutable item instance or stack identity, definition/version, fitted timestamp, current durability, loaded-charge state, cooldown state, and active-effect state. One item occupies one slot. Charges are not separate fitted modules and remain linked to their host module's charge bay.

### Derived Statistics

Base hull statistics, fitted module modifiers, active effects, charges, consumables, and skill modifiers produce a versioned derived-stat snapshot. The server recomputes it transactionally whenever fit state, durability, charge state, effect state, or relevant skill levels change.

Each effect definition targets a named statistic and applies one of: flat addition, percentage addition, multiplicative factor, cap, floor, resistance adjustment, or behavior flag. Calculation order is deterministic and data-driven: base hull value; flat modifiers; additive percentages; multiplicative factors; caps/floors. Invalid values, non-finite results, or values outside each statistic's configured safety range reject the mutation and emit an audit event.

Core initial statistics include CPU used/available, powergrid used/available, cargo slots/volume, mass, thrust, turn rate, maximum speed, capacitor capacity/recharge, shield capacity/recharge, armor, hull durability, shield/armor/hull resistances, mining yield/range/cycle time, weapon range/damage/cycle time, sensor range, and repair effectiveness. Phase IV selects the combat subset; Phase II mining recalculates from the shared snapshot rather than retaining special-case module logic.

## Fitting Operations

Fitting and unfit operations require a validated docked state at the station containing the source or destination item. The server atomically verifies pilot ownership, active-ship ownership, item availability, station locality, slot vacancy, module item state, CPU/powergrid budget, cargo/storage capacity for removal, and idempotency key. It updates the inventory location, fit records, derived stats, and immutable item ledger in one transaction.

A module may fit any location type it declares valid. Initial active/passive equipment modules declare `universal_hardpoint`; initial core systems declare `core_system`. This is a location constraint, not a role, size, hull, weapon-family, or mining-family restriction. A future additional location type can be added through definitions and migration without changing existing compatibility policy.

A fit that exceeds CPU or powergrid is rejected. A fit may leave capacitor insufficient for sustained activation, but the fitting screen must predict its capacitor draw and the module will fail activation when current capacitor is insufficient. Modules at zero durability are visible but not operational and cannot be newly fitted until repaired by a future station-repair service or valid repair effect.

## Module Families And Effects

Deliver initial definitions for these families. Exact modules, tiers, values, rarity, craft inputs, and drop tables are balancing content.

| Family | Initial effects | Charge behavior |
| --- | --- | --- |
| Mining lasers | Mining range, cycle duration, yield, capacitor cost | Optional mining crystal or charge; consumption/decay is definition-driven |
| Mining upgrades | Yield, range, cycle, cargo, scan, or capacitor modifiers | None initially |
| Propulsion | Thrust, maximum speed, turn rate, temporary maneuver boosts | None initially |
| Shield systems | Shield capacity, recharge, resistances, active shield repair | Active repair may use repair charges if configured |
| Armor and hull support | Armor/hull capacity, resistances, passive or active repair | Active repair may use repair charges if configured |
| Weapon systems | Phase IV range, damage, cycle, tracking, and capacitor use | Ammunition or other weapon charge required when declared |
| Utility systems | Sensor, capacitor, cargo, scan, resistance, or tactical support modifiers | Optional charge behavior per definition |
| Core systems | CPU, powergrid, capacitor, cargo, sensor, or defensive base modifiers | None initially |

A module definition contains stable ID/version, display data, family, fit location, CPU and powergrid demand, durability maximum, passive effects, optional activation definition, targeting/state prerequisites, global-lockout participation, cooldown policy, capacitor cost, charge-bay capacity, accepted charge tags, reload policy, and failure codes. It cannot embed executable scripts. Effect definitions are validated content schemas interpreted by a shared server effect engine.

## Capacitor, Cooldowns, Charges, And Consumables

Capacitor is an authoritative resource. It has a hull-derived maximum, current amount, recharge behavior, and configurable safety bounds. Module activation requires sufficient current capacitor at the resolution point. The server deducts cost exactly once for an accepted activation; it cannot be refunded by reconnecting, replaying a request, or racing multiple commands.

All module activations use a small global activation/reactivation lockout, initially configurable between 250 and 500 milliseconds. The lockout begins only after an accepted activation. Individual modules may also impose their own cooldown or cycle time. Long-running modules, including mining lasers, expose lifecycle states such as `idle`, `activating`, `active`, `cycling`, `reloading`, `cooldown`, `disabled`, and `broken`.

A charge definition includes accepted tags, stack limit, volume, effect payload, charge quantity consumed per activation/cycle, optional durability loss, reload duration, and whether partial loads are allowed. Loading and unloading at a station use atomic inventory moves. In-space reloads are permitted only where a module definition says so and are interrupted by invalid ship state, destruction, or an authoritative action that the module declares incompatible.

A consumable definition includes a use context, stack use quantity, cooldown group, cooldown duration, capacitor interaction if any, target/state requirements, and one or more timed or immediate effects. On use, the server reserves and consumes the stack quantity, applies the effect, persists an effect instance with start/end timestamps and source data version, and emits state-change events. Expiration removes the effect exactly once. Overlap/refresh/replace rules are data-driven per effect group.

## Destruction And Item-Loss Resolution

When Phase IV confirms ship destruction, it passes the authoritative ship ID, location, destruction event ID, owner, and ordered contained-item snapshot to the loss resolver. The resolver processes every eligible fitted module, loaded charge stack, cargo stack, and unexpired consumable item independently. Station storage, refinery reservations, and items already in a remote container are never part of the ship-loss roll.

Each applicable item definition declares a loss profile with a probability to drop, probability to be destroyed, optional stack-resolution mode, and loss-profile version. The probabilities must sum to 100 percent. Initial stack modes are `all_or_nothing` and `per_unit`; the latter rolls every unit in a bounded batch and records aggregate counts. The loss resolver uses the assigned profile, secure server RNG, and destruction event ID to produce one of these final outcomes:

| Outcome | Result |
| --- | --- |
| Dropped | The item or resolved stack portion moves into the newly created wreck and can be recovered under Phase II wreck access rules |
| Destroyed | The item or resolved stack portion is removed permanently and an item-destruction ledger event records it |

The transaction creates the wreck, applies every resolved move/destruction, removes the active ship, clears active effects, writes loss/audit/item-ledger events, and emits a single destruction result sequence. It must be idempotent by destruction event ID. A retry returns the same recorded outcomes and must never reroll or duplicate loot.

## Active Skills And Progression

### Skill Taxonomy

Create data-driven definitions for mining, scanning, refining, manufacturing, piloting, weapons, defense, and salvage. Scanning continues the Phase II behavior under the shared progression service. Refining, manufacturing, weapons, defense, and salvage define their events and modifiers now, while the actions that emit some of them arrive in Phases IV and V.

Each skill definition includes stable ID/version, display metadata, eligible action types, level threshold curve, maximum level, per-action XP cap, rolling rate-limit window, diminishing-return configuration, and allowed stat/effect modifiers. Skill effects must map to an explicit server calculation boundary; for example, mining yield resolves after a completed mining cycle, defense mitigation resolves during future damage resolution, and refining efficiency resolves when a refinery job is created or completed according to its configured policy.

### XP Formula And Limits

For a valid action, calculate awarded XP as:

$$
XP_{awarded} = \min(XP_{base} \times M_{action} \times M_{skill} \times M_{diminishing}, XP_{actionCap}, XP_{rateRemaining})
$$

where $XP_{base}$ is action-definition data, $M_{action}$ reflects authoritative action quality or difficulty, $M_{skill}$ is a configurable current-level multiplier, $M_{diminishing}$ decreases as the pilot repeats the same action context, $XP_{actionCap}$ bounds one completion, and $XP_{rateRemaining}$ is the remaining allowance inside the rolling rate-limit window. Invalid, interrupted, duplicate, or rate-exhausted actions award zero XP but retain a rejected or capped progression event.

Use a logarithmic long-tail threshold curve. The default data shape is:

$$
XP_{threshold}(L) = \lceil A \times \ln(1 + B \times L) \times L^C \rceil
$$

where $A$, $B$, and $C$ are versioned balancing constants, $L$ is the target level, and the cumulative thresholds strictly increase. The exact constants, level cap, rate windows, and modifier magnitudes are content data and may be rebalanced. A migration/recalculation service must be able to replay historical progression events against a new curve without losing the original event records.

Diminishing returns key by pilot, skill, action type, and a configurable context discriminator such as asteroid instance, field, module family, enemy archetype, or job recipe. The discriminator prevents one repeated trivial action from advancing a skill indefinitely while preserving ordinary variety in a play session. Rate limits are enforced server-side and are not a passive daily XP grant.

### Progression Event History

Persist an immutable action-completion event before deriving XP, then persist a linked skill-progression event. Event data includes pilot, skill, action type, source entity/context, action and skill definition versions, timestamp, base XP, all resolved multipliers, caps/rate-limit state, awarded XP, level before/after, and rejection reason when applicable. Store the original result even when later rebalancing projects a new level.

## Client Experience

The docked fitting screen shows the active hull's visual silhouette, universal hardpoint and core-system slot counts, currently fitted items, locally available station-storage modules/charges, CPU/powergrid used versus available, capacitor capacity/recharge and predicted active draw, durability, derived-stat changes before confirmation, and actionable validation failures. It must not imply a module is invalid because of hull role or family; it should instead surface the actual limiting resource, unavailable item, occupied location, or damaged state.

The HUD presents current/maximum capacitor, global activation lockout, individual module lifecycle/cooldowns, loaded-charge quantity, reload status, active buffs/debuffs with duration, and clear failed-activation reasons. Mining retains Phase II extraction state but displays the shared derived mining values and charge condition. Phase IV can extend the same module rack with targeting and combat state rather than replacing it.

The inventory presents cargo, the docked station's local storage, fitted modules, module charge bays, and consumable stacks as distinct locations. It exposes stack quantities and durability but sends no direct state mutation outside accepted server commands. Wreck UI presents only the authoritative dropped items; destroyed contents are reported in the owner's post-destruction summary and never shown as loot.

The skills screen lists level, current/next threshold progress, applied modifier summary, most recent valid action, capped/rate-limited state when relevant, and progression history. It never displays hidden RNG seeds or client-predictable future XP outcomes.

## Server Contracts And Persistence

Use typed HTTP/WebSocket contracts for hull/fit snapshots, fit module, unfit module, load/unload charge, start/cancel/reload module, use consumable, query derived stats, query skill state/history, and destruction-result retrieval. Phase II mining commands consume the shared module/derived-stat contracts. Every mutable request carries an idempotency key and responds with either an accepted event sequence or a stable validation error code.

Persist hull definitions/versions, module definitions/versions, effect definitions/versions, charge and consumable definitions/versions, ships, fit records, module durability/state, loaded charges, capacitor state, derived-stat snapshots, active effect instances, skill definitions/versions, pilot skill states, action-completion events, skill-progression events, loss profiles/versions, and destruction-resolution outcomes in PostgreSQL. Reuse Phase II's inventory stacks, wrecks, temporary-container rules, and immutable item ledger.

Redis may cache active module state, cooldowns, capacitor snapshots, nearby event fan-out, and rate-limit counters, but PostgreSQL remains authoritative for accepted activations, consumption, fit state, item loss, and progression. On reconnect, clients fetch persistent fit, skill, consumable, and active-effect state then reconcile current world events.

Authoritative event envelopes must cover fitting changes, derived-stat changes, capacitor changes, module lifecycle/cooldown/reload, charge consumption, consumable use/effect expiry, skill XP/level changes, and destruction-loss outcomes. Events include enough definition and state version data for the client to discard stale messages.

## Validation And Abuse Controls

- Validate identity, active-ship ownership, docked station locality, slot location, source item state, capacity, CPU, powergrid, module durability, capacitor, cooldown, charge compatibility, target, and ship state at the authoritative command boundary.
- Lock or serialize concurrent fitting, activation, reload, consumption, destruction, and inventory changes affecting the same ship or stack. Atomic transactions must leave no partially fitted item, double-spent capacitor, duplicated charge, or split loss outcome.
- Use idempotency keys for all mutable player commands and the destruction event ID for loss resolution. A repeated request returns its original result rather than repeating a mutation or RNG roll.
- Rate-limit fitting, activation, reload, consumable, and progression-triggering commands. Reject client-provided derived stats, cooldown timestamps, charge quantities, capacitor values, durability, skill XP, skill levels, loss probabilities, random outcomes, and action-completion state.
- Validate definition schemas at content-load time: effects must target known statistics, probabilities must total 100 percent, thresholds must increase, and all calculated values must stay inside configured safety ranges.
- Emit audit records for invalid resource state, impossible fit/stat combinations, repeated action patterns, rejected XP, duplicate requests, and every resolved ship-loss outcome.

## Implementation Order

1. Create versioned hull, module, effect, charge, consumable, loss-profile, fit-state, capacitor, active-effect, skill-state, and progression-event models/migrations; reuse Phase II inventory and ledger models.
2. Seed the starter miner, combat frigate, generalist hauler, universal hardpoint/core-system locations, initial module families, charges, consumables, loss profiles, and skill definitions.
3. Implement deterministic derived-stat aggregation, CPU/powergrid validation, docked atomic fit/unfit/load/unload operations, and fit/derived-stat snapshots.
4. Generalize Phase II mining lasers to shared module lifecycle, capacitor, charge, durability, and effect contracts without changing the Phase II mining authority boundary.
5. Implement module activation, global lockout, cooldowns, capacitor recharge/use, reload behavior, consumables, timed effect instances, and reconnect-safe event delivery.
6. Implement progression action events, logarithmic threshold evaluation, rate limits/diminishing returns, skill modifiers, immutable history, and replayable rebalance projections.
7. Implement idempotent destruction-loss resolution and integrate it with Phase II wreck creation, inventory ledger, owner/public access windows, and expiry.
8. Deliver fitting, HUD module rack, inventory charge/consumable, destruction summary, and skills UX; then validate mining integration and Phase IV-facing combat contracts.

## Acceptance Tests

- At a docked station, a pilot can fit any hardpoint or core-system module to any available corresponding location on any hull when local ownership, CPU, powergrid, and slot availability pass; the same module is rejected only for an explicit resource, state, or location failure.
- Fitting and un-fitting atomically moves items only between the active ship and the current station's local storage, recalculates derived statistics, writes ledger records, and cannot be repeated through retries.
- A fitting that exceeds CPU or powergrid is rejected with no inventory or stat mutation. A valid fitting visibly changes the authoritative mining, movement, capacitor, cargo, sensor, or defensive statistic it modifies.
- An active module pays capacitor exactly once, observes the global activation/reactivation lockout and its own cooldown, rejects insufficient-capacitor attempts, and reconciles correctly after reconnecting.
- Compatible charges load and consume according to their definition; incompatible, empty, duplicate, or interrupted reload/activation attempts create no extra charge or effect. Consumable stacks consume correctly and their buffs/debuffs expire exactly once.
- Valid completed mining and scanning actions award bounded, server-recorded XP; interrupted, spoofed, duplicate, or rate-exhausted actions do not increase skills. Increasing mining or scanning skill visibly changes only its configured subsequent calculation.
- The logarithmic skill curve has strictly increasing thresholds and produces a longer progression tail at higher levels. Historical action/progression events can be replayed against a new version without altering original records.
- On ship destruction, every fitted module, loaded charge, cargo item, and ship-contained consumable independently resolves as dropped or destroyed using its data-driven probability profile. Repeating the same destruction event returns the recorded result and never rerolls, duplicates items, or creates a second wreck.
- Dropped items appear in the Phase II wreck with five minutes of owner-only access, ten additional minutes of public access, and removal at 15 minutes. Destroyed items are absent from the wreck and have immutable destruction-ledger records.
- No client can supply authoritative fitting compatibility, statistics, capacitor, cooldown, item consumption, loss outcome, XP amount, level, or action-completion result.