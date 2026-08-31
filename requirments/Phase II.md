## Phase 2: Resource Extraction, Items, and Inventory
**Goal**: Mining is a satisfying foundational activity that produces the inputs for every economy loop.

1. Establish item taxonomy and data-driven definitions: raw ore, refined materials, components, ship modules, ammunition/charges, fuel, and consumables. Define stack limits, volume, rarity, and binding/tradability rules.
2. Finish inventory and cargo operations: slot/volume capacity, stack split/merge, transfers between ship cargo, station storage, wrecks, and future trade containers; enforce all mutations server-side and record ledger events.
3. Build the system's handcrafted resource-field composition: accessible baseline ores in inner-belt fields; rare/high-yield ores and hazards in distant outer-belt fields; asteroid sizes/yields, visual variants, availability bands, and controlled server-side respawn/depletion rules.
4. Add mining equipment slots and mining-laser activation: target validation, cycle time, capacitor/energy cost, yield calculation, cargo delivery, depletion broadcasts, and mining visual/audio events.
5. Create an extraction HUD: target details, mining cycle/progress, cargo capacity, yields, local speed/vector state, and clear failure/action feedback.
6. Add station refining that converts ore to materials, including configurable efficiencies and losses. Require docking at one of the three orbital stations; expose station-local storage from the start so future logistical choices remain possible.

**Verification**: Players locate an inner- or outer-belt field, equip and operate a mining laser, fill cargo with ore, navigate or warp to an orbital station, refine the ore, and see inventory persist after reconnecting.