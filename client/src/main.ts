import './style.css'
import { createStationInteriorScene, createSystemScene } from './game/scene'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Application root was not found.')
}

app.innerHTML = `
  <main class="game-shell">
    <canvas id="game-canvas" aria-label="Spaceconomy game world"></canvas>
    <div class="ship-reticle" aria-hidden="true"></div>
    <header class="topbar">
      <div class="brand"><span class="brand-mark">◈</span> SPACECONOMY</div>
      <div id="system-status" class="status"><span class="status-dot"></span> LOCAL SYSTEM · PROTOTYPE</div>
    </header>
    <section class="hud hud-left" aria-label="Ship status">
      <p class="eyebrow">STARTER CORVETTE</p>
      <p class="speed"><span id="ship-speed">0</span> <small>m/s</small></p>
      <p class="coordinates">X <span id="coordinate-x">0</span> · Y <span id="coordinate-y">0</span> · Z <span id="coordinate-z">0</span></p>
      <p class="muted">Flight assist <strong id="flight-assist">ON</strong></p>
    </section>
    <section class="hud hud-right" aria-label="Navigation status">
      <p class="eyebrow">KNOWN DESTINATIONS</p>
      <p>Kepler Station <span class="distance">12.4 AU</span></p>
      <button type="button" disabled>WARP UNAVAILABLE</button>
    </section>
    <section class="minimap" aria-label="System map">
      <p class="eyebrow">SYSTEM MAP</p>
      <div class="minimap-field">
        <span class="map-orbit"></span>
        <span class="map-poi map-star" title="Primary Star"></span>
        <span class="map-poi map-planet" title="Starter World"></span>
        <span class="map-poi map-station" title="Kepler Station"></span>
        <span id="player-map-marker" class="player-map-marker" title="Your ship"></span>
      </div>
      <div class="map-legend"><span class="legend-star">STAR</span><span class="legend-planet">WORLD</span><span class="legend-station">STATION</span><span class="legend-player">YOU</span></div>
    </section>
    <section id="available-actions" class="available-actions" aria-label="Available actions" hidden>
      <p class="eyebrow">AVAILABLE ACTIONS</p>
      <button id="dock-action" type="button">DOCK AT KEPLER STATION</button>
    </section>
    <section id="docked-status" class="docked-status" aria-label="Station status" hidden>
      <p class="eyebrow">KEPLER STATION</p>
      <p>DOCKING BAY 04</p>
    </section>
    <footer class="controls">WASD <span>thrust</span> · SPACE/C <span>up/down</span> · RIGHT HOLD <span>turn to cursor</span> · F <span>flight assist</span></footer>
  </main>
`

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
if (!canvas) {
  throw new Error('Game canvas was not found.')
}

const speedDisplay = document.querySelector<HTMLElement>('#ship-speed')
const flightAssistDisplay = document.querySelector<HTMLElement>('#flight-assist')
const coordinateXDisplay = document.querySelector<HTMLElement>('#coordinate-x')
const coordinateYDisplay = document.querySelector<HTMLElement>('#coordinate-y')
const coordinateZDisplay = document.querySelector<HTMLElement>('#coordinate-z')
const playerMapMarker = document.querySelector<HTMLElement>('#player-map-marker')
const availableActions = document.querySelector<HTMLElement>('#available-actions')
const dockAction = document.querySelector<HTMLButtonElement>('#dock-action')
const dockedStatus = document.querySelector<HTMLElement>('#docked-status')
const systemStatus = document.querySelector<HTMLElement>('#system-status')
const systemMapRadius = 140_000

function mapCoordinate(value: number): string {
  const percentage = 50 + (value / systemMapRadius) * 50
  return `${Math.min(96, Math.max(4, percentage)).toFixed(2)}%`
}

let scene = createSystemScene(canvas, {
  onFlightUpdate(position, speed, flightAssistEnabled) {
    if (speedDisplay) speedDisplay.textContent = speed.toFixed(1)
    if (flightAssistDisplay) flightAssistDisplay.textContent = flightAssistEnabled ? 'ON' : 'OFF'
    if (coordinateXDisplay) coordinateXDisplay.textContent = position.x.toFixed(0)
    if (coordinateYDisplay) coordinateYDisplay.textContent = position.y.toFixed(0)
    if (coordinateZDisplay) coordinateZDisplay.textContent = position.z.toFixed(0)
    if (playerMapMarker) {
      playerMapMarker.style.left = mapCoordinate(position.x)
      playerMapMarker.style.top = mapCoordinate(-position.z)
    }
  },
  onDockingAvailabilityChange(isAvailable) {
    if (availableActions) availableActions.hidden = !isAvailable
  },
})

dockAction?.addEventListener('click', () => {
  scene.dispose()
  scene = createStationInteriorScene(canvas)
  availableActions?.setAttribute('hidden', '')
  dockedStatus?.removeAttribute('hidden')
  systemStatus?.setAttribute('hidden', '')
  document.querySelector('.game-shell')?.classList.add('is-docked')
})

if (import.meta.hot) {
  import.meta.hot.dispose(() => scene.dispose())
}

window.addEventListener('beforeunload', () => scene.dispose(), { once: true })
