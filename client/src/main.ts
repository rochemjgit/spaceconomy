import './style.css'
import './system-map.css'
import './warp.css'
import './target.css'
import './durability.css'
import './fitting.css'
import './core-systems.css'
import './station-services.css'
import './hardpoints.css'
import './inventory.css'
import { Vector3 } from '@babylonjs/core'
import { createStationInteriorScene, createSystemScene } from './game/scene'
import type { MiningExtractionResult, ServerAsteroid, ServerJettisonedItem } from './game/scene'
import stationInteriorUrl from './assets/station-interior.svg'
import refineryUrl from './assets/refinery.png'
import { escapeHtml, freeVolume, inventoryEntries, InventoryRequestGuard, parseInventoryDrag, quantityLimit, resolveInventoryEntry, validateQuantity } from './inventory'
import type { InventoryAction, InventoryContainer, InventoryEntry, InventorySelection, InventorySnapshot } from './inventory'
import { isEditingText } from './game/input'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Application root was not found.')
}
const appRoot = app

const apiBaseUrl = 'http://127.0.0.1:8000/api/v1'
const refreshTokenStorageKey = 'spaceconomy.refresh-token'
const rememberedEmailStorageKey = 'spaceconomy.remembered-email'
// Remove this local sign-in shortcut before any non-development distribution.
const enableDevelopmentCredentialFallback = import.meta.env.DEV
const developmentCredentials = { email: 'rochemj@gmail.com', password: 'spaceconomy' }

type SavedShipState = {
  position_x: number
  position_y: number
  position_z: number
  docked_station_name: string | null
  power_megajoules: number
  shields: number
  hull: number
  fuel_liters: number
  cargo_cubic_meters: number
}

type DockedInventory = {
  ship: InventoryContainer
  station: InventoryContainer
}

type FittingSnapshot = {
  ship_id: string
  hull_definition_id: string
  universal_hardpoint_count: number
  core_system_slot_count: number
  fitted_modules: { item_id: string; definition_id: string; display_name: string; family: string; slot_location: string; slot_index: number; durability: number; mass_kg: number }[]
  statistics: Record<string, number>
}

function renderAuthentication() {
  appRoot.innerHTML = `
    <main class="auth-launch" aria-labelledby="auth-title">
      <form id="auth-form" class="auth-panel">
        <p class="eyebrow">PILOT ACCESS</p>
        <h1 id="auth-title">ENTER SPACECONOMY</h1>
        <p class="auth-copy">Sign in to select a pilot.</p>
        <label>EMAIL<input id="auth-email" type="email" autocomplete="email" required maxlength="320"></label>
        <label>PASSWORD<input id="auth-password" type="password" autocomplete="current-password" required minlength="8" maxlength="256"></label>
        <label class="remember-me"><input id="remember-me" type="checkbox"> REMEMBER EMAIL AND SESSION</label>
        <p id="auth-error" class="auth-error" role="alert" hidden></p>
        <button id="auth-submit" class="auth-submit" type="submit">SIGN IN</button>
        <button id="create-account" class="auth-mode-toggle" type="button">CREATE ACCOUNT</button>
      </form>
    </main>
  `

  const form = document.querySelector<HTMLFormElement>('#auth-form')
  const email = document.querySelector<HTMLInputElement>('#auth-email')
  const password = document.querySelector<HTMLInputElement>('#auth-password')
  const rememberMe = document.querySelector<HTMLInputElement>('#remember-me')
  const error = document.querySelector<HTMLElement>('#auth-error')
  const submit = document.querySelector<HTMLButtonElement>('#auth-submit')
  const createAccount = document.querySelector<HTMLButtonElement>('#create-account')

  if (enableDevelopmentCredentialFallback) {
    email?.removeAttribute('required')
    password?.removeAttribute('required')
  }

  form?.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!email || !password || !submit) return
    void (async () => {
      const useDevelopmentCredentials = enableDevelopmentCredentialFallback && !email.value.trim() && !password.value
      const submittedEmail = useDevelopmentCredentials ? developmentCredentials.email : email.value
      const submittedPassword = useDevelopmentCredentials ? developmentCredentials.password : password.value
      submit.disabled = true
      error?.setAttribute('hidden', '')
      try {
        const response = await fetch(`${apiBaseUrl}/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: submittedEmail,
            password: submittedPassword,
          }),
        })
        const payload = await response.json() as {
          access_token?: string
          detail?: string
          pilots?: { id: string; display_name: string }[]
          refresh_token?: string
        }
        if (!response.ok || !payload.access_token || !payload.refresh_token || !payload.pilots) {
          if (error) {
            error.textContent = payload.detail ?? 'Unable to authenticate this pilot.'
            error.removeAttribute('hidden')
          }
          return
        }
        if (rememberMe?.checked) {
          localStorage.setItem(refreshTokenStorageKey, payload.refresh_token)
          localStorage.setItem(rememberedEmailStorageKey, submittedEmail)
        } else {
          sessionStorage.setItem(refreshTokenStorageKey, payload.refresh_token)
          localStorage.removeItem(refreshTokenStorageKey)
          localStorage.removeItem(rememberedEmailStorageKey)
        }
        renderPilotSelection(payload.access_token, payload.pilots)
      } catch {
        if (error) {
          error.textContent = 'The authentication service is unavailable.'
          error.removeAttribute('hidden')
        }
      } finally {
        submit.disabled = false
      }
    })()
  })
  createAccount?.addEventListener('click', renderAccountCreation)
  if (email) {
    email.value = localStorage.getItem(rememberedEmailStorageKey) ?? ''
    email.focus()
  }
}

function renderAccountCreation() {
  appRoot.innerHTML = `
    <main class="auth-launch" aria-labelledby="account-create-title">
      <form id="account-create-form" class="auth-panel">
        <p class="eyebrow">ACCOUNT REGISTRATION</p>
        <h1 id="account-create-title">CREATE ACCOUNT</h1>
        <p class="auth-copy">Confirm your email address to activate the account.</p>
        <label>FIRST NAME<input id="account-first-name" type="text" autocomplete="given-name" required maxlength="128"></label>
        <label>LAST NAME<input id="account-last-name" type="text" autocomplete="family-name" required maxlength="128"></label>
        <label>EMAIL<input id="account-email" type="email" autocomplete="email" required maxlength="320"></label>
        <label>PASSWORD<input id="account-password" type="password" autocomplete="new-password" required minlength="8" maxlength="256"></label>
        <label>CONFIRM PASSWORD<input id="account-confirm-password" type="password" autocomplete="new-password" required minlength="8" maxlength="256"></label>
        <p id="account-create-error" class="auth-error" role="alert" hidden></p>
        <button id="account-create-submit" class="auth-submit" type="submit">CREATE ACCOUNT</button>
        <button id="account-create-back" class="auth-mode-toggle" type="button">BACK TO SIGN IN</button>
      </form>
    </main>
  `
  const form = document.querySelector<HTMLFormElement>('#account-create-form')
  const firstName = document.querySelector<HTMLInputElement>('#account-first-name')
  const lastName = document.querySelector<HTMLInputElement>('#account-last-name')
  const email = document.querySelector<HTMLInputElement>('#account-email')
  const password = document.querySelector<HTMLInputElement>('#account-password')
  const confirmPassword = document.querySelector<HTMLInputElement>('#account-confirm-password')
  const error = document.querySelector<HTMLElement>('#account-create-error')
  const submit = document.querySelector<HTMLButtonElement>('#account-create-submit')

  form?.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!firstName || !lastName || !email || !password || !confirmPassword || !submit) return
    if (password.value !== confirmPassword.value) {
      if (error) {
        error.textContent = 'Passwords do not match.'
        error.removeAttribute('hidden')
      }
      return
    }
    void (async () => {
      submit.disabled = true
      error?.setAttribute('hidden', '')
      try {
        const response = await fetch(`${apiBaseUrl}/auth/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            first_name: firstName.value,
            last_name: lastName.value,
            email: email.value,
            password: password.value,
            confirm_password: confirmPassword.value,
          }),
        })
        const payload = await response.json() as {
          detail?: string
          message?: string
        }
        if (!response.ok) {
          if (error) {
            error.textContent = payload.detail ?? 'Unable to create this account.'
            error.removeAttribute('hidden')
          }
          return
        }
        renderAccountConfirmation(email.value, payload.message)
      } catch {
        if (error) {
          error.textContent = 'The authentication service is unavailable.'
          error.removeAttribute('hidden')
        }
      } finally {
        submit.disabled = false
      }
    })()
  })
  document.querySelector<HTMLButtonElement>('#account-create-back')?.addEventListener(
    'click', renderAuthentication,
  )
  email?.focus()
}

function renderAccountConfirmation(email: string, message?: string) {
  appRoot.innerHTML = `
    <main class="auth-launch" aria-labelledby="account-confirmation-title">
      <section class="auth-panel">
        <p class="eyebrow">CONFIRMATION REQUIRED</p>
        <h1 id="account-confirmation-title">CHECK YOUR EMAIL</h1>
        <p class="auth-copy">${message ?? `An activation link was sent to ${email}.`}</p>
        <button id="account-confirmation-back" class="auth-submit" type="button">BACK TO SIGN IN</button>
      </section>
    </main>
  `
  document.querySelector<HTMLButtonElement>('#account-confirmation-back')?.addEventListener(
    'click', renderAuthentication,
  )
}

function renderPilotCreation(accountAccessToken: string) {
  appRoot.innerHTML = `
    <main class="auth-launch" aria-labelledby="pilot-create-title">
      <form id="pilot-create-form" class="auth-panel">
        <p class="eyebrow">PILOT REGISTRY</p>
        <h1 id="pilot-create-title">CREATE YOUR PILOT</h1>
        <p class="auth-copy">Choose a name for your first pilot.</p>
        <label>PILOT NAME<input id="pilot-name" type="text" autocomplete="nickname" required minlength="1" maxlength="32"></label>
        <p id="pilot-create-error" class="auth-error" role="alert" hidden></p>
        <button id="pilot-create-submit" class="auth-submit" type="submit">CREATE PILOT</button>
      </form>
    </main>
  `
  const form = document.querySelector<HTMLFormElement>('#pilot-create-form')
  const name = document.querySelector<HTMLInputElement>('#pilot-name')
  const error = document.querySelector<HTMLElement>('#pilot-create-error')
  const submit = document.querySelector<HTMLButtonElement>('#pilot-create-submit')
  form?.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!name || !submit) return
    void (async () => {
      submit.disabled = true
      error?.setAttribute('hidden', '')
      try {
        const response = await fetch(`${apiBaseUrl}/auth/create-pilot`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accountAccessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ display_name: name.value }),
        })
        const payload = await response.json() as { id?: string; display_name?: string; detail?: string }
        if (!response.ok || !payload.id || !payload.display_name) {
          throw new Error(payload.detail ?? 'Unable to create this pilot.')
        }
        renderPilotSelection(accountAccessToken, [{ id: payload.id, display_name: payload.display_name }])
      } catch (reason) {
        submit.disabled = false
        if (error) {
          error.textContent = reason instanceof Error ? reason.message : 'Unable to create this pilot.'
          error.removeAttribute('hidden')
        }
      }
    })()
  })
  name?.focus()
}

function renderPilotSelection(
  accountAccessToken: string,
  pilots: { id: string; display_name: string }[],
) {
  let selectedPilot = pilots[0]
  if (!selectedPilot) {
    renderPilotCreation(accountAccessToken)
    return
  }
  appRoot.innerHTML = `
    <main class="auth-launch loading-room" aria-labelledby="loading-room-title">
      <section class="loading-room-panel">
        <div class="loading-room-heading">
          <div><p class="eyebrow">KEPLER STATION // LAUNCH BAY 04</p><h1 id="loading-room-title">PILOT READY</h1></div>
          <span class="loading-room-status"><i></i> LINK ESTABLISHED</span>
        </div>
        <div class="loading-room-content">
          <nav class="pilot-roster" aria-label="Pilot roster">
            <p class="eyebrow">PILOT ROSTER</p>
            ${pilots.map((pilot, index) => `<button class="pilot-select${index === 0 ? ' is-selected' : ''}" type="button" data-pilot-id="${pilot.id}">${pilot.display_name}</button>`).join('')}
          </nav>
          <section class="pilot-briefing" aria-live="polite">
            <p class="eyebrow">FLIGHT BRIEFING</p>
            <h2 id="loading-pilot-name">${selectedPilot.display_name}</h2>
            <p class="pilot-clearance">LICENSE: LOCAL SYSTEM EXPLORER</p>
            <dl class="pilot-statistics">
              <div><dt>ASSIGNED SHIP</dt><dd>STARTER CORVETTE</dd></div>
              <div><dt>HULL INTEGRITY</dt><dd>100%</dd></div>
              <div><dt>SHIELD CAPACITY</dt><dd>100 / 100</dd></div>
              <div><dt>FUEL RESERVE</dt><dd>80.00 L</dd></div>
              <div><dt>CARGO CAPACITY</dt><dd>0.00 / 24.00 M3</dd></div>
              <div><dt>LOCATION</dt><dd>KEPLER STATION</dd></div>
            </dl>
          </section>
        </div>
        <p id="pilot-select-error" class="auth-error" role="alert" hidden></p>
        <div class="loading-room-actions">
          <button id="pilot-select-launch" class="launch-button" type="button">LAUNCH</button>
          <button id="pilot-select-sign-out" class="exit-button" type="button">EXIT</button>
        </div>
      </section>
    </main>
  `
  const error = document.querySelector<HTMLElement>('#pilot-select-error')
  const launch = document.querySelector<HTMLButtonElement>('#pilot-select-launch')
  const name = document.querySelector<HTMLElement>('#loading-pilot-name')
  document.querySelectorAll<HTMLButtonElement>('[data-pilot-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const pilot = pilots.find((candidate) => candidate.id === button.dataset.pilotId)
      if (!pilot) return
      selectedPilot = pilot
      if (name) name.textContent = selectedPilot.display_name
      document.querySelectorAll<HTMLButtonElement>('[data-pilot-id]').forEach((candidate) => {
        candidate.classList.toggle('is-selected', candidate === button)
      })
      error?.setAttribute('hidden', '')
    })
  })
  launch?.addEventListener('click', () => {
    void (async () => {
      launch.disabled = true
      error?.setAttribute('hidden', '')
      try {
        const response = await fetch(`${apiBaseUrl}/auth/select-pilot`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accountAccessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ pilot_id: selectedPilot.id }),
        })
        const payload = await response.json() as { access_token?: string; ship_state?: SavedShipState }
        if (!response.ok || !payload.access_token || !payload.ship_state) {
          throw new Error('Pilot activation failed')
        }
        launchGame(payload.access_token, payload.ship_state, accountAccessToken, pilots, selectedPilot.id)
      } catch {
        launch.disabled = false
        if (error) {
          error.textContent = 'Unable to activate this pilot.'
          error.removeAttribute('hidden')
        }
      }
    })()
  })
  document.querySelector<HTMLButtonElement>('#pilot-select-sign-out')?.addEventListener('click', () => {
    clearStoredSession()
    renderAuthentication()
  })
}

function clearStoredSession() {
  sessionStorage.removeItem(refreshTokenStorageKey)
}

renderAuthentication()

function launchGame(
  pilotAccessToken: string,
  savedShipState: SavedShipState,
  accountAccessToken: string,
  pilots: { id: string; display_name: string }[],
  selectedPilotId: string,
) {
let lastRealtimeUpdateAt = 0
let locationTransitionPending = false
let locationTransitionError = ''
const starterHardpoints = [
  { moduleName: 'Mining Laser', icon: 'ML', name: 'MINING LASER' },
]

const hardpointSlotsMarkup = starterHardpoints.map((hardpoint, index) => `
  <button class="module-slot" type="button" disabled aria-pressed="false" aria-label="Hardpoint ${index + 1}: ${hardpoint.name}" data-hardpoint-index="${index + 1}" data-module="${hardpoint.moduleName}"><span class="module-key">${index + 1}</span><span class="module-icon">${hardpoint.icon}</span><span class="module-name">${hardpoint.name}</span></button>
`).join('')

appRoot.innerHTML = `
  <main class="game-shell">
    <canvas id="game-canvas" aria-label="Spaceconomy game world"></canvas>
    <div id="station-backdrop" class="station-backdrop" style="--station-scene-image: url('${stationInteriorUrl}')" hidden aria-hidden="true"></div>
    <section id="station-hotspots" class="station-hotspots" aria-label="Kepler Station services" hidden>
      <button class="station-service-button hotspot-market" type="button" data-station-service="market"><strong>MARKET</strong><span>BUY / SELL</span></button>
      <button class="station-service-button hotspot-maintenance" type="button" data-station-service="maintenance"><strong>MAINTENANCE</strong><span>REPAIR / RELOAD</span></button>
      <button class="station-service-button hotspot-fitting" type="button" data-station-service="fitting"><strong>FITTING</strong><span>MODULE SYSTEMS</span></button>
      <button class="station-service-button hotspot-refining" type="button" data-station-service="refining"><strong>REFINING</strong><span>ORE PROCESSING</span></button>
      <button class="station-service-button hotspot-crafting" type="button" data-station-service="crafting"><strong>CRAFTING</strong><span>WORKSTATIONS</span></button>
      <button class="station-service-button hotspot-inventory" type="button" data-station-service="inventory"><strong>INVENTORY</strong><span>SHIP / STATION</span></button>
      <button class="station-service-button hotspot-hangar" type="button" data-station-service="hangar"><strong>HANGAR</strong><span>STORED SHIPS</span></button>
    </section>
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
          <button class="core-system-icon" type="button" aria-label="Warp Drive: Class I core with 100 warp capacity, 2 capacity per second recharge, 10 kilometer per second maximum speed, and a calculated 450 kilometer range." data-core-system="warp" data-tooltip="ALT+1 WARP DRIVE: Start or exit free-flight warp."><span aria-hidden="true">WD</span></button>
          <button class="core-system-icon" type="button" aria-label="Sensors: active spherical scan for nearby asteroid fields." data-core-system="sensors" data-tooltip="ALT+2 SENSORS: Scan all directions for asteroid fields. Uses capacitor power."><span aria-hidden="true">SN</span></button>
          <button class="core-system-icon" type="button" aria-label="Reactor: Compact Fission Plant. Output 120 megawatts with 76 percent heat tolerance." data-tooltip="REACTOR: Compact Fission Plant. 120 MW output, 76% heat tolerance."><span aria-hidden="true">RP</span></button>
          <button class="core-system-icon" type="button" aria-label="Shield Generator: capacity 100, recharge 6 per second." data-tooltip="SHIELD GENERATOR: Capacity 100, recharge 6.0/s."><span aria-hidden="true">SG</span></button>
          <button class="core-system-icon" type="button" aria-label="Sublight Drive: conventional thrust and maneuvering." data-tooltip="SUBLIGHT DRIVE: 34 kN thrust, 92% turn response."><span aria-hidden="true">SL</span></button>
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
      <div class="durability-layer"><div class="durability-label"><span>WARP CAPACITY</span><strong id="ship-warp-capacity">100.00 / 100.00 WC</strong></div><span class="durability-bar"><span id="ship-warp-capacity-bar" class="durability-fill warp-capacity-fill"></span></span></div>
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
        <span id="map-asterion-belt" class="map-poi map-asteroid-belt" title="Asterion Belt - 240.0 km beyond Starter World" hidden></span>
        <span id="map-vesper-belt" class="map-poi map-asteroid-belt map-vesper-belt" title="Vesper Belt - remote cold-rock field" hidden></span>
        <span id="map-nadir-belt" class="map-poi map-asteroid-belt map-nadir-belt" title="Nadir Belt - outer trailing field" hidden></span>
        <span id="player-map-marker" class="player-map-marker" title="Your ship"></span>
      </div>
      <div class="map-legend"><span class="legend-star">STAR</span><span class="legend-planet">WORLD</span><span class="legend-station">STATION</span><span class="legend-belt">BELT</span><span class="legend-player">YOU</span></div>
    </section>
    <section id="target-window" class="target-window" aria-label="Selected target" hidden>
      <div class="target-window-heading"><p id="target-lock-label" class="eyebrow">TARGET LOCK</p><button id="clear-target" type="button" aria-label="Unlock target">×</button></div>
      <div id="target-thumbnail" class="target-thumbnail" aria-hidden="true"><span></span></div><div><p id="target-name" class="target-name"></p><p id="target-range" class="target-range"></p><button id="pickup-jettisoned-item" type="button" hidden>COLLECT CARGO</button></div></div>
      <p id="cargo-pickup-feedback" class="inventory-feedback" role="status"></p>
      <span id="target-lock-progress" class="target-lock-progress"><span></span></span>
    </section>
    <section class="target-list" aria-label="Target list">
      <header class="target-list-heading"><p class="eyebrow">TARGETS</p><button id="target-distance-sort" type="button" aria-label="Sort targets by nearest distance">RANGE ↑</button></header>
      <div id="target-list-filters" class="target-list-filters" aria-label="Target type filters">
        <button type="button" data-target-filter="player" aria-pressed="true">PLYR</button><button type="button" data-target-filter="asteroid" aria-pressed="true">AST</button><button type="button" data-target-filter="warpable" aria-pressed="true">WARP</button><button type="button" data-target-filter="station" aria-pressed="true">STN</button><button type="button" data-target-filter="planet" aria-pressed="true">PLNT</button>
      </div>
      <div id="target-list-items" class="target-list-items" role="list"></div>
    </section>
    <section id="available-actions" class="available-actions" aria-label="Available actions" hidden>
      <p class="eyebrow">AVAILABLE ACTIONS</p>
      <button id="dock-action" type="button">DOCK AT KEPLER STATION</button>
    </section>
    <section id="docked-status" class="docked-status" aria-label="Station status" hidden>
      <p class="eyebrow">KEPLER STATION</p>
      <p>DOCKING BAY 04</p>
      <p class="docked-terminal-hint">SELECT A MARKED STATION SERVICE</p>
      <p id="docked-transition-error" class="inventory-error" role="alert" hidden></p>
      <button id="undock-action" type="button">UNDOCK</button>
    </section>
    <section id="station-services" class="station-services" aria-label="Kepler Station services" hidden>
      <header class="station-services-heading"><div><p class="eyebrow">STATION SERVICES</p><h1>KEPLER STATION</h1></div><button id="exit-services-action" type="button">EXIT SERVICES</button></header>
      <div id="station-service-panel" class="station-service-panel">
        <button id="station-service-back" class="station-service-back" type="button">BACK TO SERVICES</button>
        <section data-station-panel="market" hidden><p class="eyebrow">MARKET EXCHANGE</p><h2>MARKET</h2><p class="station-service-empty">Buy and sell orders will load from the Kepler market. Purchases and sales settle through your Kepler station inventory.</p></section>
        <section data-station-panel="maintenance" hidden><p class="eyebrow">SHIPYARD SERVICES</p><h2>MAINTENANCE</h2><p class="station-service-empty">Repair prices, fuel, reload supplies, and crafted consumables require an authoritative docked-state snapshot.</p></section>
        <section id="fitting-panel" data-station-panel="fitting" hidden aria-live="polite"></section>
        <section class="refining-panel" data-station-panel="refining" style="--refinery-image: url('${refineryUrl}')" hidden><div class="refining-panel-content"><p class="eyebrow">REFINERY QUEUE</p><h2>REFINING</h2><p class="station-service-empty">Refining jobs and queue times will appear here when local inventory reservations are available.</p></div></section>
        <section data-station-panel="crafting" hidden><p class="eyebrow">MANUFACTURING WORKSTATIONS</p><h2>CRAFTING</h2><p class="station-service-empty">Crafting recipes, material reservations, and production queues will appear here when connected to the station worker service.</p></section>
        <section id="inventory-panel" class="inventory-panel" data-station-panel="inventory" hidden aria-live="polite"></section>
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
const stationBackdrop = document.querySelector<HTMLElement>('#station-backdrop')
const stationHotspots = document.querySelector<HTMLElement>('#station-hotspots')
const stationServices = document.querySelector<HTMLElement>('#station-services')
const undockAction = document.querySelector<HTMLButtonElement>('#undock-action')
const systemStatus = document.querySelector<HTMLElement>('#system-status')
const stationServicePanel = document.querySelector<HTMLElement>('#station-service-panel')
const inventoryPanel = document.querySelector<HTMLElement>('#inventory-panel')
const stationServiceButtons = document.querySelectorAll<HTMLButtonElement>('[data-station-service]')
const stationPanels = document.querySelectorAll<HTMLElement>('[data-station-panel]')
const stationServiceBack = document.querySelector<HTMLButtonElement>('#station-service-back')
const exitServicesAction = document.querySelector<HTMLButtonElement>('#exit-services-action')
const fittingPanel = document.querySelector<HTMLElement>('#fitting-panel')
const gameMenuToggle = document.querySelector<HTMLButtonElement>('#game-menu-toggle')
const gameMenuActions = document.querySelector<HTMLElement>('#game-menu-actions')
const gameModal = document.querySelector<HTMLElement>('#game-modal')
const gameModalEyebrow = document.querySelector<HTMLElement>('#game-modal-eyebrow')
const gameModalTitle = document.querySelector<HTMLElement>('#game-modal-title')
const gameModalContent = document.querySelector<HTMLElement>('#game-modal-content')
const gameModalActions = document.querySelector<HTMLElement>('#game-modal-actions')
const gameModalClose = document.querySelector<HTMLButtonElement>('#game-modal-close')
const moduleSlots = document.querySelectorAll<HTMLButtonElement>('[data-module]')
const coreSystemButtons = document.querySelectorAll<HTMLButtonElement>('[data-core-system]')
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
const targetThumbnail = document.querySelector<HTMLElement>('#target-thumbnail')
const targetName = document.querySelector<HTMLElement>('#target-name')
const targetRange = document.querySelector<HTMLElement>('#target-range')
const targetLockLabel = document.querySelector<HTMLElement>('#target-lock-label')
const targetLockProgress = document.querySelector<HTMLElement>('#target-lock-progress')
const clearTarget = document.querySelector<HTMLButtonElement>('#clear-target')
const targetListItems = document.querySelector<HTMLElement>('#target-list-items')
const targetDistanceSort = document.querySelector<HTMLButtonElement>('#target-distance-sort')
const targetListFilters = document.querySelectorAll<HTMLButtonElement>('[data-target-filter]')
const powerDisplay = document.querySelector<HTMLElement>('#ship-power')
const powerBar = document.querySelector<HTMLElement>('#ship-power-bar')
const warpCapacityDisplay = document.querySelector<HTMLElement>('#ship-warp-capacity')
const warpCapacityBar = document.querySelector<HTMLElement>('#ship-warp-capacity-bar')
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
let selectedTarget: { id?: string; name: string; kind: 'asteroid' | 'pilot' | 'cargo' | 'warpable' | 'station' | 'planet'; shipType?: string; jettisonedItemId?: string; position: Vector3; oreRemainingCubicMeters: number; initialOreCubicMeters: number; locked: boolean; locking: boolean; lockProgress: number } | undefined
let cargoCubicMeters = 0
let cargoCapacityCubicMeters = 24
let shipPowerMegajoules = savedShipState.power_megajoules
let shipShields = savedShipState.shields
let shipHull = savedShipState.hull
let shipFuelLiters = savedShipState.fuel_liters
const enabledTargetTypes = new Set(['player', 'asteroid', 'warpable', 'station', 'planet'])
let targetDistanceDescending = false
let lastTargetListRenderAt = 0

function formatTargetDistance(distanceMeters: number) {
  return distanceMeters >= 1_000 ? `${(distanceMeters / 1_000).toFixed(1)} km` : `${distanceMeters.toFixed(0)} m`
}

function renderTargetList() {
  const targets = scene.getTargetables?.() ?? []
  const visibleTargets = targets
    .filter((target) => enabledTargetTypes.has(target.kind))
    .map((target) => ({ ...target, distanceMeters: Vector3.Distance(target.position, new Vector3(playerMapPosition.x, playerMapPosition.y, playerMapPosition.z)) }))
    .sort((first, second) => targetDistanceDescending ? second.distanceMeters - first.distanceMeters : first.distanceMeters - second.distanceMeters)
  if (targetListItems) {
    targetListItems.innerHTML = visibleTargets.length
      ? visibleTargets.map((target) => {
        const state = target.locked ? 'locked' : selectedTarget?.id === target.id ? 'selected' : ''
        return `<button class="target-list-item target-list-item-${target.kind}${state ? ` is-${state}` : ''}" type="button" role="listitem" aria-pressed="${state !== ''}" data-target-id="${target.id}"><span class="target-list-type">${target.kind}</span><span class="target-list-name">${escapeHtml(target.name)}</span><span class="target-list-state">${state ? state.toUpperCase() : ''}</span><span class="target-list-range">${formatTargetDistance(target.distanceMeters)}</span></button>`
      }).join('')
      : '<p class="target-list-empty">NO TARGETS IN FILTER</p>'
  }
}

function selectTargetListItem(event: Event) {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-target-id]')
  if (target && targetListItems?.contains(target)) scene.selectTarget?.(target.dataset.targetId ?? '')
}

targetListItems?.addEventListener('pointerdown', selectTargetListItem)
targetListItems?.addEventListener('click', selectTargetListItem)

targetListFilters.forEach((filter) => {
  filter.addEventListener('click', () => {
    const targetType = filter.dataset.targetFilter
    if (!targetType) return
    if (enabledTargetTypes.has(targetType)) enabledTargetTypes.delete(targetType)
    else enabledTargetTypes.add(targetType)
    filter.setAttribute('aria-pressed', String(enabledTargetTypes.has(targetType)))
    renderTargetList()
  })
})
targetDistanceSort?.addEventListener('click', () => {
  targetDistanceDescending = !targetDistanceDescending
  targetDistanceSort.textContent = targetDistanceDescending ? 'RANGE ↓' : 'RANGE ↑'
  targetDistanceSort.setAttribute('aria-label', `Sort targets by ${targetDistanceDescending ? 'farthest' : 'nearest'} distance`)
  renderTargetList()
})

function renderSavedShipState() {
  cargoCubicMeters = savedShipState.cargo_cubic_meters
  if (powerDisplay) powerDisplay.textContent = `${shipPowerMegajoules.toFixed(2)} / 100.00 MJ`
  if (powerBar) powerBar.style.width = `${shipPowerMegajoules}%`
  if (shieldsDisplay) shieldsDisplay.textContent = `${Math.ceil(shipShields)}%`
  if (hullDisplay) hullDisplay.textContent = `${Math.ceil(shipHull)}%`
  if (shieldsBar) shieldsBar.style.width = `${shipShields}%`
  if (hullBar) hullBar.style.width = `${shipHull}%`
  if (fuelDisplay) fuelDisplay.textContent = `${shipFuelLiters.toFixed(2)} / 80.00 L`
  if (fuelBar) fuelBar.style.width = `${(shipFuelLiters / 80) * 100}%`
  if (cargoDisplay) cargoDisplay.textContent = `${cargoCubicMeters.toFixed(2)} / ${cargoCapacityCubicMeters.toFixed(2)} M3`
  if (cargoBar) cargoBar.style.width = `${(cargoCubicMeters / cargoCapacityCubicMeters) * 100}%`
}
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
  logout: { eyebrow: 'SESSION', title: 'LOG OUT', content: '<p class="modal-copy">End this flight session and return to the pilot screen?</p>', actions: '<button id="logout-cancel" class="modal-button" type="button">CANCEL</button><button id="logout-confirm" class="modal-button modal-button-primary" type="button">LOG OUT</button>' },
}

function closeGameModal() {
  invalidateInventoryView()
  gameModal?.setAttribute('hidden', '')
  if (gameModal) delete gameModal.dataset.view
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
  if (locationTransitionPending || !systemMapModal || gameModal?.hasAttribute('hidden') === false) return
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
  if (locationTransitionPending) return
  const content = modalContent[name]
  if (!gameModal || !gameModalEyebrow || !gameModalTitle || !gameModalContent || !gameModalActions) return
  invalidateInventoryView()
  gameModal.dataset.view = name
  gameModalEyebrow.textContent = content.eyebrow
  gameModalTitle.textContent = content.title
  gameModalContent.innerHTML = content.content
  gameModalActions.innerHTML = content.actions ?? ''
  gameModal.removeAttribute('hidden')
  gameModalClose?.focus()
  document.querySelector<HTMLButtonElement>('#logout-cancel')?.addEventListener('click', closeGameModal)
  document.querySelector<HTMLButtonElement>('#logout-confirm')?.addEventListener('click', () => void logout())
}

async function saveShipState(dockedStationName: string | null, position = playerMapPosition) {
  const response = await fetch(`${apiBaseUrl}/auth/ship-state`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${pilotAccessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        position_x: position.x,
        position_y: position.y,
        position_z: position.z,
        docked_station_name: dockedStationName,
        power_megajoules: shipPowerMegajoules,
        shields: shipShields,
        hull: shipHull,
        fuel_liters: shipFuelLiters,
        cargo_cubic_meters: cargoCubicMeters,
      }),
    })
  if (!response.ok) throw new Error(`Checkpoint rejected (HTTP ${response.status}): ${await response.text()}`)
}

async function logout() {
  if (inventoryLocked()) return
  try {
    await saveShipState(document.querySelector('.game-shell')?.classList.contains('is-docked') ? 'KEPLER STATION' : null)
  } catch (error) {
    if (gameModalContent) gameModalContent.textContent = `Unable to save before signing out: ${error instanceof Error ? error.message : 'Network error'}.`
    return
  }
  closeGameModal()
  realtimeSessionActive = false
  if (realtimeReconnectTimer !== undefined) window.clearTimeout(realtimeReconnectTimer)
  realtimeSocket?.close()
  window.removeEventListener('keydown', handleGameNavigationKeyDown)
  window.removeEventListener('keydown', handleHardpointKeyDown)
  scene.dispose()
  renderPilotSelection(accountAccessToken, pilots)
}

function openShipInventory() {
  if (locationTransitionPending) return
  if (!gameModal || !gameModalEyebrow || !gameModalTitle || !gameModalContent || !gameModalActions) return
  invalidateInventoryView()
  gameModal.dataset.view = 'inventory'
  selectedInventoryItem = null
  gameModalEyebrow.textContent = 'SHIP CARGO HOLD'
  gameModalTitle.textContent = 'INVENTORY'
  gameModalContent.innerHTML = '<p class="station-service-empty">Loading ship inventory...</p>'
  gameModalActions.innerHTML = ''
  gameModal.removeAttribute('hidden')
  gameModalClose?.focus()
  renderShipInventoryModal()
  void loadShipInventory()
}

let dockedInventory: DockedInventory | null = null
let shipInventorySnapshot: InventoryContainer | null = null
let fittingSnapshot: FittingSnapshot | null = null
let selectedFittingSlot: { location: string; index: number } | null = null
let selectedStationModuleId: string | null = null
let inventoryFilter = ''
let inventorySort: 'name' | 'volume' = 'name'
let selectedInventoryItem: InventorySelection | null = null
let inventoryBusy = false
let inventoryMessage = ''
let inventoryMessageIsError = false
let inventoryDialog: HTMLDialogElement | null = null
let inventoryViewRevision = 0
let draggedInventoryEntry: InventorySelection | null = null
const inventoryRequests = new InventoryRequestGuard()

function inventoryLocked(): boolean {
  return inventoryBusy || inventoryDialog !== null || locationTransitionPending
}

function activeInventoryView(): 'ship' | 'docked' | null {
  if (gameModal?.hidden === false && gameModal.dataset.view === 'inventory') return 'ship'
  if (gameModal?.hidden === false) return null
  if (stationServices?.hidden === false && inventoryPanel?.hidden === false) return 'docked'
  return null
}

function gameInputBlocked(): boolean {
  return locationTransitionPending || gameModal?.hidden === false || systemMapModal?.hidden === false || stationServices?.hidden === false || !!inventoryDialog?.open || isEditingText(document.activeElement)
}

function liveInventoryContainers(): InventoryContainer[] {
  if (!isInSystemSpace && dockedInventory) return [dockedInventory.ship, dockedInventory.station]
  return shipInventorySnapshot ? [shipInventorySnapshot] : []
}

function selectedInventoryEntry() {
  return resolveInventoryEntry(liveInventoryContainers(), selectedInventoryItem)
}

function applyInventorySnapshot(snapshot: InventorySnapshot) {
  inventoryRequests.invalidate()
  shipInventorySnapshot = snapshot.ship
  dockedInventory = snapshot.station ? { ship: snapshot.ship, station: snapshot.station } : null
  if (!selectedInventoryEntry()) selectedInventoryItem = null
  cargoCubicMeters = snapshot.ship.used_volume_cubic_meters
  cargoCapacityCubicMeters = snapshot.ship.capacity_cubic_meters ?? cargoCapacityCubicMeters
  scene.setCargoCubicMeters?.(cargoCubicMeters, cargoCapacityCubicMeters)
  if (cargoDisplay) cargoDisplay.textContent = `${cargoCubicMeters.toFixed(2)} / ${cargoCapacityCubicMeters.toFixed(2)} M3`
  if (cargoBar) cargoBar.style.width = `${cargoCapacityCubicMeters > 0 ? Math.min(100, cargoCubicMeters / cargoCapacityCubicMeters * 100) : 0}%`
}

function invalidateInventoryView() {
  inventoryRequests.invalidate()
  inventoryViewRevision += 1
  if (inventoryDialog) {
    const dialog = inventoryDialog
    inventoryDialog = null
    dialog.close()
    dialog.remove()
  }
  inventoryMessage = ''
  draggedInventoryEntry = null
}

function inventoryIcon(definitionId: string) {
  if (definitionId.includes('ore')) return 'OR'
  if (definitionId.includes('laser')) return 'ML'
  if (definitionId.includes('shield')) return 'SH'
  if (definitionId.includes('capacitor')) return 'CP'
  return 'IT'
}

function renderInventoryContainer(container: InventoryContainer, kind: 'ship' | 'station', showTransferAll = true) {
  const capacity = container.capacity_cubic_meters
  const percentage = capacity === null || capacity <= 0 ? 0 : Math.min(100, (container.used_volume_cubic_meters / capacity) * 100)
  const capacityLabel = capacity === null
    ? `${container.used_volume_cubic_meters.toFixed(1)} m3 / UNLIMITED`
    : `${container.used_volume_cubic_meters.toFixed(1)} / ${capacity.toFixed(1)} m3`
  const cargoTiles = inventoryEntries(container, inventoryFilter, inventorySort).map((entry) => {
    const selected = selectedInventoryItem?.id === entry.id && selectedInventoryItem.containerId === container.id && selectedInventoryItem.kind === entry.kind
    return `<button class="inventory-item${selected ? ' is-selected' : ''}" type="button" draggable="${showTransferAll && !inventoryLocked()}" ${inventoryLocked() ? 'disabled' : ''} data-entry-id="${escapeHtml(entry.id)}" data-entry-kind="${entry.kind}" data-inventory-source="${escapeHtml(container.id)}" aria-pressed="${selected}">
      <span class="inventory-item-icon" aria-hidden="true">${inventoryIcon(entry.kind === 'ore' ? 'ore.raw' : entry.item.definition_id)}</span>
      <span class="inventory-item-name">${escapeHtml(entry.name)}</span>
      <span class="inventory-item-quantity">${entry.kind === 'ore' ? 'LOT' : entry.item.quantity}</span>
      <span class="inventory-item-volume">${entry.volume.toFixed(3)} m³</span></button>`
  }).join('') || '<p class="inventory-empty">No matching items or ore lots.</p>'
  const destination = liveInventoryContainers().find((candidate) => candidate.id !== container.id)
  return `
    <section class="inventory-container" data-inventory-drop="${escapeHtml(container.id)}">
      <header class="inventory-container-heading"><div><p class="eyebrow">${kind === 'ship' ? 'ACTIVE VESSEL' : 'PERSONAL STORAGE'}</p><h3>${escapeHtml(container.name)}</h3></div><strong>${capacityLabel}</strong></header>
      <span class="inventory-capacity"><span style="width: ${percentage}%"></span></span>
      <div class="inventory-items">${cargoTiles}</div>
      ${showTransferAll && destination ? `<button class="inventory-transfer-all" type="button" ${inventoryLocked() ? 'disabled' : ''} data-transfer-all-source="${escapeHtml(container.id)}" data-transfer-all-destination="${escapeHtml(destination.id)}">TRANSFER ALL ${kind === 'ship' ? 'TO STATION' : 'TO SHIP'}</button>` : ''}
    </section>`
}

function renderShipInventoryModal() {
  if (activeInventoryView() !== 'ship' || !gameModalContent) return
  renderInventoryView(gameModalContent, false)
}

function renderDockedInventory() {
  if (activeInventoryView() !== 'docked' || !inventoryPanel) return
  renderInventoryView(inventoryPanel, true)
}

function renderActiveInventory() {
  renderShipInventoryModal()
  renderDockedInventory()
  const pickup = document.querySelector<HTMLButtonElement>('#pickup-jettisoned-item')
  if (pickup) pickup.disabled = inventoryLocked()
  if (inventoryLocked()) fittingPanel?.querySelectorAll<HTMLButtonElement>('#fit-selected-module, #unfit-selected-module').forEach((button) => { button.disabled = true })
}

function inventoryDetails(entry: InventoryEntry | undefined): string {
  if (!entry) return '<p>Select an item or ore lot to view details and actions.</p>'
  if (entry.kind === 'item') return `<h3>${escapeHtml(entry.name)}</h3><p>Condition: ${entry.item.durability.toFixed(1)} points · Definition version: ${entry.item.definition_version}</p><p>Module definition: ${escapeHtml(entry.item.module_definition_id ?? 'Not a module')}</p><p>Quantity: ${entry.item.quantity} · Unit volume: ${entry.item.volume_per_unit} m³ · Total: ${entry.volume} m³</p>`
  return `<h3>${escapeHtml(entry.name)}</h3><p>Source asteroid: ${escapeHtml(entry.lot.asteroid_id)} · Volume: ${entry.volume} m³</p><p>Assay (preserved by all inventory actions):</p><ul>${entry.lot.mineral_assay.map((mineral) => `<li>${escapeHtml(mineral.definition_id)}: ${mineral.percentage}%</li>`).join('') || '<li>No assay reported.</li>'}</ul>`
}

function renderInventoryView(scope: HTMLElement, docked: boolean) {
  const entry = selectedInventoryEntry()
  const focused = scope.contains(document.activeElement) ? document.activeElement as HTMLElement : null
  const focusKey = focused?.dataset.inventoryControl
  const selection = focused instanceof HTMLInputElement ? [focused.selectionStart, focused.selectionEnd] : null
  const disabled = (condition = false) => inventoryLocked() || condition ? 'disabled' : ''
  scope.setAttribute('aria-busy', String(inventoryLocked()))
  scope.innerHTML = `${docked ? '<h2>INVENTORY</h2>' : ''}
    <div class="inventory-tools"><label>FILTER <input data-inventory-control="filter" type="search" value="${escapeHtml(inventoryFilter)}" placeholder="ITEM, ORE OR MINERAL"></label>
    <div class="inventory-tool-actions">
      <button data-inventory-control="sort" type="button">SORT: ${inventorySort.toUpperCase()}</button>
      <button data-inventory-control="refresh" type="button" ${disabled()}>REFRESH</button>
      <button data-inventory-control="split" type="button" ${disabled(!entry || quantityLimit(entry, 'split') <= 0)}>SPLIT SELECTED</button>
      <button data-inventory-control="merge" type="button" ${disabled()}>MERGE ALL</button>
      ${docked ? `<button data-inventory-control="transfer" type="button" ${disabled(!entry)}>TRANSFER SELECTED</button>` : `<button data-inventory-control="jettison" type="button" ${disabled(!entry || !isInSystemSpace)}>JETTISON SELECTED</button>`}
    </div></div>
    <p class="inventory-feedback ${inventoryMessageIsError ? 'inventory-error' : ''}" role="${inventoryMessageIsError ? 'alert' : 'status'}">${inventoryBusy ? 'Inventory operation pending… ' : ''}${escapeHtml(inventoryMessage)}</p>
    ${docked && dockedInventory ? `<div class="inventory-layout">${renderInventoryContainer(dockedInventory.ship, 'ship')}${renderInventoryContainer(dockedInventory.station, 'station')}</div>` : shipInventorySnapshot ? renderInventoryContainer(shipInventorySnapshot, 'ship', false) : '<p>Inventory not loaded. Use Refresh.</p>'}
    <section class="inventory-details" aria-label="Selected inventory details">${inventoryDetails(entry)}</section>`
  scope.querySelector<HTMLInputElement>('[data-inventory-control="filter"]')?.addEventListener('input', (event) => {
    inventoryFilter = (event.target as HTMLInputElement).value
    renderActiveInventory()
  })
  const bind = (name: string, action: () => void) => scope.querySelector(`[data-inventory-control="${name}"]`)?.addEventListener('click', action)
  bind('sort', () => { inventorySort = inventorySort === 'name' ? 'volume' : 'name'; renderActiveInventory() })
  bind('refresh', () => void (docked ? loadDockedInventory() : loadShipInventory()))
  bind('split', () => openInventoryQuantityDialog('split'))
  bind('jettison', () => openInventoryQuantityDialog('jettison'))
  bind('transfer', () => openInventoryQuantityDialog('transfer'))
  bind('merge', () => void mutateInventory('merge-all'))
  scope.querySelectorAll<HTMLButtonElement>('[data-transfer-all-source]').forEach((button) => {
    button.addEventListener('click', () => void transferAll(button.dataset.transferAllSource, button.dataset.transferAllDestination))
  })
  scope.querySelectorAll<HTMLButtonElement>('[data-entry-id]').forEach((button) => {
    const identity: InventorySelection = { id: button.dataset.entryId!, kind: button.dataset.entryKind as 'item' | 'ore', containerId: button.dataset.inventorySource! }
    button.addEventListener('click', () => {
      if (inventoryLocked() || !resolveInventoryEntry(liveInventoryContainers(), identity)) return
      selectedInventoryItem = identity
      renderActiveInventory()
      scope.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus()
    })
    button.addEventListener('dragstart', (event) => {
      if (inventoryLocked() || !docked || !resolveInventoryEntry(liveInventoryContainers(), identity)) { event.preventDefault(); return }
      draggedInventoryEntry = identity
      event.dataTransfer?.setData('application/x-spaceconomy-inventory', JSON.stringify(identity))
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    })
    button.addEventListener('dragend', () => { draggedInventoryEntry = null; scope.querySelectorAll('.is-drop-target').forEach((target) => target.classList.remove('is-drop-target')) })
  })
  scope.querySelectorAll<HTMLElement>('[data-inventory-drop]').forEach((container) => {
    const destination = () => liveInventoryContainers().find((candidate) => candidate.id === container.dataset.inventoryDrop)
    container.addEventListener('dragover', (event) => {
      const dragged = resolveInventoryEntry(liveInventoryContainers(), draggedInventoryEntry)
      if (inventoryLocked() || !docked || !dragged || quantityLimit(dragged, 'transfer', destination()) <= 0) return
      event.preventDefault()
      container.classList.add('is-drop-target')
    })
    container.addEventListener('dragleave', () => container.classList.remove('is-drop-target'))
    container.addEventListener('drop', (event) => {
      event.preventDefault()
      container.classList.remove('is-drop-target')
      const identity = parseInventoryDrag(event.dataTransfer?.getData('application/x-spaceconomy-inventory') ?? '')
      if (inventoryLocked() || !docked || !identity || !draggedInventoryEntry || identity.id !== draggedInventoryEntry.id || identity.kind !== draggedInventoryEntry.kind || identity.containerId !== draggedInventoryEntry.containerId) return
      const dragged = resolveInventoryEntry(liveInventoryContainers(), identity)
      draggedInventoryEntry = null
      if (!dragged || quantityLimit(dragged, 'transfer', destination()) <= 0) { showInventoryError('Invalid transfer or destination is full.'); return }
      selectedInventoryItem = identity
      openInventoryQuantityDialog('transfer', destination()?.id)
    })
  })
  if (focusKey) {
    const replacement = scope.querySelector<HTMLElement>(`[data-inventory-control="${focusKey}"]`)
    replacement?.focus()
    if (replacement instanceof HTMLInputElement && selection) replacement.setSelectionRange(selection[0], selection[1])
  }
}

function showInventoryError(message: string) {
  if (!activeInventoryView()) return
  inventoryMessage = message
  inventoryMessageIsError = true
  renderActiveInventory()
}

async function loadDockedInventory() {
  await loadInventory('docked')
}

async function loadShipInventory(background = false) {
  await loadInventory('ship', background)
}

async function loadInventory(view: 'ship' | 'docked', background = false) {
  if (inventoryLocked() || (!background && activeInventoryView() !== view)) return
  const originalView = activeInventoryView()
  inventoryRequests.invalidate()
  const revision = inventoryRequests.capture()
  inventoryMessage = 'Refreshing inventory…'
  inventoryMessageIsError = false
  renderActiveInventory()
  try {
    const response = await fetch(`${apiBaseUrl}/inventory/${!isInSystemSpace ? 'docked' : view}`, { headers: { authorization: `Bearer ${pilotAccessToken}` } })
    if (!response.ok) throw new Error(await response.text())
    const payload = await response.json() as InventorySnapshot | InventoryContainer
    if (!inventoryRequests.isCurrent(revision) || inventoryLocked() || activeInventoryView() !== originalView) return
    applyInventorySnapshot('ship' in payload ? payload : { ship: payload, station: isInSystemSpace ? null : dockedInventory?.station ?? null })
    inventoryMessage = 'Inventory refreshed.'
    renderActiveInventory()
  } catch (error) {
    if (inventoryRequests.isCurrent(revision) && activeInventoryView() === view) showInventoryError(`Refresh failed: ${error instanceof Error ? error.message : 'Network error'}`)
  }
}

type InventoryMutationResult = InventorySnapshot & { moved_volume_cubic_meters?: number; remaining_stacks?: number; expires_at?: string }

async function mutateInventory(endpoint: string, body?: object): Promise<boolean> {
  if (inventoryLocked()) return false
  inventoryBusy = true
  inventoryRequests.invalidate()
  const viewRevision = inventoryRequests.capture()
  const viewIdentity = inventoryViewRevision
  const view = activeInventoryView()
  inventoryMessage = ''
  inventoryMessageIsError = false
  renderActiveInventory()
  try {
    const response = await fetch(`${apiBaseUrl}/inventory/${endpoint}`, {
      method: 'POST', headers: { authorization: `Bearer ${pilotAccessToken}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) throw new Error(await response.text())
    const payload = await response.json() as InventoryMutationResult
    const sameView = inventoryRequests.isCurrent(viewRevision) && activeInventoryView() === view
    applyInventorySnapshot(payload)
    if (sameView) inventoryMessage = payload.remaining_stacks !== undefined
      ? `Moved ${(payload.moved_volume_cubic_meters ?? 0).toFixed(3)} m³. ${payload.remaining_stacks} item stacks / ore lots left in source${payload.remaining_stacks ? ' (capacity limited; nothing discarded)' : ''}.`
      : payload.expires_at ? `Public cargo jettisoned. Expires ${new Date(payload.expires_at).toLocaleString()}.` : 'Inventory updated.'
    if (endpoint.includes('jettison')) {
      try { await refreshNearbyJettisonedItems() } catch { if (sameView && viewIdentity === inventoryViewRevision) inventoryMessage += ' World cargo refresh failed; inventory was saved.' }
    }
    return true
  } catch (error) {
    if (inventoryRequests.isCurrent(viewRevision) && activeInventoryView() === view) {
      showInventoryError(`Inventory action failed: ${error instanceof Error ? error.message : 'Network error'}. Outcome may be unknown; Refresh before trying again. No automatic retry.`)
    }
    return false
  } finally {
    inventoryBusy = false
    renderActiveInventory()
  }
}

async function transferAll(sourceId: string | undefined, destinationId: string | undefined) {
  const containers = liveInventoryContainers()
  if (isInSystemSpace || sourceId === destinationId || !containers.some((entry) => entry.id === sourceId) || !containers.some((entry) => entry.id === destinationId)) return
  await mutateInventory('transfer-all', { source_container_id: sourceId, destination_container_id: destinationId })
}

function openInventoryQuantityDialog(action: InventoryAction, destinationId?: string) {
  const entry = selectedInventoryEntry()
  if (inventoryLocked() || !entry || !activeInventoryView() || (action === 'jettison' && (!isInSystemSpace || entry.containerId !== shipInventorySnapshot?.id))) return
  const identity: InventorySelection = { kind: entry.kind, id: entry.id, containerId: entry.containerId }
  const destination = action === 'transfer' ? liveInventoryContainers().find((container) => destinationId ? container.id === destinationId : container.id !== entry.containerId) : undefined
  const maximum = quantityLimit(entry, action, destination)
  if (maximum <= 0) { showInventoryError('No valid quantity: the destination is full or this entry cannot be split.'); return }
  inventoryRequests.invalidate()
  const dialog = document.createElement('dialog')
  inventoryDialog = dialog
  renderActiveInventory()
  dialog.className = 'inventory-quantity-dialog'
  dialog.setAttribute('aria-labelledby', 'inventory-quantity-title')
  dialog.innerHTML = `<form novalidate><h2 id="inventory-quantity-title">${action.toUpperCase()} ${escapeHtml(entry.name)}</h2>
    ${destination ? `<p>Destination: ${escapeHtml(destination.name)}</p>` : ''}
    <label> ${entry.kind === 'ore' ? 'Volume (m³, decimal)' : 'Quantity (whole units)'}<input name="amount" type="text" inputmode="${entry.kind === 'ore' ? 'decimal' : 'numeric'}" autocomplete="off" value="${action === 'split' ? entry.kind === 'ore' ? entry.volume / 2 : 1 : maximum}" aria-describedby="inventory-quantity-preview" required></label>
    <button type="button" data-max>MAX</button><p id="inventory-quantity-preview" role="status"></p>
    ${action === 'jettison' ? '<p class="inventory-warning">Jettisoned cargo is immediately PUBLIC SALVAGE: anyone can collect it. It expires and is permanently lost when the server expiry timer ends.</p><label class="inventory-confirm-public"><input type="checkbox" name="public"> I confirm public jettison and the risk of permanent loss.</label>' : ''}
    <p class="inventory-dialog-error" role="alert"></p><div class="inventory-dialog-actions"><button type="button" data-cancel>CANCEL</button><button type="submit">${action === 'jettison' ? 'CONFIRM PUBLIC JETTISON' : 'CONFIRM'}</button></div></form>`
  document.body.append(dialog)
  const input = dialog.querySelector<HTMLInputElement>('[name="amount"]')!
  const confirm = dialog.querySelector<HTMLButtonElement>('[type="submit"]')!
  const preview = dialog.querySelector<HTMLElement>('#inventory-quantity-preview')!
  const publicConfirmation = dialog.querySelector<HTMLInputElement>('[name="public"]')
  const live = () => resolveInventoryEntry(liveInventoryContainers(), identity)
  const liveDestination = () => liveInventoryContainers().find((container) => container.id === destination?.id)
  const updatePreview = () => {
    const current = live()
    const amount = current ? validateQuantity(input.value, current, action, liveDestination()) : null
    const volume = amount === null ? 0 : amount * (current?.kind === 'item' ? current.item.volume_per_unit : 1)
    const target = liveDestination()
    const source = liveInventoryContainers().find((container) => container.id === current?.containerId)
    const sourceAfter = source ? Math.max(0, source.used_volume_cubic_meters - (action === 'split' ? 0 : volume)) : 0
    preview.textContent = `Max: ${current ? quantityLimit(current, action, target) : 0}. Selected: ${volume.toFixed(3)} m³. Source after: ${sourceAfter.toFixed(3)} / ${source?.capacity_cubic_meters ?? 'unlimited'} m³.${target ? freeVolume(target) === Infinity ? ' Destination capacity: unlimited.' : ` Destination after: ${(target.used_volume_cubic_meters + volume).toFixed(3)} / ${target.capacity_cubic_meters} m³.` : ''}`
    confirm.disabled = amount === null || (publicConfirmation !== null && !publicConfirmation.checked)
    dialog.querySelector<HTMLElement>('.inventory-dialog-error')!.textContent = amount === null ? 'Enter a positive valid amount within the displayed Max; splitting must leave some behind.' : ''
    return amount
  }
  input.addEventListener('input', updatePreview)
  publicConfirmation?.addEventListener('change', updatePreview)
  dialog.querySelector('[data-max]')?.addEventListener('click', () => { const current = live(); input.value = String(current ? quantityLimit(current, action, liveDestination()) : 0); updatePreview(); input.focus() })
  dialog.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.close())
  let submitted = false
  dialog.addEventListener('close', () => {
    dialog.remove()
    if (inventoryDialog !== dialog) return
    inventoryDialog = null
    if (!submitted) {
      renderActiveInventory()
      const scope = activeInventoryView() === 'ship' ? gameModalContent : inventoryPanel
      scope?.querySelector<HTMLButtonElement>(`[data-inventory-control="${action}"]`)?.focus()
    }
  }, { once: true })
  dialog.querySelector('form')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const amount = updatePreview()
    const current = live()
    if (submitted || confirm.disabled || amount === null || !current) return
    submitted = true
    const body = {
      ...(current.kind === 'ore' ? { lot_id: current.id, volume_cubic_meters: amount } : { item_id: current.id, quantity: amount }),
      ...(action === 'transfer' ? { source_container_id: current.containerId, destination_container_id: destination?.id } : action === 'split' ? { container_id: current.containerId } : { position_x: playerMapPosition.x, position_y: playerMapPosition.y, position_z: playerMapPosition.z }),
    }
    inventoryDialog = null
    dialog.close()
    dialog.remove()
    const viewIdentity = inventoryViewRevision
    void mutateInventory(`${current.kind === 'ore' ? 'ore/' : ''}${action}`, body).then(() => {
      if (viewIdentity !== inventoryViewRevision) return
      const scope = activeInventoryView() === 'ship' ? gameModalContent : inventoryPanel
      scope?.querySelector<HTMLButtonElement>(`[data-inventory-control="${action}"]`)?.focus()
    })
  })
  dialog.showModal()
  updatePreview()
  input.focus()
  input.select()
}

function renderDockedFitting() {
  if (!fittingPanel || !fittingSnapshot || !dockedInventory) return
  const slots = (location: string, count: number, label: string) => Array.from({ length: count }, (_, index) => {
    const fitted = fittingSnapshot?.fitted_modules.find((module) => module.slot_location === location && module.slot_index === index)
    const selected = selectedFittingSlot?.location === location && selectedFittingSlot.index === index
    return `<button class="live-fitting-slot${selected ? ' is-selected' : ''}" type="button" data-fitting-location="${location}" data-fitting-index="${index}" aria-pressed="${selected}"><span>${label} ${index + 1}</span><strong>${fitted?.display_name ?? 'EMPTY'}</strong>${fitted ? `<small>${fitted.mass_kg.toFixed(0)} kg · ${fitted.durability.toFixed(0)}%</small>` : ''}</button>`
  }).join('')
  const stationModules = dockedInventory.station.items
    .filter((item) => item.definition_id.startsWith('module.'))
    .map((item) => `<button class="live-module-item${selectedStationModuleId === item.id ? ' is-selected' : ''}" type="button" data-station-module="${item.id}" aria-pressed="${selectedStationModuleId === item.id}"><span class="inventory-item-icon" aria-hidden="true">${inventoryIcon(item.definition_id)}</span><strong>${item.definition_id.replace(/^module\./, '').replaceAll('_', ' ')}</strong><small>${item.volume_per_unit.toFixed(1)} m3 · ${item.durability.toFixed(0)}%</small></button>`)
    .join('') || '<p class="inventory-empty">No module objects in station storage.</p>'
  const selectedSlot = selectedFittingSlot
  const selectedFitted = selectedSlot
    ? fittingSnapshot.fitted_modules.find((module) => module.slot_location === selectedSlot.location && module.slot_index === selectedSlot.index)
    : undefined
  const statistics = fittingSnapshot.statistics
  fittingPanel.innerHTML = `
    <header class="inventory-heading"><div><p class="eyebrow">${fittingSnapshot.hull_definition_id.replace(/^hull\./, '').replaceAll('_', ' ')}</p><h2>SHIP FITTING</h2></div><p id="fitting-error" class="inventory-error" hidden></p></header>
    <div class="fitting-stat-strip"><span>CPU ${statistics.cpu_used.toFixed(0)} / ${statistics.cpu_available.toFixed(0)}</span><span>GRID ${statistics.powergrid_used.toFixed(0)} / ${statistics.powergrid_available.toFixed(0)}</span><span>MASS ${statistics.mass_kg.toFixed(0)} kg</span><span>ACCEL ${statistics.linear_acceleration.toFixed(2)} m/s2</span></div>
    <div class="live-fitting-layout"><section><p class="eyebrow">UNIVERSAL HARDPOINTS</p><div class="live-fitting-slots">${slots('universal_hardpoint', fittingSnapshot.universal_hardpoint_count, 'HP')}</div><p class="eyebrow">CORE SYSTEMS</p><div class="live-fitting-slots">${slots('core_system', fittingSnapshot.core_system_slot_count, 'CORE')}</div><div class="live-fitting-actions"><button id="fit-selected-module" type="button" ${selectedStationModuleId && selectedFittingSlot && !selectedFitted ? '' : 'disabled'}>FIT SELECTED MODULE</button><button id="unfit-selected-module" type="button" ${selectedFitted ? '' : 'disabled'}>UNFIT SELECTED MODULE</button></div></section><section><p class="eyebrow">KEPLER STATION MODULE OBJECTS</p><div class="live-module-items">${stationModules}</div></section></div>`
  fittingPanel.querySelectorAll<HTMLButtonElement>('[data-fitting-location]').forEach((slot) => {
    slot.addEventListener('click', () => {
      selectedFittingSlot = { location: slot.dataset.fittingLocation ?? '', index: Number(slot.dataset.fittingIndex) }
      renderDockedFitting()
    })
  })
  fittingPanel.querySelectorAll<HTMLButtonElement>('[data-station-module]').forEach((module) => {
    module.addEventListener('click', () => {
      selectedStationModuleId = module.dataset.stationModule ?? null
      renderDockedFitting()
    })
  })
  fittingPanel.querySelector<HTMLButtonElement>('#fit-selected-module')?.addEventListener('click', () => void fitSelectedModule())
  fittingPanel.querySelector<HTMLButtonElement>('#unfit-selected-module')?.addEventListener('click', () => void unfitSelectedModule())
  if (inventoryLocked()) fittingPanel.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = true })
}

function showFittingError(message: string) {
  const error = fittingPanel?.querySelector<HTMLElement>('#fitting-error')
  if (!error) return
  error.textContent = message
  error.removeAttribute('hidden')
}

async function loadDockedFitting() {
  if (inventoryLocked() || isInSystemSpace) return
  const revision = inventoryRequests.capture()
  if (fittingPanel) fittingPanel.innerHTML = '<p class="station-service-empty">Loading fitted modules...</p>'
  const [fittingResponse, inventoryResponse] = await Promise.all([
    fetch(`${apiBaseUrl}/fitting/docked`, { headers: { authorization: `Bearer ${pilotAccessToken}` } }),
    fetch(`${apiBaseUrl}/inventory/docked`, { headers: { authorization: `Bearer ${pilotAccessToken}` } }),
  ])
  if (!fittingResponse.ok || !inventoryResponse.ok) throw new Error('Unable to load docked fitting.')
  const fitting = await fittingResponse.json() as FittingSnapshot
  const inventory = await inventoryResponse.json() as InventorySnapshot
  if (!inventoryRequests.isCurrent(revision) || inventoryLocked() || isInSystemSpace || stationServices?.hidden !== false || fittingPanel?.hidden !== false) return
  fittingSnapshot = fitting
  applyInventorySnapshot(inventory)
  selectedFittingSlot ??= { location: 'universal_hardpoint', index: 0 }
  selectedStationModuleId = null
  renderDockedFitting()
}

async function fitSelectedModule() {
  if (!selectedStationModuleId || !selectedFittingSlot) return
  await mutateFitting('fit', { item_id: selectedStationModuleId, slot_location: selectedFittingSlot.location, slot_index: selectedFittingSlot.index })
}

async function unfitSelectedModule() {
  if (!selectedFittingSlot) return
  await mutateFitting('unfit', { slot_location: selectedFittingSlot.location, slot_index: selectedFittingSlot.index })
}

async function mutateFitting(endpoint: 'fit' | 'unfit', body: object) {
  if (inventoryLocked() || isInSystemSpace) return
  inventoryBusy = true
  inventoryRequests.invalidate()
  renderActiveInventory()
  let failure = ''
  try {
    const response = await fetch(`${apiBaseUrl}/fitting/${endpoint}`, {
      method: 'POST', headers: { authorization: `Bearer ${pilotAccessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(await response.text())
    fittingSnapshot = await response.json() as FittingSnapshot
    selectedStationModuleId = null
  } catch (error) {
    failure = `Fitting action failed: ${error instanceof Error ? error.message : 'Network error'}. Refresh before retrying.`
  } finally {
    inventoryBusy = false
    renderActiveInventory()
    renderDockedFitting()
  }
  if (failure) { showFittingError(failure); return }
  try {
    await loadDockedFitting()
  } catch {
    showFittingError('Fitting saved, but inventory refresh failed. Reopen fitting to refresh.')
  }
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
const handleGameNavigationKeyDown = (event: KeyboardEvent) => {
  if (locationTransitionPending || inventoryDialog?.open || isEditingText(event.target)) return
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
}
window.addEventListener('keydown', handleGameNavigationKeyDown)
systemMapClose?.addEventListener('click', closeSystemMap)
document.querySelector<HTMLElement>('[data-system-map-close]')?.addEventListener('click', closeSystemMap)
systemPois.forEach((poi) => poi.addEventListener('click', () => selectPoi(poi.dataset.poi as PoiName)))
warpAction?.addEventListener('click', () => {
  if (locationTransitionPending) return
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
  if (!selectedTarget || slot.disabled) {
    if (collisionAlert) collisionAlert.textContent = 'MINING LASER: SELECT AN ASTEROID FIRST'
    return
  }
  if (!selectedTarget.locked) {
    scene.toggleTargetLock()
    if (collisionAlert) collisionAlert.textContent = 'MINING LASER: ACQUIRING TARGET LOCK'
  }
  const isActive = slot.getAttribute('aria-pressed') === 'true'
  const nextIsActive = !isActive
  slot.setAttribute('aria-pressed', String(nextIsActive))
  slot.classList.toggle('is-active', nextIsActive)
  scene.setModuleActive(slot.dataset.module ?? '', nextIsActive)
  if (collisionAlert) {
    collisionAlert.textContent = nextIsActive ? 'MINING LASER: ACTIVE' : 'MINING LASER: STANDBY'
  }
}

moduleSlots.forEach((slot) => slot.addEventListener('click', () => toggleHardpoint(slot)))

const handleHardpointKeyDown = (event: KeyboardEvent) => {
  if (gameInputBlocked() || isEditingText(event.target)) return
  if (event.altKey || event.repeat || !/^[1-9]$/.test(event.key)) return
  const slot = Array.from(moduleSlots).find((hardpoint) => hardpoint.dataset.hardpointIndex === event.key)
  if (!slot || slot.disabled) return
  event.preventDefault()
  toggleHardpoint(slot)
}
window.addEventListener('keydown', handleHardpointKeyDown)

function updateHardpointAvailability() {
  const hasTarget = selectedTarget?.kind === 'asteroid'
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
  if (!targetWindow || !targetName || !targetRange || !targetLockLabel || !targetLockProgress) return
  if (!selectedTarget) {
    targetWindow.setAttribute('hidden', '')
    return
  }
  targetLockLabel.textContent = selectedTarget.locking ? 'ACQUIRING LOCK' : selectedTarget.locked ? 'TARGET LOCK' : 'TARGET SELECTED'
  targetName.textContent = selectedTarget.name
  targetThumbnail?.classList.toggle('is-ship', selectedTarget.kind === 'pilot')
  targetThumbnail?.setAttribute('data-ship-type', selectedTarget.kind === 'pilot' ? selectedTarget.shipType ?? 'starter-corvette' : '')
  const distance = Vector3.Distance(new Vector3(playerMapPosition.x, playerMapPosition.y, playerMapPosition.z), selectedTarget.position)
  targetRange.textContent = distance >= 1_000 ? `${(distance / 1_000).toFixed(1)} km` : `${distance.toFixed(0)} m`
  targetLockProgress.toggleAttribute('hidden', !selectedTarget.locking)
  targetLockProgress.firstElementChild?.setAttribute('style', `width: ${(selectedTarget.lockProgress * 100).toFixed(1)}%`)
  document.querySelector<HTMLButtonElement>('#pickup-jettisoned-item')?.toggleAttribute('hidden', selectedTarget.kind !== 'cargo')
  targetWindow.removeAttribute('hidden')
}

clearTarget?.addEventListener('click', () => {
  scene.clearTargetSelection?.()
})

document.querySelector<HTMLButtonElement>('#pickup-jettisoned-item')?.addEventListener('click', () => {
  if (inventoryLocked()) return
  const feedback = document.querySelector<HTMLElement>('#cargo-pickup-feedback')
  if (feedback) feedback.textContent = 'Collecting public cargo…'
  void scene.pickupJettisonedItem?.().then((collected) => {
    if (feedback) feedback.textContent = collected ? 'Cargo collected.' : 'Collection failed or outcome unknown. Refresh inventory before trying again.'
  })
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

function createFlightScene(
  initialLaunchSpeed = 0,
  initialFlightAssistEnabled = true,
  initialPosition = new Vector3(
    savedShipState.position_x,
    savedShipState.position_y,
    savedShipState.position_z,
  ),
) {
  return createSystemScene(gameCanvas, {
    isInputBlocked: gameInputBlocked,
    isSimulationPaused: () => locationTransitionPending,
    initialPosition,
    initialPowerMegajoules: shipPowerMegajoules,
    initialShields: shipShields,
    initialHull: shipHull,
    initialFuelLiters: shipFuelLiters,
    initialCargoCubicMeters: cargoCubicMeters,
    initialMaximumCargoCubicMeters: cargoCapacityCubicMeters,
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
      renderTargetList()
      updateHardpointAvailability()
    },
    onModuleActiveChange(moduleName, isActive) {
      const moduleSlot = Array.from(moduleSlots).find((slot) => slot.dataset.module === moduleName)
      if (!moduleSlot) return
      moduleSlot.setAttribute('aria-pressed', String(isActive))
      moduleSlot.classList.toggle('is-active', isActive)
    },
    onMiningLaserUpdate(active, source, target) {
      if (realtimeSocket?.readyState === WebSocket.OPEN && ((source && target) || !active)) {
        realtimeSocket.send(JSON.stringify({ type: 'mining', payload: { active, source_x: source?.x ?? 0, source_y: source?.y ?? 0, source_z: source?.z ?? 0, target_x: target?.x ?? 0, target_y: target?.y ?? 0, target_z: target?.z ?? 0 } }))
      }
    },
    async onAsteroidExtraction(asteroidId, position): Promise<MiningExtractionResult | undefined> {
      if (inventoryLocked()) return undefined
      inventoryBusy = true
      inventoryRequests.invalidate()
      renderActiveInventory()
      try {
      const response = await fetch(`${apiBaseUrl}/mining/extract`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${pilotAccessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          asteroid_id: asteroidId,
          position_x: position.x,
          position_y: position.y,
          position_z: position.z,
        }),
      })
      if (!response.ok) return undefined
      const payload = await response.json() as {
        asteroid_id: string
        extracted_ore_cubic_meters: number
        remaining_ore_cubic_meters: number
        cargo_cubic_meters: number
      }
      return {
        asteroidId: payload.asteroid_id,
        extractedOreCubicMeters: payload.extracted_ore_cubic_meters,
        remainingOreCubicMeters: payload.remaining_ore_cubic_meters,
        cargoCubicMeters: payload.cargo_cubic_meters,
      }
      } catch {
        showInventoryError('Mining update failed. Refresh inventory to reconcile cargo.')
        return undefined
      } finally {
        inventoryBusy = false
        renderActiveInventory()
      }
    },
    onInventoryChanged() {
      if (gameModal?.hasAttribute('hidden') === false && gameModalTitle?.textContent === 'INVENTORY') {
        void loadShipInventory()
      }
    },
    async onJettisonedItemPickup(jettisonedItemId, position) {
      return mutateInventory('jettisoned/pickup', { jettisoned_item_id: jettisonedItemId, position_x: position.x, position_y: position.y, position_z: position.z })
    },
    onPilotTargetLockChange(targetPilotId, active) {
      if (realtimeSocket?.readyState === WebSocket.OPEN) {
        realtimeSocket.send(JSON.stringify({ type: 'targeting', payload: { target_pilot_id: targetPilotId, active } }))
      }
    },
    onShipStatusChange(status) {
      cargoCubicMeters = status.cargoCubicMeters
      cargoCapacityCubicMeters = status.maximumCargoCubicMeters
      shipPowerMegajoules = status.powerMegajoules
      shipShields = status.shields
      shipHull = status.hull
      shipFuelLiters = status.fuelLiters
      if (powerDisplay) powerDisplay.textContent = `${status.powerMegajoules.toFixed(2)} / ${status.maximumPowerMegajoules.toFixed(2)} MJ`
      if (powerBar) powerBar.style.width = `${(status.powerMegajoules / status.maximumPowerMegajoules) * 100}%`
      if (warpCapacityDisplay) warpCapacityDisplay.textContent = `${status.warpCapacity.toFixed(2)} / ${status.maximumWarpCapacity.toFixed(2)} WC`
      if (warpCapacityBar) warpCapacityBar.style.width = `${(status.warpCapacity / status.maximumWarpCapacity) * 100}%`
      warpCapacityBar?.setAttribute('title', `Maximum range: ${status.maximumWarpRangeKilometers.toFixed(0)} km`)
      if (shieldsDisplay) shieldsDisplay.textContent = `${Math.ceil(status.shields)}%`
      if (hullDisplay) hullDisplay.textContent = `${Math.ceil(status.hull)}%`
      if (shieldsBar) shieldsBar.style.width = `${status.shields}%`
      if (hullBar) hullBar.style.width = `${status.hull}%`
      if (fuelDisplay) fuelDisplay.textContent = `${status.fuelLiters.toFixed(2)} / ${status.maximumFuelLiters.toFixed(2)} L`
      if (fuelBar) fuelBar.style.width = `${(status.fuelLiters / status.maximumFuelLiters) * 100}%`
      if (cargoDisplay) cargoDisplay.textContent = `${status.cargoCubicMeters.toFixed(2)} / ${status.maximumCargoCubicMeters.toFixed(2)} M3`
      if (cargoBar) cargoBar.style.width = `${(status.cargoCubicMeters / status.maximumCargoCubicMeters) * 100}%`
      if (collisionAlert) collisionAlert.textContent = locationTransitionError || (status.collisionName ? `IMPACT: ${status.collisionName}` : '')
      shipDestroyedOverlay?.toggleAttribute('hidden', !status.destroyed)
      if (destructionCause) destructionCause.textContent = status.destroyed && status.collisionName ? `Collision with ${status.collisionName}` : ''
    },
    onFlightUpdate(position, speed, flightAssistEnabled, yaw, pitch, roll, miningSource, miningTarget) {
      if (speedDisplay) speedDisplay.textContent = speed.toFixed(1)
      if (flightAssistDisplay) flightAssistDisplay.textContent = flightAssistEnabled ? 'ON' : 'OFF'
      if (coordinateXDisplay) coordinateXDisplay.textContent = position.x.toFixed(0)
      if (coordinateYDisplay) coordinateYDisplay.textContent = position.y.toFixed(0)
      if (coordinateZDisplay) coordinateZDisplay.textContent = position.z.toFixed(0)
      playerMapPosition = { x: position.x, y: position.y, z: position.z }
      positionMapMarker(playerMapMarker, position.x, position.z)
      updateTargetWindow()
      if (performance.now() - lastTargetListRenderAt >= 250) {
        lastTargetListRenderAt = performance.now()
        renderTargetList()
      }
      updateSelectedPoiDetails()
      if (performance.now() - lastAsteroidSnapshotAt >= 3_000) {
        lastAsteroidSnapshotAt = performance.now()
        void refreshNearbyAsteroids()
        void refreshNearbyJettisonedItems()
      }
      if (realtimeSocket?.readyState === WebSocket.OPEN && performance.now() - lastRealtimeUpdateAt >= 100) {
        lastRealtimeUpdateAt = performance.now()
        realtimeSocket.send(JSON.stringify({ type: 'movement', payload: { x: position.x, y: position.y, z: position.z, yaw, pitch, roll } }))
        if (miningSource && miningTarget) {
          realtimeSocket.send(JSON.stringify({ type: 'mining', payload: { active: true, source_x: miningSource.x, source_y: miningSource.y, source_z: miningSource.z, target_x: miningTarget.x, target_y: miningTarget.y, target_z: miningTarget.z } }))
        }
      }
    },
    onDockingAvailabilityChange(isAvailable) {
      if (availableActions) availableActions.hidden = !isAvailable
    },
  })
}

playerMapPosition = {
  x: savedShipState.position_x,
  y: savedShipState.position_y,
  z: savedShipState.position_z,
}
renderSavedShipState()
let isInSystemSpace = !savedShipState.docked_station_name
let lastAsteroidSnapshotAt = 0
// Initialize before constructing a scene: its callbacks can reference this socket.
const realtimeUrl = `${apiBaseUrl.replace(/^http/, 'ws').replace('/api/v1', '')}/api/v1/realtime?token=${encodeURIComponent(pilotAccessToken)}`
let realtimeSocket: WebSocket | null = null
let realtimeReconnectTimer: number | undefined
let realtimeSessionActive = true
let scene = createFlightScene()
renderTargetList()

const discoveredFieldMarkers: Record<string, HTMLElement | null> = {
  'ASTERION BELT': mapAsterionBelt,
  'VESPER BELT': mapVesperBelt,
  'NADIR DEBRIS FIELD': mapNadirBelt,
}

function revealDiscoveredFields(fields: { display_name: string }[]) {
  fields.forEach((field) => discoveredFieldMarkers[field.display_name]?.removeAttribute('hidden'))
}

async function loadDiscoveryBootstrap() {
  const response = await fetch(`${apiBaseUrl}/mining/bootstrap`, {
    headers: { authorization: `Bearer ${pilotAccessToken}` },
  })
  if (!response.ok) return
  const payload = await response.json() as { discovered_fields: { display_name: string }[] }
  revealDiscoveredFields(payload.discovered_fields)
}

async function refreshNearbyAsteroids() {
  if (!isInSystemSpace) return
  const query = new URLSearchParams({
    position_x: playerMapPosition.x.toString(),
    position_y: playerMapPosition.y.toString(),
    position_z: playerMapPosition.z.toString(),
  })
  const response = await fetch(`${apiBaseUrl}/mining/asteroids?${query}`, {
    headers: { authorization: `Bearer ${pilotAccessToken}` },
  })
  if (!response.ok) return
  const payload = await response.json() as { id: string; position_x: number; position_y: number; position_z: number; radius_meters: number; composition: string; initial_volume_cubic_meters: number; remaining_volume_cubic_meters: number }[]
  const asteroids: ServerAsteroid[] = payload.map((asteroid) => ({
    id: asteroid.id,
    position: new Vector3(asteroid.position_x, asteroid.position_y, asteroid.position_z),
    radius: asteroid.radius_meters,
    composition: asteroid.composition,
    initialOreCubicMeters: asteroid.initial_volume_cubic_meters,
    remainingOreCubicMeters: asteroid.remaining_volume_cubic_meters,
  }))
  scene.replaceAsteroids?.(asteroids)
}

async function refreshNearbyJettisonedItems() {
  if (!isInSystemSpace) return
  const query = new URLSearchParams({
    position_x: playerMapPosition.x.toString(),
    position_y: playerMapPosition.y.toString(),
    position_z: playerMapPosition.z.toString(),
  })
  const response = await fetch(`${apiBaseUrl}/inventory/jettisoned?${query}`, {
    headers: { authorization: `Bearer ${pilotAccessToken}` },
  })
  if (!response.ok) return
  const payload = await response.json() as {
    id: string
    definition_id: string
    quantity: number
    position_x: number
    position_y: number
    position_z: number
  }[]
  const items: ServerJettisonedItem[] = payload.map((item) => ({
    id: item.id,
    definitionId: item.definition_id,
    quantity: item.quantity,
    position: new Vector3(item.position_x, item.position_y, item.position_z),
  }))
  scene.replaceJettisonedItems?.(items)
}

async function runSensorScan() {
  const sensorButton = document.querySelector<HTMLButtonElement>('[data-core-system="sensors"]')
  if (sensorButton?.disabled || !isInSystemSpace) return
  sensorButton?.setAttribute('aria-busy', 'true')
  try {
    const response = await fetch(`${apiBaseUrl}/mining/scan`, {
      method: 'POST',
      headers: { authorization: `Bearer ${pilotAccessToken}` },
    })
    if (!response.ok) return
    const payload = await response.json() as { newly_discovered_fields: { display_name: string }[] }
    scene.emitSensorPing?.()
    revealDiscoveredFields(payload.newly_discovered_fields)
    void refreshNearbyAsteroids()
  } finally {
    sensorButton?.removeAttribute('aria-busy')
  }
}

coreSystemButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (locationTransitionPending) return
    if (button.dataset.coreSystem === 'warp') scene.toggleWarp?.()
    if (button.dataset.coreSystem === 'sensors') void runSensorScan()
  })
})

window.addEventListener('keydown', (event) => {
  if (gameInputBlocked() || isEditingText(event.target)) return
  if (!event.altKey || event.repeat) return
  if (event.key === '1') {
    event.preventDefault()
    scene.toggleWarp?.()
  }
  if (event.key === '2') {
    event.preventDefault()
    void runSensorScan()
  }
})

function connectRealtime() {
  if (!realtimeSessionActive || realtimeSocket?.readyState === WebSocket.OPEN || realtimeSocket?.readyState === WebSocket.CONNECTING) return
  const socket = new WebSocket(realtimeUrl)
  realtimeSocket = socket
  socket.addEventListener('open', () => {
    if (!isInSystemSpace) socket.send(JSON.stringify({ type: 'docked', payload: {} }))
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data) as { type: string; payload: { pilots?: { pilot_id: string; display_name: string; ship_type: string; x: number; y: number; z: number; yaw: number; pitch: number; roll: number }[]; pilot_id?: string; target_pilot_id?: string; display_name?: string; ship_type?: string; x?: number; y?: number; z?: number; yaw?: number; pitch?: number; roll?: number; active?: boolean; source_x?: number; source_y?: number; source_z?: number; target_x?: number; target_y?: number; target_z?: number } }
    if (message.type === 'snapshot') {
      message.payload.pilots?.forEach((pilot) => scene.updateRemotePilot?.({ pilotId: pilot.pilot_id, displayName: pilot.display_name, shipType: pilot.ship_type, position: new Vector3(pilot.x, pilot.y, pilot.z), yaw: pilot.yaw, pitch: pilot.pitch, roll: pilot.roll }))
      return
    }
    if (message.type === 'pilot_left' && message.payload.pilot_id) {
      scene.removeRemotePilot?.(message.payload.pilot_id)
      return
    }
    if (message.type === 'pilot_mining' && message.payload.pilot_id && message.payload.active !== undefined && message.payload.source_x !== undefined && message.payload.source_y !== undefined && message.payload.source_z !== undefined && message.payload.target_x !== undefined && message.payload.target_y !== undefined && message.payload.target_z !== undefined) {
      scene.setRemotePilotMining?.(message.payload.pilot_id, message.payload.active, new Vector3(message.payload.source_x, message.payload.source_y, message.payload.source_z), new Vector3(message.payload.target_x, message.payload.target_y, message.payload.target_z))
      return
    }
    if (message.type === 'pilot_targeting' && message.payload.target_pilot_id === selectedPilotId) {
      scene.setHostileTargeting?.(message.payload.pilot_id ?? '', message.payload.active === true)
      return
    }
    if ((message.type === 'pilot_joined' || message.type === 'pilot_moved') && message.payload.pilot_id && message.payload.display_name && message.payload.ship_type && message.payload.x !== undefined && message.payload.y !== undefined && message.payload.z !== undefined && message.payload.yaw !== undefined && message.payload.pitch !== undefined && message.payload.roll !== undefined) {
      scene.updateRemotePilot?.({ pilotId: message.payload.pilot_id, displayName: message.payload.display_name, shipType: message.payload.ship_type, position: new Vector3(message.payload.x, message.payload.y, message.payload.z), yaw: message.payload.yaw, pitch: message.payload.pitch, roll: message.payload.roll })
    }
  })
  socket.addEventListener('close', () => {
    if (realtimeSocket !== socket) return
    realtimeSocket = null
    if (realtimeSessionActive) realtimeReconnectTimer = window.setTimeout(connectRealtime, 1_000)
  })
}

void loadDiscoveryBootstrap()
void loadShipInventory(true)
connectRealtime()

if (savedShipState.docked_station_name) {
  scene.dispose()
  scene = createStationInteriorScene(gameCanvas)
  stationBackdrop?.removeAttribute('hidden')
  stationHotspots?.removeAttribute('hidden')
  dockedStatus?.removeAttribute('hidden')
  systemStatus?.setAttribute('hidden', '')
  document.querySelector('.game-shell')?.classList.add('is-docked')
}

function closeStationServices() {
  invalidateInventoryView()
  stationServices?.setAttribute('hidden', '')
}

function openStationServices(selectedService: string) {
  if (locationTransitionPending || isInSystemSpace) return
  closeGameModal()
  stationServices?.removeAttribute('hidden')
  stationServicePanel?.removeAttribute('hidden')
  stationPanels.forEach((panel) => {
    panel.hidden = panel.dataset.stationPanel !== selectedService
  })
}

async function transitionScene(replaceScene: () => void) {
  gameCanvas.classList.add('is-scene-transitioning')
  try {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 180))
    replaceScene()
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
  } finally {
    gameCanvas.classList.remove('is-scene-transitioning')
  }
}

async function changeDockedState(docking: boolean) {
  if (inventoryLocked() || docking !== isInSystemSpace) return
  locationTransitionPending = true
  locationTransitionError = ''
  inventoryRequests.invalidate()
  const errorDisplay = document.querySelector<HTMLElement>('#docked-transition-error')
  errorDisplay?.setAttribute('hidden', '')
  if (collisionAlert) collisionAlert.textContent = ''
  for (const button of [dockAction, undockAction]) {
    if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true') }
  }
  renderActiveInventory()
  const position = docking ? { ...playerMapPosition } : { x: 123_078, y: 480, z: -2_690.5 }
  try {
    await saveShipState(docking ? 'KEPLER STATION' : null, position)
  } catch (error) {
    locationTransitionError = `${docking ? 'Docking' : 'Undocking'} failed: ${error instanceof Error ? error.message : 'Network error'}. Location unchanged locally; verify connection before retrying.`
    if (docking && collisionAlert) collisionAlert.textContent = locationTransitionError
    if (!docking && errorDisplay) {
      errorDisplay.textContent = locationTransitionError
      errorDisplay.removeAttribute('hidden')
    }
    finishLocationTransition()
    return
  }

  try {
    closeGameModal()
    closeStationServices()
    await transitionScene(() => {
      scene.dispose()
      isInSystemSpace = !docking
      playerMapPosition = position
      dockedInventory = null
      fittingSnapshot = null
      selectedInventoryItem = null
      scene = docking ? createStationInteriorScene(gameCanvas) : createFlightScene(25, false, new Vector3(position.x, position.y, position.z))
      stationBackdrop?.toggleAttribute('hidden', !docking)
      stationHotspots?.toggleAttribute('hidden', !docking)
      dockedStatus?.toggleAttribute('hidden', !docking)
      systemStatus?.toggleAttribute('hidden', docking)
      availableActions?.setAttribute('hidden', '')
      document.querySelector('.game-shell')?.classList.toggle('is-docked', docking)
      if (realtimeSocket?.readyState === WebSocket.OPEN) realtimeSocket.send(JSON.stringify({ type: docking ? 'docked' : 'undocked', payload: {} }))
    })
  } finally {
    finishLocationTransition()
  }
  void loadShipInventory(true)
  if (!docking) {
    void refreshNearbyAsteroids()
    void refreshNearbyJettisonedItems()
  }
}

function finishLocationTransition() {
  inventoryRequests.invalidate()
  locationTransitionPending = false
  for (const button of [dockAction, undockAction]) {
    if (button) { button.disabled = false; button.removeAttribute('aria-busy') }
  }
  renderActiveInventory()
  if (stationServices?.hidden === false && fittingPanel?.hidden === false) renderDockedFitting()
}

dockAction?.addEventListener('click', () => void changeDockedState(true))
undockAction?.addEventListener('click', () => void changeDockedState(false))

stationServiceButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (locationTransitionPending || isInSystemSpace) return
    const selectedService = button.dataset.stationService
    if (!selectedService) return
    openStationServices(selectedService)
    if (selectedService === 'inventory') void loadDockedInventory()
    if (selectedService === 'fitting') void loadDockedFitting().catch((error: unknown) => {
      if (fittingPanel) fittingPanel.innerHTML = '<p class="station-service-empty">Unable to load docked fitting.</p>'
      console.error(error)
    })
  })
})

stationServiceBack?.addEventListener('click', () => {
  closeStationServices()
})

exitServicesAction?.addEventListener('click', closeStationServices)

if (import.meta.hot) {
  import.meta.hot.dispose(() => scene.dispose())
}

window.addEventListener('beforeunload', () => scene.dispose(), { once: true })
}
