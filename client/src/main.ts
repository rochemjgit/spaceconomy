import './style.css'
import './system-map.css'
import './warp.css'
import './target.css'
import './durability.css'
import './fitting.css'
import './core-systems.css'
import './station-services.css'
import './hardpoints.css'
import { Vector3 } from '@babylonjs/core'
import { createStationInteriorScene, createSystemScene } from './game/scene'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Application root was not found.')
}

const starterHardpoints = [
  { moduleName: 'Mining Laser', icon: 'ML', name: 'MINING LASER' },
]

const hardpointSlotsMarkup = starterHardpoints.map((hardpoint, index) => `
  <button class="module-slot" type="button" disabled aria-pressed="false" aria-label="Hardpoint ${index + 1}: ${hardpoint.name}" data-hardpoint-index="${index + 1}" data-module="${hardpoint.moduleName}"><span class="module-key">${index + 1}</span><span class="module-icon">${hardpoint.icon}</span><span class="module-name">${hardpoint.name}</span></button>
`).join('')

app.innerHTML = `
  <main class="game-shell">
    <canvas id="game-canvas" aria-label="Spaceconomy game world"></canvas>
    <div class="ship-reticle" aria-hidden="true"></div>
    <header class="topbar">
      <div class="topbar-left">
        <div class="game-menu">
          <button id="game-menu-toggle" class="game-menu-toggle" type="button" aria-label="Open game menu" aria-expanded="false" aria-controls="game-menu-actions"><span></span><span></span><span></span></button>
          <div id="game-menu-actions" class="game-menu-actions" hidden>
            <button type="button" data-modal="codex">CODEX</button>
            <button type="button" data-modal="help">HELP</button>
            <button type="button" data-modal="controls">CONTROLS</button>
            <button type="button" data-modal="logout">LOG OUT</button>
          </div>
        </div>
        <div class="brand"><span class="brand-mark">◈</span> SPACECONOMY</div>
      </div>
      <div id="system-status" class="status"><span class="status-dot"></span> LOCAL SYSTEM · PROTOTYPE</div>
    </header>
    <section class="module-rack" aria-label="Ship hardpoints">
      <p class="eyebrow">HARDPOINTS</p>
      <div class="module-slots" style="--hardpoint-count: ${starterHardpoints.length}">
        ${hardpointSlotsMarkup}
      </div>
      <div class="core-systems" aria-label="Installed core systems">
        <p class="eyebrow">CORE SYSTEMS</p>
        <div class="core-system-icons">
          <button class="core-system-icon" type="button" aria-label="Reactor: Compact Fission Plant. Output 120 megawatts with 76 percent heat tolerance." data-tooltip="REACTOR: Compact Fission Plant. 120 MW output, 76% heat tolerance."><span aria-hidden="true">RP</span></button>
          <button class="core-system-icon" type="button" aria-label="Shield Generator: capacity 100, recharge 6 per second." data-tooltip="SHIELD GENERATOR: Capacity 100, recharge 6.0/s."><span aria-hidden="true">SG</span></button>
          <button class="core-system-icon" type="button" aria-label="Sublight Drive: conventional thrust and maneuvering." data-tooltip="SUBLIGHT DRIVE: 34 kN thrust, 92% turn response."><span aria-hidden="true">SL</span></button>
          <button class="core-system-icon" type="button" aria-label="Warp Drive: Class I core with a 4.2 second spool time." data-tooltip="WARP DRIVE: Class I core, 4.2 s spool time."><span aria-hidden="true">WD</span></button>
          <button class="core-system-icon" type="button" aria-label="Fuel Tank: 80 unit deuterium reserve, estimated range five jumps." data-tooltip="FUEL TANK: 80/80 reserve, estimated 5 jumps."><span aria-hidden="true">FT</span></button>
          <button class="core-system-icon" type="button" aria-label="Cargo Hold: capacity 24 cubic meters." data-tooltip="CARGO HOLD: 0.0 / 24.0 m3 capacity."><span aria-hidden="true">CH</span></button>
        </div>
      </div>
    </section>
    <section class="flight-telemetry" aria-label="Ship status">
      <div class="telemetry-ship"><p class="eyebrow">STARTER CORVETTE</p><p class="muted">Flight assist <strong id="flight-assist">ON</strong></p></div>
      <div class="telemetry-speed"><p class="eyebrow">VELOCITY</p><p class="speed"><span id="ship-speed">0</span> <small>m/s</small></p></div>
      <div class="telemetry-position"><p class="eyebrow">POSITION</p><p class="coordinates">X <span id="coordinate-x">0</span> · Y <span id="coordinate-y">0</span> · Z <span id="coordinate-z">0</span></p></div>
    </section>
    <section class="durability-readout" aria-label="Ship durability">
      <div class="durability-layer"><div class="durability-label"><span>POWER</span><strong id="ship-power">100.00 / 100.00 MJ</strong></div><span class="durability-bar"><span id="ship-power-bar" class="durability-fill power-fill"></span></span></div>
      <div class="durability-layer"><div class="durability-label"><span>SHIELDS</span><strong id="ship-shields">100%</strong></div><span class="durability-bar"><span id="ship-shields-bar" class="durability-fill shield-fill"></span></span></div>
      <div class="durability-layer"><div class="durability-label"><span>HULL</span><strong id="ship-hull">100%</strong></div><span class="durability-bar"><span id="ship-hull-bar" class="durability-fill hull-fill"></span></span></div>
      <div class="durability-layer"><div class="durability-label"><span>FUEL</span><strong id="ship-fuel">80.00 / 80.00 L</strong></div><span class="durability-bar"><span id="ship-fuel-bar" class="durability-fill fuel-fill"></span></span></div>
      <div class="durability-layer"><div class="durability-label"><span>CARGO</span><strong id="ship-cargo">0.00 / 24.00 M3</strong></div><span class="durability-bar"><span id="ship-cargo-bar" class="durability-fill cargo-fill"></span></span></div>
      <p id="collision-alert" class="collision-alert" aria-live="polite"></p>
    </section>
    <section class="minimap" aria-label="System map">
      <p class="eyebrow">SYSTEM MAP</p>
      <div class="minimap-field">
        <span class="map-orbit"></span>
        <span id="map-primary-star" class="map-poi map-star" title="Primary Star"></span>
        <span id="map-starter-world" class="map-poi map-planet" title="Starter World"></span>
        <span id="map-kepler-station" class="map-poi map-station" title="Kepler Station"></span>
        <span id="map-asterion-belt" class="map-poi map-asteroid-belt" title="Asterion Belt - 240.0 km beyond Starter World"></span>
        <span id="map-vesper-belt" class="map-poi map-asteroid-belt map-vesper-belt" title="Vesper Belt - remote cold-rock field"></span>
        <span id="map-nadir-belt" class="map-poi map-asteroid-belt map-nadir-belt" title="Nadir Belt - outer trailing field"></span>
        <span id="player-map-marker" class="player-map-marker" title="Your ship"></span>
      </div>
      <div class="map-legend"><span class="legend-star">STAR</span><span class="legend-planet">WORLD</span><span class="legend-station">STATION</span><span class="legend-belt">BELT</span><span class="legend-player">YOU</span></div>
    </section>
    <section id="target-window" class="target-window" aria-label="Selected target" hidden>
      <div class="target-window-heading"><p class="eyebrow">TARGET LOCK</p><button id="clear-target" type="button" aria-label="Clear target">×</button></div>
      <p id="target-name" class="target-name"></p>
      <p id="target-range" class="target-range">0 m</p>
    </section>
    <section id="available-actions" class="available-actions" aria-label="Available actions" hidden>
      <p class="eyebrow">AVAILABLE ACTIONS</p>
      <button id="dock-action" type="button">DOCK AT KEPLER STATION</button>
    </section>
    <section id="docked-status" class="docked-status" aria-label="Station status" hidden>
      <p class="eyebrow">KEPLER STATION</p>
      <p>DOCKING BAY 04</p>
      <p class="docked-terminal-hint">SELECT THE STATION TERMINAL TO ACCESS SERVICES</p>
      <button id="undock-action" type="button">UNDOCK</button>
    </section>
    <section id="station-services" class="station-services" aria-label="Kepler Station services" hidden>
      <header class="station-services-heading"><div><p class="eyebrow">STATION SERVICES</p><h1>KEPLER STATION</h1></div><button id="exit-services-action" type="button">EXIT SERVICES</button></header>
      <div id="station-service-grid" class="station-service-grid" aria-label="Available station services">
        <button class="station-service-button" type="button" data-station-service="market"><strong>MARKET</strong><span>BUY / SELL</span></button>
        <button class="station-service-button" type="button" data-station-service="maintenance"><strong>MAINTENANCE</strong><span>REPAIR / RELOAD</span></button>
        <button class="station-service-button" type="button" data-station-service="fitting"><strong>FITTING</strong><span>MODULE SYSTEMS</span></button>
        <button class="station-service-button" type="button" data-station-service="refining"><strong>REFINING</strong><span>ORE PROCESSING</span></button>
        <button class="station-service-button" type="button" data-station-service="crafting"><strong>CRAFTING</strong><span>WORKSTATIONS</span></button>
        <button class="station-service-button" type="button" data-station-service="inventory"><strong>INVENTORY</strong><span>SHIP / STATION</span></button>
        <button class="station-service-button" type="button" data-station-service="hangar"><strong>HANGAR</strong><span>STORED SHIPS</span></button>
      </div>
      <div id="station-service-panel" class="station-service-panel" hidden>
        <button id="station-service-back" class="station-service-back" type="button">BACK TO SERVICES</button>
        <section data-station-panel="market" hidden><p class="eyebrow">MARKET EXCHANGE</p><h2>MARKET</h2><p class="station-service-empty">Buy and sell orders will load from the Kepler market. Purchases and sales settle through your Kepler station inventory.</p></section>
        <section data-station-panel="maintenance" hidden><p class="eyebrow">SHIPYARD SERVICES</p><h2>MAINTENANCE</h2><p class="station-service-empty">Repair prices, fuel, reload supplies, and crafted consumables require an authoritative docked-state snapshot.</p></section>
        <section id="fitting-panel" data-station-panel="fitting" hidden>
        <div class="fitting-heading"><span class="eyebrow">STARTER CORVETTE</span><strong>UNIVERSAL SYSTEMS</strong></div>
        <div class="fitting-layout">
          <div class="ship-fitting-map" aria-label="Top-down starter corvette module layout">
            <div class="ship-hull-outline" aria-hidden="true"><span class="ship-hull-core"></span><span class="ship-hull-nose"></span><span class="ship-hull-port-wing"></span><span class="ship-hull-starboard-wing"></span></div>
            <button class="fitting-slot fitting-slot-reactor is-selected" type="button" data-fitting-module="reactor" aria-pressed="true"><span>REACTOR</span><small>PLANT-01</small></button>
            <button class="fitting-slot fitting-slot-shields" type="button" data-fitting-module="shields" aria-pressed="false"><span>SHIELDS</span><small>SG-01</small></button>
            <button class="fitting-slot fitting-slot-sublight" type="button" data-fitting-module="sublight" aria-pressed="false"><span>SUBLIGHT</span><small>SD-01</small></button>
            <button class="fitting-slot fitting-slot-warp" type="button" data-fitting-module="warp" aria-pressed="false"><span>WARP</span><small>WD-01</small></button>
            <button class="fitting-slot fitting-slot-fuel" type="button" data-fitting-module="fuel" aria-pressed="false"><span>FUEL</span><small>FT-01</small></button>
            <button class="fitting-slot fitting-slot-cargo" type="button" data-fitting-module="cargo" aria-pressed="false"><span>CARGO</span><small>CH-01</small></button>
            <button class="fitting-slot fitting-slot-hardpoint" type="button" data-fitting-module="hardpoint" aria-pressed="false"><span>HARDPOINT</span><small>MINING LASER</small></button>
          </div>
          <div class="fitting-module-details" aria-live="polite">
            <p id="fitting-module-type" class="eyebrow">POWER SYSTEM</p>
            <h2 id="fitting-module-name">COMPACT FISSION PLANT</h2>
            <p id="fitting-module-spec" class="fitting-module-spec">Output 120 MW · Heat tolerance 76%</p>
            <p id="fitting-module-description">Provides shipwide power. Excess load produces heat that must be managed by the hull.</p>
          </div>
        </div>
        </section>
        <section data-station-panel="refining" hidden><p class="eyebrow">REFINERY QUEUE</p><h2>REFINING</h2><p class="station-service-empty">Refining jobs and queue times will appear here when local inventory reservations are available.</p></section>
        <section data-station-panel="crafting" hidden><p class="eyebrow">MANUFACTURING WORKSTATIONS</p><h2>CRAFTING</h2><p class="station-service-empty">Crafting recipes, material reservations, and production queues will appear here when connected to the station worker service.</p></section>
        <section data-station-panel="inventory" hidden><p class="eyebrow">LOCAL ASSET MANAGEMENT</p><h2>INVENTORY</h2><p class="station-service-empty">Ship cargo and personal Kepler storage will load separately. Transfers are allowed only between this ship and this station.</p></section>
        <section data-station-panel="hangar" hidden><p class="eyebrow">KEPLER SHIP STORAGE</p><h2>HANGAR</h2><p class="station-service-empty">Ships physically stored at Kepler Station will appear here. Move a ship by flying it to its destination station.</p></section>
      </div>
    </section>
    <div id="game-modal" class="game-modal" role="dialog" aria-modal="true" aria-labelledby="game-modal-title" hidden>
      <div class="game-modal-backdrop" data-modal-close></div>
      <section class="game-modal-panel">
        <header class="game-modal-heading">
          <div><p id="game-modal-eyebrow" class="eyebrow"></p><h1 id="game-modal-title"></h1></div>
          <button id="game-modal-close" class="game-modal-close" type="button" aria-label="Close dialog">×</button>
        </header>
        <div id="game-modal-content" class="game-modal-content"></div>
        <footer id="game-modal-actions" class="game-modal-actions"></footer>
      </section>
    </div>
    <div id="system-map-modal" class="system-map-modal" role="dialog" aria-modal="true" aria-labelledby="system-map-title" hidden>
      <div class="system-map-backdrop" data-system-map-close></div>
      <section class="system-map-panel">
        <header class="system-map-heading"><div><p class="eyebrow">NAVIGATION OVERLAY</p><h1 id="system-map-title">LOCAL SYSTEM</h1></div><button id="system-map-close" class="game-modal-close" type="button" aria-label="Close system map">×</button></header>
        <div class="system-map-layout">
          <div class="system-map-display" aria-label="System map POIs">
            <div id="system-map-world" class="system-map-world">
              <button class="system-poi system-poi-star is-selected" type="button" data-poi="primary-star" aria-pressed="true"><span>PRIMARY STAR</span></button>
              <button class="system-poi system-poi-world" type="button" data-poi="starter-world" aria-pressed="false"><span>STARTER WORLD</span></button>
              <button class="system-poi system-poi-station" type="button" data-poi="kepler-station" aria-pressed="false"><span>KEPLER STATION</span></button>
              <button class="system-poi system-poi-belt" type="button" data-poi="asterion-belt" aria-pressed="false"><span>ASTERION BELT</span></button>
              <button class="system-poi system-poi-belt system-poi-vesper-belt" type="button" data-poi="vesper-belt" aria-pressed="false"><span>VESPER BELT</span></button>
              <button class="system-poi system-poi-belt system-poi-nadir-belt" type="button" data-poi="nadir-belt" aria-pressed="false"><span>NADIR BELT</span></button>
            </div>
          </div>
          <aside class="poi-details" aria-live="polite"><p id="poi-type" class="eyebrow">STAR</p><h2 id="poi-name">PRIMARY STAR</h2><p id="poi-distance" class="poi-distance">0.0 km</p><p id="poi-description" class="modal-copy">The system's primary stellar body and central navigation reference.</p><button id="warp-action" class="warp-action" type="button" hidden>WARP TO SELECTED POI</button></aside>
        </div>
        <footer class="system-map-footer"><span>M</span> CLOSE MAP</footer>
      </section>
    </div>
    <div id="warp-overlay" class="warp-overlay" aria-hidden="true" hidden><div id="warp-stars" class="warp-stars"></div></div>
    <div id="ship-destroyed-overlay" class="ship-destroyed-overlay" role="alert" hidden><p class="eyebrow">CRITICAL FAILURE</p><h1>SHIP DESTROYED</h1><p id="destruction-cause"></p></div>
  </main>
`

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
if (!canvas) {
  throw new Error('Game canvas was not found.')
}
const gameCanvas = canvas

const speedDisplay = document.querySelector<HTMLElement>('#ship-speed')
const flightAssistDisplay = document.querySelector<HTMLElement>('#flight-assist')
const coordinateXDisplay = document.querySelector<HTMLElement>('#coordinate-x')
const coordinateYDisplay = document.querySelector<HTMLElement>('#coordinate-y')
const coordinateZDisplay = document.querySelector<HTMLElement>('#coordinate-z')
const playerMapMarker = document.querySelector<HTMLElement>('#player-map-marker')
const minimapField = document.querySelector<HTMLElement>('.minimap-field')
const mapPrimaryStar = document.querySelector<HTMLElement>('#map-primary-star')
const mapStarterWorld = document.querySelector<HTMLElement>('#map-starter-world')
const mapKeplerStation = document.querySelector<HTMLElement>('#map-kepler-station')
const mapAsterionBelt = document.querySelector<HTMLElement>('#map-asterion-belt')
const mapVesperBelt = document.querySelector<HTMLElement>('#map-vesper-belt')
const mapNadirBelt = document.querySelector<HTMLElement>('#map-nadir-belt')
const availableActions = document.querySelector<HTMLElement>('#available-actions')
const dockAction = document.querySelector<HTMLButtonElement>('#dock-action')
const dockedStatus = document.querySelector<HTMLElement>('#docked-status')
const stationServices = document.querySelector<HTMLElement>('#station-services')
const undockAction = document.querySelector<HTMLButtonElement>('#undock-action')
const systemStatus = document.querySelector<HTMLElement>('#system-status')
const stationServiceGrid = document.querySelector<HTMLElement>('#station-service-grid')
const stationServicePanel = document.querySelector<HTMLElement>('#station-service-panel')
const stationServiceButtons = document.querySelectorAll<HTMLButtonElement>('[data-station-service]')
const stationPanels = document.querySelectorAll<HTMLElement>('[data-station-panel]')
const stationServiceBack = document.querySelector<HTMLButtonElement>('#station-service-back')
const exitServicesAction = document.querySelector<HTMLButtonElement>('#exit-services-action')
const fittingSlots = document.querySelectorAll<HTMLButtonElement>('[data-fitting-module]')
const fittingModuleType = document.querySelector<HTMLElement>('#fitting-module-type')
const fittingModuleName = document.querySelector<HTMLElement>('#fitting-module-name')
const fittingModuleSpec = document.querySelector<HTMLElement>('#fitting-module-spec')
const fittingModuleDescription = document.querySelector<HTMLElement>('#fitting-module-description')
const gameMenuToggle = document.querySelector<HTMLButtonElement>('#game-menu-toggle')
const gameMenuActions = document.querySelector<HTMLElement>('#game-menu-actions')
const gameModal = document.querySelector<HTMLElement>('#game-modal')
const gameModalEyebrow = document.querySelector<HTMLElement>('#game-modal-eyebrow')
const gameModalTitle = document.querySelector<HTMLElement>('#game-modal-title')
const gameModalContent = document.querySelector<HTMLElement>('#game-modal-content')
const gameModalActions = document.querySelector<HTMLElement>('#game-modal-actions')
const gameModalClose = document.querySelector<HTMLButtonElement>('#game-modal-close')
const moduleSlots = document.querySelectorAll<HTMLButtonElement>('[data-module]')
const systemMapModal = document.querySelector<HTMLElement>('#system-map-modal')
const systemMapClose = document.querySelector<HTMLButtonElement>('#system-map-close')
const systemMapDisplay = document.querySelector<HTMLElement>('.system-map-display')
const systemMapWorld = document.querySelector<HTMLElement>('#system-map-world')
const poiType = document.querySelector<HTMLElement>('#poi-type')
const poiName = document.querySelector<HTMLElement>('#poi-name')
const poiDistance = document.querySelector<HTMLElement>('#poi-distance')
const poiDescription = document.querySelector<HTMLElement>('#poi-description')
const systemPois = document.querySelectorAll<HTMLButtonElement>('[data-poi]')
const warpAction = document.querySelector<HTMLButtonElement>('#warp-action')
const warpOverlay = document.querySelector<HTMLElement>('#warp-overlay')
const warpStars = document.querySelector<HTMLElement>('#warp-stars')
const targetWindow = document.querySelector<HTMLElement>('#target-window')
const targetName = document.querySelector<HTMLElement>('#target-name')
const targetRange = document.querySelector<HTMLElement>('#target-range')
const clearTarget = document.querySelector<HTMLButtonElement>('#clear-target')
const powerDisplay = document.querySelector<HTMLElement>('#ship-power')
const powerBar = document.querySelector<HTMLElement>('#ship-power-bar')
const shieldsDisplay = document.querySelector<HTMLElement>('#ship-shields')
const hullDisplay = document.querySelector<HTMLElement>('#ship-hull')
const shieldsBar = document.querySelector<HTMLElement>('#ship-shields-bar')
const hullBar = document.querySelector<HTMLElement>('#ship-hull-bar')
const fuelDisplay = document.querySelector<HTMLElement>('#ship-fuel')
const fuelBar = document.querySelector<HTMLElement>('#ship-fuel-bar')
const cargoDisplay = document.querySelector<HTMLElement>('#ship-cargo')
const cargoBar = document.querySelector<HTMLElement>('#ship-cargo-bar')
const collisionAlert = document.querySelector<HTMLElement>('#collision-alert')
const shipDestroyedOverlay = document.querySelector<HTMLElement>('#ship-destroyed-overlay')
const destructionCause = document.querySelector<HTMLElement>('#destruction-cause')
const minimumMinimapRadius = 20_000
const maximumMinimapRadius = 400_000
let minimapRadius = 140_000
let playerMapPosition = { x: 123_078, y: 480, z: -2_691 }
let selectedTarget: { name: string; position: Vector3; oreRemainingCubicMeters: number; initialOreCubicMeters: number } | undefined
let cargoCubicMeters = 0
let maximumCargoCubicMeters = 24
let systemMapPanX = 0
let systemMapPanY = 0
let systemMapRotation = -18
let systemMapTilt = 54.7
let systemMapZoom = 1
let systemMapGesture: { pointerId: number; button: number; clientX: number; clientY: number } | undefined

for (let index = 0; index < 240; index += 1) {
  const angle = index * 2.39996323
  const distance = 260 + ((index * 73) % 1_350)
  const star = document.createElement('i')
  star.style.setProperty('--warp-star-x', `${Math.cos(angle) * distance}px`)
  star.style.setProperty('--warp-star-y', `${Math.sin(angle) * distance * 0.62}px`)
  star.style.setProperty('--warp-star-delay', `${-(index % 18) * 0.09}s`)
  star.style.setProperty('--warp-star-size', `${1 + (index % 3)}px`)
  warpStars?.append(star)
}

type ModalName = 'codex' | 'help' | 'controls' | 'logout'
type PoiName = 'primary-star' | 'starter-world' | 'kepler-station' | 'asterion-belt' | 'vesper-belt' | 'nadir-belt'

const modalContent: Record<ModalName, { eyebrow: string; title: string; content: string; actions?: string }> = {
  codex: { eyebrow: 'REFERENCE ARCHIVE', title: 'CODEX', content: '<dl class="codex-list"><div><dt>Flight Assist</dt><dd>Automatic braking engages when no thrust input is active.</dd></div><div><dt>Kepler Station</dt><dd>A protected orbital outpost with docking access inside its shield boundary.</dd></div><div><dt>System Map</dt><dd>Your position is shown in green. Stellar bodies and stations appear at their known coordinates.</dd></div></dl>' },
  help: { eyebrow: 'PILOT SUPPORT', title: 'HELP', content: '<p class="modal-copy">Help and mission guidance will be available here as the prototype expands.</p>' },
  controls: { eyebrow: 'FLIGHT CONFIGURATION', title: 'CONTROLS', content: '<dl class="controls-list"><div><dt>W A S D</dt><dd>Strafe and thrust</dd></div><div><dt>SPACE / C</dt><dd>Ascend / descend</dd></div><div><dt>Q / E</dt><dd>Roll ship</dd></div><div><dt>RIGHT MOUSE</dt><dd>Hold and drag to steer</dd></div><div><dt>F</dt><dd>Toggle flight assist</dd></div></dl>' },
  logout: { eyebrow: 'SESSION', title: 'LOG OUT', content: '<p class="modal-copy">End this local session and return to the launch screen?</p>', actions: '<button id="logout-cancel" class="modal-button" type="button">CANCEL</button><button id="logout-confirm" class="modal-button modal-button-primary" type="button">LOG OUT</button>' },
}

function closeGameModal() {
  gameModal?.setAttribute('hidden', '')
  gameModalActions?.replaceChildren()
}

const poiDetails: Record<PoiName, { type: string; name: string; description: string; position: { x: number; y: number; z: number } }> = {
  'primary-star': { type: 'STAR', name: 'PRIMARY STAR', description: 'The system primary and central navigation reference.', position: { x: 0, y: 0, z: 0 } },
  'starter-world': { type: 'TERRESTRIAL WORLD', name: 'STARTER WORLD', description: 'A temperate starter world supporting Kepler Station operations.', position: { x: 119_678, y: 0, z: 0 } },
  'kepler-station': { type: 'ORBITAL STATION', name: 'KEPLER STATION', description: 'A protected orbital outpost. Docking is available inside the station shield.', position: { x: 123_078, y: 480, z: -3_400 } },
  'asterion-belt': { type: 'ASTEROID BELT', name: 'ASTERION BELT', description: 'A mineral-rich belt beyond Starter World. Survey information is incomplete.', position: { x: 359_678, y: 0, z: 30_000 } },
  'vesper-belt': { type: 'ASTEROID BELT', name: 'VESPER BELT', description: 'A remote cold-rock field on the far anti-spinward arc.', position: { x: -210_000, y: 0, z: 145_000 } },
  'nadir-belt': { type: 'ASTEROID BELT', name: 'NADIR BELT', description: 'A dense outer field along the trailing orbital route. Survey information is incomplete.', position: { x: 85_000, y: 0, z: -295_000 } },
}
let selectedPoi: PoiName = 'primary-star'

function distanceToPoi(name: PoiName): number {
  const destination = poiDetails[name].position
  return Math.hypot(destination.x - playerMapPosition.x, destination.y - playerMapPosition.y, destination.z - playerMapPosition.z)
}

function updateSelectedPoiDetails() {
  const details = poiDetails[selectedPoi]
  const distance = distanceToPoi(selectedPoi)
  if (!poiType || !poiName || !poiDistance || !poiDescription || !warpAction) return
  poiType.textContent = details.type
  poiName.textContent = details.name
  poiDistance.textContent = distance >= 1_000 ? `${(distance / 1_000).toFixed(1)} km` : `${distance.toFixed(0)} m`
  poiDescription.textContent = details.description
  warpAction.hidden = distance <= 100_000
}

function closeSystemMap() {
  systemMapModal?.setAttribute('hidden', '')
}

function openSystemMap() {
  if (!systemMapModal || gameModal?.hasAttribute('hidden') === false) return
  systemMapModal.removeAttribute('hidden')
  systemMapClose?.focus()
}

function updateSystemMapView() {
  if (!systemMapWorld) return
  systemMapWorld.style.transform = `translate(${systemMapPanX}px, ${systemMapPanY}px) rotateX(${systemMapTilt}deg) rotateZ(${systemMapRotation}deg) scale(${systemMapZoom})`
}

function selectPoi(name: PoiName) {
  selectedPoi = name
  updateSelectedPoiDetails()
  systemPois.forEach((poi) => {
    const isSelected = poi.dataset.poi === name
    poi.classList.toggle('is-selected', isSelected)
    poi.setAttribute('aria-pressed', String(isSelected))
  })
}

function openGameModal(name: ModalName) {
  const content = modalContent[name]
  if (!gameModal || !gameModalEyebrow || !gameModalTitle || !gameModalContent || !gameModalActions) return
  gameModalEyebrow.textContent = content.eyebrow
  gameModalTitle.textContent = content.title
  gameModalContent.innerHTML = content.content
  gameModalActions.innerHTML = content.actions ?? ''
  gameModal.removeAttribute('hidden')
  gameModalClose?.focus()
  document.querySelector<HTMLButtonElement>('#logout-cancel')?.addEventListener('click', closeGameModal)
  document.querySelector<HTMLButtonElement>('#logout-confirm')?.addEventListener('click', () => window.location.reload())
}

function openShipInventory() {
  if (!gameModal || !gameModalEyebrow || !gameModalTitle || !gameModalContent || !gameModalActions) return
  gameModalEyebrow.textContent = 'SHIP CARGO HOLD'
  gameModalTitle.textContent = 'INVENTORY'
  gameModalContent.innerHTML = cargoCubicMeters > 0
    ? `<p class="modal-copy">MINED ORE</p><p class="speed">${cargoCubicMeters.toFixed(2)} <small>/ ${maximumCargoCubicMeters.toFixed(2)} m3</small></p>`
    : `<p class="modal-copy">Cargo hold empty.</p><p class="speed">0.00 <small>/ ${maximumCargoCubicMeters.toFixed(2)} m3</small></p>`
  gameModalActions.innerHTML = ''
  gameModal.removeAttribute('hidden')
  gameModalClose?.focus()
}

gameMenuToggle?.addEventListener('click', () => {
  const isOpen = gameMenuActions?.hasAttribute('hidden') === false
  gameMenuActions?.toggleAttribute('hidden', isOpen)
  gameMenuToggle.setAttribute('aria-expanded', String(!isOpen))
})
document.querySelectorAll<HTMLButtonElement>('[data-modal]').forEach((button) => {
  button.addEventListener('click', () => {
    gameMenuActions?.setAttribute('hidden', '')
    gameMenuToggle?.setAttribute('aria-expanded', 'false')
    openGameModal(button.dataset.modal as ModalName)
  })
})
gameModalClose?.addEventListener('click', closeGameModal)
document.querySelector<HTMLElement>('[data-modal-close]')?.addEventListener('click', closeGameModal)
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeGameModal()
    closeSystemMap()
  }
  if (event.key.toLowerCase() === 'm' && !event.repeat) {
    event.preventDefault()
    if (systemMapModal?.hasAttribute('hidden') === false) closeSystemMap()
    else openSystemMap()
  }
  if (event.key.toLowerCase() === 'i' && !event.repeat && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || (event.target as HTMLElement).isContentEditable)) {
    event.preventDefault()
    if (gameModal?.hasAttribute('hidden') === false) closeGameModal()
    else openShipInventory()
  }
})
systemMapClose?.addEventListener('click', closeSystemMap)
document.querySelector<HTMLElement>('[data-system-map-close]')?.addEventListener('click', closeSystemMap)
systemPois.forEach((poi) => poi.addEventListener('click', () => selectPoi(poi.dataset.poi as PoiName)))
warpAction?.addEventListener('click', () => {
  const destination = poiDetails[selectedPoi].position
  if (scene.warpTo(new Vector3(destination.x, destination.y, destination.z))) closeSystemMap()
})
systemMapDisplay?.addEventListener('pointerdown', (event) => {
  if (event.button === 0 && (event.target as HTMLElement).closest('[data-poi]')) return
  if (event.button !== 0 && event.button !== 2) return
  event.preventDefault()
  systemMapGesture = { pointerId: event.pointerId, button: event.button, clientX: event.clientX, clientY: event.clientY }
  systemMapDisplay.setPointerCapture(event.pointerId)
})
systemMapDisplay?.addEventListener('pointermove', (event) => {
  if (!systemMapGesture || event.pointerId !== systemMapGesture.pointerId) return
  const movementX = event.clientX - systemMapGesture.clientX
  const movementY = event.clientY - systemMapGesture.clientY
  if (systemMapGesture.button === 0) {
    systemMapPanX += movementX
    systemMapPanY += movementY
  } else {
    systemMapRotation += movementX * 0.35
    systemMapTilt = Math.max(20, Math.min(75, systemMapTilt - movementY * 0.25))
  }
  systemMapGesture.clientX = event.clientX
  systemMapGesture.clientY = event.clientY
  updateSystemMapView()
})
systemMapDisplay?.addEventListener('pointerup', (event) => {
  if (!systemMapGesture || event.pointerId !== systemMapGesture.pointerId) return
  if (systemMapDisplay.hasPointerCapture(event.pointerId)) systemMapDisplay.releasePointerCapture(event.pointerId)
  systemMapGesture = undefined
})
systemMapDisplay?.addEventListener('contextmenu', (event) => event.preventDefault())
systemMapDisplay?.addEventListener('wheel', (event) => {
  event.preventDefault()
  const zoomFactor = event.deltaY > 0 ? 1 / 1.15 : 1.15
  systemMapZoom = Math.max(0.55, Math.min(2.4, systemMapZoom * zoomFactor))
  updateSystemMapView()
}, { passive: false })
updateSystemMapView()

function toggleHardpoint(slot: HTMLButtonElement) {
  if (!selectedTarget || slot.disabled) return
  const isActive = slot.getAttribute('aria-pressed') === 'true'
  const nextIsActive = !isActive
  slot.setAttribute('aria-pressed', String(nextIsActive))
  slot.classList.toggle('is-active', nextIsActive)
  scene.setModuleActive(slot.dataset.module ?? '', nextIsActive)
}

moduleSlots.forEach((slot) => slot.addEventListener('click', () => toggleHardpoint(slot)))

window.addEventListener('keydown', (event) => {
  if (event.repeat || !/^[1-9]$/.test(event.key)) return
  const slot = Array.from(moduleSlots).find((hardpoint) => hardpoint.dataset.hardpointIndex === event.key)
  if (!slot || slot.disabled) return
  event.preventDefault()
  toggleHardpoint(slot)
})

function updateHardpointAvailability() {
  const hasTarget = selectedTarget !== undefined
  moduleSlots.forEach((slot) => {
    slot.disabled = !hasTarget
    if (!hasTarget && slot.getAttribute('aria-pressed') === 'true') {
      slot.setAttribute('aria-pressed', 'false')
      slot.classList.remove('is-active')
      scene.setModuleActive(slot.dataset.module ?? '', false)
    }
  })
}

function mapCoordinate(value: number): string {
  const percentage = 50 + (value / minimapRadius) * 50
  return `${Math.min(96, Math.max(4, percentage)).toFixed(2)}%`
}

function positionMapMarker(marker: HTMLElement | null, x: number, z: number) {
  if (!marker) return
  marker.style.left = mapCoordinate(x)
  marker.style.top = mapCoordinate(-z)
}

function updateTargetWindow() {
  if (!targetWindow || !targetName || !targetRange) return
  if (!selectedTarget) {
    targetWindow.setAttribute('hidden', '')
    return
  }
  const distance = Vector3.Distance(new Vector3(playerMapPosition.x, playerMapPosition.y, playerMapPosition.z), selectedTarget.position)
  targetName.textContent = selectedTarget.name
  targetRange.textContent = distance >= 1_000 ? `${(distance / 1_000).toFixed(1)} km` : `${distance.toFixed(0)} m`
    const formattedDistance = distance >= 1_000 ? `${(distance / 1_000).toFixed(1)} km` : `${distance.toFixed(0)} m`
    targetRange.textContent = `${formattedDistance} · ${selectedTarget.oreRemainingCubicMeters.toFixed(1)} / ${selectedTarget.initialOreCubicMeters.toFixed(1)} m3`
  targetWindow.removeAttribute('hidden')
}

clearTarget?.addEventListener('click', () => {
  selectedTarget = undefined
  updateTargetWindow()
  updateHardpointAvailability()
})

function updateMinimapMarkers() {
  positionMapMarker(mapPrimaryStar, 0, 0)
  positionMapMarker(mapStarterWorld, 119_678, 0)
  positionMapMarker(mapKeplerStation, 123_078, -3_400)
  positionMapMarker(mapAsterionBelt, 359_678, 30_000)
  positionMapMarker(mapVesperBelt, -210_000, 145_000)
  positionMapMarker(mapNadirBelt, 85_000, -295_000)
  positionMapMarker(playerMapMarker, playerMapPosition.x, playerMapPosition.z)
}

minimapField?.addEventListener('wheel', (event) => {
  event.preventDefault()
  const zoomFactor = event.deltaY > 0 ? 1.2 : 1 / 1.2
  minimapRadius = Math.min(maximumMinimapRadius, Math.max(minimumMinimapRadius, minimapRadius * zoomFactor))
  updateMinimapMarkers()
}, { passive: false })
updateMinimapMarkers()

function createFlightScene(initialLaunchSpeed = 0, initialFlightAssistEnabled = true) {
  return createSystemScene(gameCanvas, {
    initialLaunchSpeed,
    initialFlightAssistEnabled,
    onWarpUpdate(isWarping, phase) {
      const isInWarpTransit = isWarping && (phase === 'warping' || phase === 'cruising')
      warpOverlay?.toggleAttribute('hidden', !isInWarpTransit)
      warpOverlay?.setAttribute('data-phase', phase)
    },
    onTargetSelectionChange(target) {
      selectedTarget = target
      updateTargetWindow()
      updateHardpointAvailability()
    },
    onModuleActiveChange(moduleName, isActive) {
      const moduleSlot = Array.from(moduleSlots).find((slot) => slot.dataset.module === moduleName)
      if (!moduleSlot) return
      moduleSlot.setAttribute('aria-pressed', String(isActive))
      moduleSlot.classList.toggle('is-active', isActive)
    },
    onShipStatusChange(status) {
      cargoCubicMeters = status.cargoCubicMeters
      maximumCargoCubicMeters = status.maximumCargoCubicMeters
      if (powerDisplay) powerDisplay.textContent = `${status.powerMegajoules.toFixed(2)} / ${status.maximumPowerMegajoules.toFixed(2)} MJ`
      if (powerBar) powerBar.style.width = `${(status.powerMegajoules / status.maximumPowerMegajoules) * 100}%`
      if (shieldsDisplay) shieldsDisplay.textContent = `${Math.ceil(status.shields)}%`
      if (hullDisplay) hullDisplay.textContent = `${Math.ceil(status.hull)}%`
      if (shieldsBar) shieldsBar.style.width = `${status.shields}%`
      if (hullBar) hullBar.style.width = `${status.hull}%`
      if (fuelDisplay) fuelDisplay.textContent = `${status.fuelLiters.toFixed(2)} / ${status.maximumFuelLiters.toFixed(2)} L`
      if (fuelBar) fuelBar.style.width = `${(status.fuelLiters / status.maximumFuelLiters) * 100}%`
      if (cargoDisplay) cargoDisplay.textContent = `${status.cargoCubicMeters.toFixed(2)} / ${status.maximumCargoCubicMeters.toFixed(2)} M3`
      if (cargoBar) cargoBar.style.width = `${(status.cargoCubicMeters / status.maximumCargoCubicMeters) * 100}%`
      if (collisionAlert) collisionAlert.textContent = status.collisionName ? `IMPACT: ${status.collisionName}` : ''
      shipDestroyedOverlay?.toggleAttribute('hidden', !status.destroyed)
      if (destructionCause) destructionCause.textContent = status.destroyed && status.collisionName ? `Collision with ${status.collisionName}` : ''
    },
    onFlightUpdate(position, speed, flightAssistEnabled) {
      if (speedDisplay) speedDisplay.textContent = speed.toFixed(1)
      if (flightAssistDisplay) flightAssistDisplay.textContent = flightAssistEnabled ? 'ON' : 'OFF'
      if (coordinateXDisplay) coordinateXDisplay.textContent = position.x.toFixed(0)
      if (coordinateYDisplay) coordinateYDisplay.textContent = position.y.toFixed(0)
      if (coordinateZDisplay) coordinateZDisplay.textContent = position.z.toFixed(0)
      playerMapPosition = { x: position.x, y: position.y, z: position.z }
      positionMapMarker(playerMapMarker, position.x, position.z)
      updateTargetWindow()
      updateSelectedPoiDetails()
    },
    onDockingAvailabilityChange(isAvailable) {
      if (availableActions) availableActions.hidden = !isAvailable
    },
  })
}

let scene = createFlightScene()
let isSceneTransitioning = false

function closeStationServices() {
  stationServices?.setAttribute('hidden', '')
  stationServiceGrid?.removeAttribute('hidden')
  stationServicePanel?.setAttribute('hidden', '')
}

function openStationServices() {
  stationServices?.removeAttribute('hidden')
  stationServiceGrid?.removeAttribute('hidden')
  stationServicePanel?.setAttribute('hidden', '')
}

async function transitionScene(replaceScene: () => void) {
  if (isSceneTransitioning) return
  isSceneTransitioning = true
  gameCanvas.classList.add('is-scene-transitioning')
  await new Promise<void>((resolve) => window.setTimeout(resolve, 180))
  replaceScene()
  window.requestAnimationFrame(() => {
    gameCanvas.classList.remove('is-scene-transitioning')
    isSceneTransitioning = false
  })
}

dockAction?.addEventListener('click', () => {
  void transitionScene(() => {
    scene.dispose()
    scene = createStationInteriorScene(gameCanvas, { onTerminalInteract: openStationServices })
    availableActions?.setAttribute('hidden', '')
    dockedStatus?.removeAttribute('hidden')
    systemStatus?.setAttribute('hidden', '')
    document.querySelector('.game-shell')?.classList.add('is-docked')
  })
})

undockAction?.addEventListener('click', () => {
  void transitionScene(() => {
    scene.dispose()
    scene = createFlightScene(25, false)
    dockedStatus?.setAttribute('hidden', '')
    closeStationServices()
    systemStatus?.removeAttribute('hidden')
    document.querySelector('.game-shell')?.classList.remove('is-docked')
  })
})

stationServiceButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const selectedService = button.dataset.stationService
    stationServiceGrid?.setAttribute('hidden', '')
    stationServicePanel?.removeAttribute('hidden')
    stationPanels.forEach((panel) => {
      panel.hidden = panel.dataset.stationPanel !== selectedService
    })
  })
})

stationServiceBack?.addEventListener('click', () => {
  stationServicePanel?.setAttribute('hidden', '')
  stationServiceGrid?.removeAttribute('hidden')
})

exitServicesAction?.addEventListener('click', closeStationServices)

const fittingModuleDetails = {
  reactor: { type: 'POWER SYSTEM', name: 'COMPACT FISSION PLANT', spec: 'Output 120 MW · Heat tolerance 76%', description: 'Provides shipwide power. Excess load produces heat that must be managed by the hull.' },
  shields: { type: 'DEFENSIVE SYSTEM', name: 'SHIELD GENERATOR', spec: 'Capacity 100 · Recharge 6.0/s', description: 'Projects the first defensive layer and restores protection while the ship has available power.' },
  sublight: { type: 'SUBLIGHT PROPULSION', name: 'PULSE DRIVE ARRAY', spec: 'Thrust 34 kN · Turn response 92%', description: 'Provides conventional thrust, acceleration, and maneuvering control within a system.' },
  warp: { type: 'WARP PROPULSION', name: 'WARP DRIVE CORE', spec: 'Class I · Spool time 4.2 s', description: 'Folds local space for inter-orbit travel once the drive has spooled and sufficient fuel is available.' },
  fuel: { type: 'CONSUMABLE SYSTEM', name: 'DEUTERIUM TANK', spec: 'Reserve 80 / 80 · 5 jumps', description: 'Stores propellant for conventional flight and warp travel. Refuel while docked.' },
  cargo: { type: 'LOGISTICS SYSTEM', name: 'STANDARD CARGO HOLD', spec: 'Capacity 0.0 / 24.0 m3', description: 'Carries mined materials and trade goods between stations, worlds, and industrial sites.' },
  hardpoint: { type: 'HIGH SLOT · HARDPOINT 1 / 1', name: 'MINING LASER', spec: 'Range 2.5 km · Yield 1.0 m3/cycle', description: 'The starter corvette has one hardpoint, fitted with a basic mining laser for extracting asteroid ore.' },
} as const

fittingSlots.forEach((slot) => {
  slot.addEventListener('click', () => {
    const moduleId = slot.dataset.fittingModule as keyof typeof fittingModuleDetails | undefined
    if (!moduleId) return
    const details = fittingModuleDetails[moduleId]
    fittingSlots.forEach((fittingSlot) => {
      const isSelected = fittingSlot === slot
      fittingSlot.classList.toggle('is-selected', isSelected)
      fittingSlot.setAttribute('aria-pressed', String(isSelected))
    })
    if (fittingModuleType) fittingModuleType.textContent = details.type
    if (fittingModuleName) fittingModuleName.textContent = details.name
    if (fittingModuleSpec) fittingModuleSpec.textContent = details.spec
    if (fittingModuleDescription) fittingModuleDescription.textContent = details.description
  })
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => scene.dispose())
}

window.addEventListener('beforeunload', () => scene.dispose(), { once: true })
