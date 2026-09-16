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
import { createElement, Crosshair, Eye, EyeOff, Maximize2, Minus, PanelRightClose, PanelRightOpen, Plus, RefreshCw, ScanLine, X } from 'lucide'
import { createStationInteriorScene, createSystemScene } from './game/scene'
import type { MiningExtractionResult, ServerAsteroid, ServerJettisonedItem } from './game/scene'
import { resourceZoneAt, resourceZonePath, type ResourceZone as MapResourceZone } from './resource-zones'
import { systemPois as systemPoiDefinitions } from './system-pois'
import stationInteriorUrl from './assets/station-interior.svg'
import refineryUrl from './assets/refinery.png'
import rawOreIconUrl from './assets/items/raw ore.png'
import { escapeHtml, freeVolume, inventoryEntries, InventoryRequestGuard, parseInventoryDrag, quantityLimit, resolveInventoryEntry, validateQuantity } from './inventory'
import type { InventoryAction, InventoryContainer, InventoryEntry, InventorySelection, InventorySnapshot } from './inventory'
import { isEditingText } from './game/input'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Application root was not found.')
}
const appRoot = app

const apiBaseUrl = '/api/v1'
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

type DockedEntityList = {
  station_name: string
  entities: { pilot_id: string; display_name: string; entity_type: string }[]
}

type FittingSnapshot = {
  ship_id: string
  hull_definition_id: string
  universal_hardpoint_count: number
  core_system_slot_count: number
  fitted_modules: { item_id: string; definition_id: string; display_name: string; family: string; slot_location: string; slot_index: number; durability: number; mass_kg: number; effective_range_meters: number }[]
  statistics: Record<string, number>
}

type RefinerySnapshot = {
  server_time: string
  service: { display_name: string; fee_credits: number; queue_capacity: number; first_pass_seconds_per_cubic_meter: number; first_pass_efficiency: number; second_pass_seconds_per_cubic_meter: number; second_pass_efficiency: number }
  jobs: { id: string; stage: string; state: string; queue_sequence: number; quoted_duration_seconds: number; quoted_efficiency: number; quoted_fee_credits: number; expected_outputs: { definition_id: string; definition_version: number; quantity_cubic_meters: number }[]; started_at: string | null; completes_at: string | null }[]
}

type MarketListing = { id: string; seller_display_name: string; inventory_item_id: string; definition_id: string; quantity: number; unit_price_credits: number; volume_per_unit: number; duration_days: number; listing_fee_credits: number; expires_at: string }
type MarketBuyOrder = { id: string; buyer_display_name: string; definition_id: string; definition_version: number; quantity: number; unit_price_credits: number; duration_days: number; listing_fee_credits: number; expires_at: string }
type MarketSnapshot = { wallet_balance_credits: number; listings: MarketListing[]; my_listings: MarketListing[]; buy_orders?: MarketBuyOrder[]; my_buy_orders?: MarketBuyOrder[] }
type PilotSummary = { id: string; display_name: string; balance_credits: number }
type WalletSnapshot = { wallet_balance_credits: number }

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
          pilots?: PilotSummary[]
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
        const payload = await response.json() as Partial<PilotSummary> & { detail?: string }
        if (!response.ok || !payload.id || !payload.display_name || payload.balance_credits === undefined) {
          throw new Error(payload.detail ?? 'Unable to create this pilot.')
        }
        renderPilotSelection(accountAccessToken, [{ id: payload.id, display_name: payload.display_name, balance_credits: payload.balance_credits }])
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
  pilots: PilotSummary[],
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
              <div><dt>WALLET BALANCE</dt><dd id="loading-pilot-wallet">${selectedPilot.balance_credits.toLocaleString()} CR</dd></div>
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
  const wallet = document.querySelector<HTMLElement>('#loading-pilot-wallet')
  document.querySelectorAll<HTMLButtonElement>('[data-pilot-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const pilot = pilots.find((candidate) => candidate.id === button.dataset.pilotId)
      if (!pilot) return
      selectedPilot = pilot
      if (name) name.textContent = selectedPilot.display_name
      if (wallet) wallet.textContent = `${selectedPilot.balance_credits.toLocaleString()} CR`
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
  localStorage.removeItem(refreshTokenStorageKey)
  localStorage.removeItem(rememberedEmailStorageKey)
}

async function restoreStoredSession() {
  const refreshToken = localStorage.getItem(refreshTokenStorageKey) ?? sessionStorage.getItem(refreshTokenStorageKey)
  if (!refreshToken) {
    renderAuthentication()
    return
  }
  const persistent = localStorage.getItem(refreshTokenStorageKey) === refreshToken
  try {
    const response = await fetch(`${apiBaseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    const payload = await response.json() as {
      access_token?: string
      pilots?: PilotSummary[]
      refresh_token?: string
    }
    if (!response.ok || !payload.access_token || !payload.refresh_token || !payload.pilots) {
      throw new Error('Stored session could not be restored')
    }
    const storage = persistent ? localStorage : sessionStorage
    storage.setItem(refreshTokenStorageKey, payload.refresh_token)
    renderPilotSelection(payload.access_token, payload.pilots)
  } catch {
    clearStoredSession()
    renderAuthentication()
  }
}

void restoreStoredSession()

function launchGame(
  pilotAccessToken: string,
  savedShipState: SavedShipState,
  accountAccessToken: string,
  pilots: PilotSummary[],
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
    <section id="station-hotspots" class="station-service-strip" aria-label="Kepler Station services" hidden>
      <button class="station-service-button service-market" type="button" data-station-service="market" aria-label="Market" data-tooltip="Market: buy and sell station goods"><span aria-hidden="true">&#x25C6;</span></button>
      <button class="station-service-button service-maintenance" type="button" data-station-service="maintenance" aria-label="Maintenance" data-tooltip="Maintenance: repair and resupply your ship"><span aria-hidden="true">&#x2699;</span></button>
      <button class="station-service-button service-fitting" type="button" data-station-service="fitting" aria-label="Fitting" data-tooltip="Fitting: install and manage ship modules"><span aria-hidden="true">&#x229E;</span></button>
      <button class="station-service-button service-refining" type="button" data-station-service="refining" aria-label="Refining" data-tooltip="Refining: process raw ore into minerals"><span aria-hidden="true">&#x25C9;</span></button>
      <button class="station-service-button service-crafting" type="button" data-station-service="crafting" aria-label="Crafting" data-tooltip="Crafting: access manufacturing workstations"><span aria-hidden="true">&#x2692;</span></button>
      <button class="station-service-button service-inventory" type="button" data-station-service="inventory" aria-label="Inventory" data-tooltip="Inventory: transfer cargo and station storage"><span aria-hidden="true">&#x25A4;</span></button>
      <button class="station-service-button service-hangar" type="button" data-station-service="hangar" aria-label="Hangar" data-tooltip="Hangar: view ships stored at Kepler"><span aria-hidden="true">&#x2302;</span></button>
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
      <nav class="topbar-actions" aria-label="Major functions">
        <button id="topbar-map" type="button" title="Open system map">MAP</button>
        <button id="topbar-ship" type="button" title="View current ship">SHIP</button>
        <button id="topbar-wallet" type="button" title="View wallet">WALLET</button>
      </nav>
    </header>
    <p id="game-toast" class="game-toast" role="status" aria-live="polite" hidden></p>
    <section class="module-rack" aria-label="Ship hardpoints">
      <p class="eyebrow">HARDPOINTS</p>
      <div class="module-slots" style="--hardpoint-count: ${starterHardpoints.length}">
        ${hardpointSlotsMarkup}
      </div>
      <div class="core-systems" aria-label="Installed core systems">
        <p class="eyebrow">CORE SYSTEMS</p>
        <div class="core-system-icons">
          <button class="core-system-icon" type="button" aria-label="Warp Drive: Class I core with 100 warp capacity, 2 capacity per second recharge, 10 kilometer per second maximum speed, a calculated 450 kilometer range, and a 30 second manual activation cooldown." data-core-system="warp" data-tooltip="ALT+1 WARP DRIVE: Warp along your heading. Press again to exit. 30 second cooldown."><span aria-hidden="true">WD</span></button>
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
    <section id="target-window" class="target-window" aria-label="Selected target" hidden>
      <div class="target-window-heading"><p id="target-lock-label" class="eyebrow">TARGET LOCK</p><div id="target-active-modules" class="target-active-modules" aria-label="Active modules on target"></div><button id="clear-target" type="button" aria-label="Unlock target">×</button></div>
      <div id="target-thumbnail" class="target-thumbnail" aria-hidden="true"><span></span></div><div><p id="target-name" class="target-name"></p><p id="target-range" class="target-range"></p><button id="pickup-jettisoned-item" type="button" hidden>COLLECT CARGO</button></div></div>
      <div class="target-actions"><button id="approach-target" type="button">APPROACH</button><button id="view-target-details" type="button">DETAILS</button></div>
      <p id="cargo-pickup-feedback" class="inventory-feedback" role="status"></p>
      <span id="target-lock-progress" class="target-lock-progress"><span></span></span>
    </section>
    <dialog id="target-details" class="target-details-dialog" aria-labelledby="target-details-title"><header><div><p class="eyebrow">TARGET INTEL</p><h2 id="target-details-title"></h2></div><button id="close-target-details" type="button" aria-label="Close target details">×</button></header><dl id="target-details-content"></dl><button id="scan-target-assay" type="button" aria-label="Scan asteroid composition" title="Scan asteroid composition" hidden>${createElement(ScanLine, { width: 20, height: 20, 'aria-hidden': 'true' }).outerHTML}</button><p id="target-scan-status" role="status"></p></dialog>
    <section id="target-list" class="target-list" aria-label="Nearby targets">
      <div class="target-list-heading"><p class="eyebrow">TARGETS</p></div>
      <div class="target-list-filters" role="group" aria-label="Target filters"><button type="button" data-target-filter="all" aria-pressed="true">ALL</button><button type="button" data-target-filter="asteroid" aria-pressed="false">ORES</button><button type="button" data-target-filter="player" aria-pressed="false">SHIPS</button></div>
      <div id="target-list-items" class="target-list-items"></div>
    </section>
    <section id="available-actions" class="available-actions" aria-label="Available actions" hidden>
      <p class="eyebrow">AVAILABLE ACTIONS</p>
      <button id="dock-action" type="button">DOCK AT KEPLER STATION</button>
    </section>
    <section id="docked-status" class="docked-controls" aria-label="Docked controls" hidden>
      <div class="docked-utility-actions" aria-label="Station information">
        <button id="docked-entities-action" class="docked-icon-button docked-entities-icon" type="button" aria-label="View docked entities" title="Docked entities"><span aria-hidden="true"></span></button>
        <button id="station-information-action" class="docked-icon-button station-information-icon" type="button" aria-label="View station information" title="Station information"><span aria-hidden="true">i</span></button>
      </div>
      <button id="undock-action" class="undock-icon-button" type="button" aria-label="Undock from Kepler Station" title="Undock"><span aria-hidden="true"></span></button>
      <p id="docked-transition-error" class="inventory-error" role="alert" hidden></p>
    </section>
    <dialog id="docked-entities" class="docked-dialog" aria-labelledby="docked-entities-title"><header><div><p class="eyebrow">DOCKED ENTITIES</p><h2 id="docked-entities-title">KEPLER STATION</h2></div><button id="close-docked-entities" type="button" aria-label="Close docked entities">×</button></header><div id="docked-entities-content" class="docked-dialog-content"></div></dialog>
    <dialog id="station-information" class="docked-dialog" aria-labelledby="station-information-title"><header><div><p class="eyebrow">STATION INFORMATION</p><h2 id="station-information-title">KEPLER STATION</h2></div><button id="close-station-information" type="button" aria-label="Close station information">×</button></header><dl class="docked-dialog-details"><div><dt>LOCATION</dt><dd>KEPLER ORBIT</dd></div><div><dt>DOCKING</dt><dd>BAY 04</dd></div><div><dt>SERVICES</dt><dd>MARKET, FITTING, REFINING</dd></div></dl></dialog>
    <section id="station-services" class="station-services" aria-label="Kepler Station services" hidden>
      <header class="station-services-heading"><div><p class="eyebrow">STATION SERVICES</p><h1>KEPLER STATION</h1></div><button id="exit-services-action" type="button">EXIT SERVICES</button></header>
      <div id="station-service-panel" class="station-service-panel">
        <button id="station-service-back" class="station-service-back" type="button">BACK TO SERVICES</button>
        <section id="market-panel" class="market-panel" data-station-panel="market" hidden aria-live="polite"></section>
        <section data-station-panel="maintenance" hidden><p class="eyebrow">SHIPYARD SERVICES</p><h2>MAINTENANCE</h2><p class="station-service-empty">Repair prices, fuel, reload supplies, and crafted consumables require an authoritative docked-state snapshot.</p></section>
        <section id="fitting-panel" data-station-panel="fitting" hidden aria-live="polite"></section>
        <section id="refining-panel" class="refining-panel" data-station-panel="refining" style="--refinery-image: url('${refineryUrl}')" hidden aria-live="polite"></section>
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
        <header class="system-map-heading"><div><p class="eyebrow">KEPLER / NAVIGATION</p><h1 id="system-map-title">LOCAL SPACE</h1></div><div class="system-map-actions">
          <button id="system-map-zoom-out" class="system-map-refresh" type="button" aria-label="Zoom out" title="Zoom out">${createElement(Minus).outerHTML}</button>
          <button id="system-map-zoom-in" class="system-map-refresh" type="button" aria-label="Zoom in" title="Zoom in">${createElement(Plus).outerHTML}</button>
          <button id="system-map-recenter" class="system-map-refresh" type="button" aria-label="Center on ship" title="Center on ship">${createElement(Crosshair).outerHTML}</button>
          <button id="system-map-overview" class="system-map-refresh" type="button" aria-label="Show whole system" title="Show whole system">${createElement(Maximize2).outerHTML}</button>
          <button id="system-map-scan" class="system-map-refresh" type="button" aria-label="Scan surrounding space" title="Scan surrounding space">${createElement(ScanLine).outerHTML}</button>
          <button id="system-map-sensor-range-toggle" class="system-map-refresh" type="button" aria-label="Hide sensor range" aria-pressed="true" title="Hide sensor range">${createElement(Eye).outerHTML}</button>
          <button id="system-map-refresh" class="system-map-refresh" type="button" aria-label="Refresh system map" title="Refresh system map">${createElement(RefreshCw).outerHTML}</button>
          <button id="system-map-destinations-toggle" class="system-map-refresh" type="button" aria-label="Open destinations" aria-expanded="false" title="Open destinations">${createElement(PanelRightOpen).outerHTML}</button>
          <button id="system-map-close" class="game-modal-close" type="button" aria-label="Close system map" title="Close system map">${createElement(X).outerHTML}</button>
        </div></header>
        <div class="system-map-layout">
          <div class="system-map-display" aria-label="System map POIs" tabindex="0">
            <div class="system-map-scale"><span id="system-map-coordinate"></span><span>X / Z PLANE</span></div>
            <div id="system-map-world" class="system-map-world">
              <div id="system-map-surveys" aria-hidden="true"></div>
              <div id="system-map-sensor-range" class="system-map-sensor-range" title="Current sensor range"></div>
              <div id="system-map-boundary" class="system-map-boundary" aria-hidden="true"></div>
              <svg id="system-map-zones" class="system-map-zones" role="img" aria-label="Resource class boundaries"></svg>
              <div id="system-map-cell-labels" class="system-map-cell-labels" aria-hidden="true"></div>
              ${systemPoiDefinitions.map((poi) => `<button class="system-poi system-poi-${poi.mapKind}${poi.id === 'primary-star' ? ' is-selected' : ''}" type="button" data-poi="${poi.id}" aria-pressed="${poi.id === 'primary-star'}"><span>${poi.name}</span></button>`).join('')}
              <div id="system-map-discoveries" class="system-map-discoveries" aria-label="Scanned asteroid fields"></div>
              <span id="system-map-player" class="system-map-player" title="Your ship"><span class="system-map-player-heading" aria-hidden="true"></span></span>
              <div id="system-map-contacts" class="system-map-contacts" aria-label="Live contacts"></div>
            </div>
            <div id="system-map-zone-legend" class="system-map-zone-legend" aria-label="Resource zone classes"></div>
            <div class="system-map-ruler"><span id="system-map-ruler-label"></span><i id="system-map-ruler-line"></i></div>
            <div id="system-map-grid-label" class="system-map-grid-label"></div>
            <aside id="system-map-destinations-cabinet" class="system-map-destinations-cabinet" aria-label="Charted destinations" aria-hidden="true"><header><p class="eyebrow">CHARTED DESTINATIONS</p><button id="system-map-destinations-close" type="button" aria-label="Close destinations" title="Close destinations">${createElement(PanelRightClose).outerHTML}</button></header><nav id="system-map-destinations" aria-label="Charted destinations"></nav></aside>
          </div>
        </div>
        <footer class="system-map-footer"><span>100 x 100 CELLS / 100,000 km PER SIDE</span><span id="system-map-survey-status">0 SESSION SCANS</span><span>STAR ORIGIN / 0, 0, 0</span></footer>
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
const availableActions = document.querySelector<HTMLElement>('#available-actions')
const dockAction = document.querySelector<HTMLButtonElement>('#dock-action')
const dockedStatus = document.querySelector<HTMLElement>('#docked-status')
const stationBackdrop = document.querySelector<HTMLElement>('#station-backdrop')
const stationHotspots = document.querySelector<HTMLElement>('#station-hotspots')
const stationServices = document.querySelector<HTMLElement>('#station-services')
const undockAction = document.querySelector<HTMLButtonElement>('#undock-action')
const dockedEntitiesAction = document.querySelector<HTMLButtonElement>('#docked-entities-action')
const stationInformationAction = document.querySelector<HTMLButtonElement>('#station-information-action')
const dockedEntities = document.querySelector<HTMLDialogElement>('#docked-entities')
const dockedEntitiesTitle = document.querySelector<HTMLElement>('#docked-entities-title')
const dockedEntitiesContent = document.querySelector<HTMLElement>('#docked-entities-content')
const stationInformation = document.querySelector<HTMLDialogElement>('#station-information')
const systemStatus = document.querySelector<HTMLElement>('#system-status')
const stationServicePanel = document.querySelector<HTMLElement>('#station-service-panel')
const marketPanel = document.querySelector<HTMLElement>('#market-panel')
const inventoryPanel = document.querySelector<HTMLElement>('#inventory-panel')
const stationServiceButtons = document.querySelectorAll<HTMLButtonElement>('[data-station-service]')
const stationPanels = document.querySelectorAll<HTMLElement>('[data-station-panel]')
const stationServiceBack = document.querySelector<HTMLButtonElement>('#station-service-back')
const exitServicesAction = document.querySelector<HTMLButtonElement>('#exit-services-action')
const fittingPanel = document.querySelector<HTMLElement>('#fitting-panel')
const refiningPanel = document.querySelector<HTMLElement>('#refining-panel')
const gameMenuToggle = document.querySelector<HTMLButtonElement>('#game-menu-toggle')
const gameMenuActions = document.querySelector<HTMLElement>('#game-menu-actions')
const topbarMap = document.querySelector<HTMLButtonElement>('#topbar-map')
const topbarShip = document.querySelector<HTMLButtonElement>('#topbar-ship')
const topbarWallet = document.querySelector<HTMLButtonElement>('#topbar-wallet')
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
const systemMapRefresh = document.querySelector<HTMLButtonElement>('#system-map-refresh')
const systemMapZoomOut = document.querySelector<HTMLButtonElement>('#system-map-zoom-out')
const systemMapZoomIn = document.querySelector<HTMLButtonElement>('#system-map-zoom-in')
const systemMapDestinationsToggle = document.querySelector<HTMLButtonElement>('#system-map-destinations-toggle')
const systemMapDestinationsClose = document.querySelector<HTMLButtonElement>('#system-map-destinations-close')
const systemMapDestinationsCabinet = document.querySelector<HTMLElement>('#system-map-destinations-cabinet')
const systemMapDisplay = document.querySelector<HTMLElement>('.system-map-display')
const systemMapWorld = document.querySelector<HTMLElement>('#system-map-world')
const systemMapPlayer = document.querySelector<HTMLElement>('#system-map-player')
const systemMapContacts = document.querySelector<HTMLElement>('#system-map-contacts')
const systemMapDiscoveries = document.querySelector<HTMLElement>('#system-map-discoveries')
const systemPois = document.querySelectorAll<HTMLButtonElement>('[data-poi]')
const warpOverlay = document.querySelector<HTMLElement>('#warp-overlay')
const warpStars = document.querySelector<HTMLElement>('#warp-stars')
const targetWindow = document.querySelector<HTMLElement>('#target-window')
const targetThumbnail = document.querySelector<HTMLElement>('#target-thumbnail')
const targetName = document.querySelector<HTMLElement>('#target-name')
const targetRange = document.querySelector<HTMLElement>('#target-range')
const targetLockLabel = document.querySelector<HTMLElement>('#target-lock-label')
const targetLockProgress = document.querySelector<HTMLElement>('#target-lock-progress')
const targetActiveModules = document.querySelector<HTMLElement>('#target-active-modules')
const clearTarget = document.querySelector<HTMLButtonElement>('#clear-target')
const approachTarget = document.querySelector<HTMLButtonElement>('#approach-target')
const viewTargetDetails = document.querySelector<HTMLButtonElement>('#view-target-details')
const targetDetails = document.querySelector<HTMLDialogElement>('#target-details')
const targetDetailsTitle = document.querySelector<HTMLElement>('#target-details-title')
const targetDetailsContent = document.querySelector<HTMLElement>('#target-details-content')
const scanTargetAssay = document.querySelector<HTMLButtonElement>('#scan-target-assay')
const targetScanStatus = document.querySelector<HTMLElement>('#target-scan-status')
type ScannedMineral = { definition_id: string; definition_version?: number; version?: number; percentage: number }
let scannedAsteroid: { id: string; assay: ScannedMineral[] } | undefined
let sensorScanPending = false
const targetListItems = document.querySelector<HTMLElement>('#target-list-items')
const targetFilterButtons = document.querySelectorAll<HTMLButtonElement>('[data-target-filter]')
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
const gameToast = document.querySelector<HTMLElement>('#game-toast')
let gameToastTimer: number | undefined

function showGameToast(message: string) {
  if (!gameToast) return
  if (gameToastTimer !== undefined) window.clearTimeout(gameToastTimer)
  gameToast.textContent = message
  gameToast.hidden = false
  gameToast.classList.remove('is-fading')
  const wordCount = message.trim().split(/\s+/).length
  const displayDuration = Math.max(2_000, wordCount * 250)
  gameToastTimer = window.setTimeout(() => {
    gameToast.classList.add('is-fading')
    gameToastTimer = window.setTimeout(() => {
      gameToast.hidden = true
      gameToast.classList.remove('is-fading')
      gameToastTimer = undefined
    }, 250)
  }, displayDuration)
}
const shipDestroyedOverlay = document.querySelector<HTMLElement>('#ship-destroyed-overlay')
const destructionCause = document.querySelector<HTMLElement>('#destruction-cause')
let playerMapPosition = { x: -2_600_000_000, y: 480, z: -4_510_180_000 }
let playerMapYaw = 0
let selectedTarget: { id?: string; name: string; kind: 'asteroid' | 'pilot' | 'cargo' | 'warpable' | 'station' | 'planet'; shipType?: string; jettisonedItemId?: string; position: Vector3; oreRemainingCubicMeters: number; initialOreCubicMeters: number; locked: boolean; locking: boolean; lockProgress: number } | undefined
let lockedTarget: typeof selectedTarget
const activeModuleTargetIds = new Map<string, string>()
let targetListFilter: 'all' | 'asteroid' | 'player' = 'all'
let lastTargetListUpdateAt = 0
let cargoCubicMeters = 0
let cargoCapacityCubicMeters = 24
let shipPowerMegajoules = savedShipState.power_megajoules
let shipShields = savedShipState.shields
let shipHull = savedShipState.hull
let shipFuelLiters = savedShipState.fuel_liters

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
type PoiName = string
type PoiDetails = { type: string; name: string; description: string; position: { x: number; y: number; z: number } }
type DiscoveredField = { id: string; display_name: string; position_x: number; position_y: number; position_z: number; distance_meters: number; scan_quality: number }

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

const poiDetails: Record<PoiName, PoiDetails> = Object.fromEntries(systemPoiDefinitions.map((poi) => [poi.id, {
  type: poi.type, name: poi.name, description: poi.description, position: poi.position,
}]))
let selectedPoi: PoiName = 'primary-star'
const discoveredFields = new Map<string, DiscoveredField>()

function distanceToPoi(name: PoiName): number {
  const destination = poiDetails[name].position
  return Math.hypot(destination.x - playerMapPosition.x, destination.y - playerMapPosition.y, destination.z - playerMapPosition.z)
}

function closeSystemMap() {
  stopSystemMapAnimation()
  systemMapModal?.setAttribute('hidden', '')
}

function openSystemMap() {
  if (locationTransitionPending || !systemMapModal || gameModal?.hasAttribute('hidden') === false) return
  systemMapModal.removeAttribute('hidden')
  resetSystemMapToPlayerCell()
  renderSystemMapDestinations()
  const scan = document.querySelector<HTMLButtonElement>('#system-map-scan')
  if (scan) scan.disabled = !isInSystemSpace
  systemMapClose?.focus()
}

const systemMapHalfSpanMeters = 5_000_000_000
const systemMapCellSizeMeters = 100_000_000
const systemMapMaximumZoom = 100_000_000
let mapResourceZones: MapResourceZone[] = []
let mapSystemRadiusMeters = 3_100_000_000
let systemMapZoom = 1
let systemMapPan = { x: 0, y: 0 }
let systemMapDrag: { pointerId: number; startX: number; startY: number; panX: number; panY: number; moved: boolean } | undefined
let systemMapSuppressClick = false
let systemMapAnimation: number | undefined
let systemMapZoomTarget = 1
let systemMapPanTarget = { x: 0, y: 0 }
let systemMapViewportSide = 600
let systemMapSensorRangeVisible = true
let systemMapDestinationsOpen = false
const systemMapSurveys: { x: number; y: number; z: number; radius: number }[] = []
function isInVisibleSystemMapRange(position: { x: number; z: number }): boolean {
  if (!systemMapDisplay) return true
  const point = projectSystemMapPosition(position)
  return point.x >= 0 && point.x <= systemMapDisplay.clientWidth
    && point.y >= 0 && point.y <= systemMapDisplay.clientHeight
}

function setSystemMapDestinationsOpen(open: boolean) {
  systemMapDestinationsOpen = open
  systemMapDestinationsCabinet?.classList.toggle('is-open', open)
  systemMapDestinationsCabinet?.setAttribute('aria-hidden', String(!open))
  systemMapDestinationsToggle?.setAttribute('aria-expanded', String(open))
  systemMapDestinationsToggle?.setAttribute('aria-label', open ? 'Close destinations' : 'Open destinations')
  systemMapDestinationsToggle?.setAttribute('title', open ? 'Close destinations' : 'Open destinations')
  systemMapDestinationsToggle?.replaceChildren(createElement(open ? PanelRightClose : PanelRightOpen))
}

function systemMapPixelsPerMeter() {
  return systemMapViewportSide * systemMapZoom / (systemMapHalfSpanMeters * 2)
}

function projectSystemMapPosition(position: { x: number; z: number }) {
  const scale = systemMapPixelsPerMeter()
  return {
    x: (systemMapDisplay?.clientWidth ?? 0) / 2 + (position.x + systemMapPan.x / scale) * scale,
    y: (systemMapDisplay?.clientHeight ?? 0) / 2 - (position.z - systemMapPan.y / scale) * scale,
  }
}

function formatMapDistance(meters: number) {
  return `${(meters === 0 ? 0 : meters / 1_000).toLocaleString('en-US', { maximumFractionDigits: 2 })} km`
}

function systemMapCellId(position: { x: number; z: number }) {
  return { x: Math.floor(position.x / systemMapCellSizeMeters), z: Math.floor(position.z / systemMapCellSizeMeters) }
}

function formatSystemMapCellId(cell: { x: number; z: number }) {
  return `CELL X ${cell.x >= 0 ? '+' : ''}${cell.x} / Z ${cell.z >= 0 ? '+' : ''}${cell.z}`
}

function currentSensorRange() {
  const range = fittingSnapshot?.statistics.sensor_range_meters
  return typeof range === 'number' && Number.isFinite(range) && range >= 0 ? range : 0
}

function stopSystemMapAnimation() {
  if (systemMapAnimation !== undefined) window.cancelAnimationFrame(systemMapAnimation)
  systemMapAnimation = undefined
}

function resetSystemMapToPlayerCell() {
  if (!systemMapDisplay) return
  stopSystemMapAnimation()
  systemMapZoom = Math.max(100, Math.min(systemMapMaximumZoom, systemMapHalfSpanMeters * 2 / Math.max(100_000, currentSensorRange() * 2)))
  const scale = systemMapPixelsPerMeter()
  systemMapPan = {
    x: -playerMapPosition.x * scale,
    y: playerMapPosition.z * scale,
  }
  updateSystemMapZoom()
}

function clampSystemMapPan() {
  if (!systemMapDisplay || systemMapZoom === 1) {
    systemMapPan = { x: 0, y: 0 }
    return
  }
  const extent = systemMapPixelsPerMeter() * systemMapHalfSpanMeters * 2
  const maximumX = Math.max(0, (extent - systemMapDisplay.clientWidth) / 2)
  const maximumY = Math.max(0, (extent - systemMapDisplay.clientHeight) / 2)
  systemMapPan.x = Math.max(-maximumX, Math.min(maximumX, systemMapPan.x))
  systemMapPan.y = Math.max(-maximumY, Math.min(maximumY, systemMapPan.y))
}

function updateSystemMapZoom() {
  if (!systemMapWorld) return
  const side = Math.min(systemMapDisplay?.clientWidth || 800, systemMapDisplay?.clientHeight || 600)
  const resizeRatio = side / systemMapViewportSide
  systemMapPan.x *= resizeRatio
  systemMapPan.y *= resizeRatio
  systemMapPanTarget.x *= resizeRatio
  systemMapPanTarget.y *= resizeRatio
  systemMapViewportSide = side
  clampSystemMapPan()
  systemMapWorld.dataset.zoom = String(systemMapZoom)
  systemMapWorld.dataset.panX = String(systemMapPan.x)
  systemMapWorld.dataset.panY = String(systemMapPan.y)
  const scale = systemMapPixelsPerMeter()
  const span = (systemMapDisplay?.clientWidth || 800) / scale
  const detail = span <= 2_000_000 ? 'local' : span <= 1_000_000_000 ? 'sector' : 'system'
  systemMapWorld.dataset.detail = detail
  systemMapPlayer?.classList.toggle('show-heading', span <= 5_000_000)
  const title = document.querySelector<HTMLElement>('#system-map-title')
  if (title) title.textContent = detail === 'local' ? 'LOCAL SPACE' : detail === 'sector' ? 'SECTOR CHART' : 'KEPLER SYSTEM'
  const baseStep = 10 ** Math.floor(Math.log10(70 / scale))
  const step = baseStep * ([1, 2, 5, 10].find((multiple) => baseStep * multiple * scale >= 70) ?? 10)
  const grid = step * scale
  const origin = projectSystemMapPosition({ x: 0, z: 0 })
  systemMapWorld.style.backgroundSize = `${grid}px ${grid}px`
  systemMapWorld.style.backgroundPosition = `${origin.x % grid}px ${origin.y % grid}px`
  const coordinate = document.querySelector<HTMLElement>('#system-map-coordinate')
  if (coordinate) coordinate.textContent = `X ${formatMapDistance(-systemMapPan.x / scale)} / Z ${formatMapDistance(systemMapPan.y / scale)}`
  const gridLabel = document.querySelector<HTMLElement>('#system-map-grid-label')
  const centerCell = systemMapCellId({ x: -systemMapPan.x / scale, z: systemMapPan.y / scale })
  if (gridLabel) gridLabel.textContent = `${formatSystemMapCellId(centerCell)} / ${formatMapDistance(step)} GRID / ${formatMapDistance(span)} ACROSS`
  const rulerBase = 10 ** Math.floor(Math.log10(160 / scale))
  const rulerDistance = rulerBase * ([5, 2, 1].find((multiple) => rulerBase * multiple * scale <= 160) ?? 1)
  const ruler = document.querySelector<HTMLElement>('#system-map-ruler-line')
  if (ruler) ruler.style.width = `${rulerDistance * scale}px`
  const rulerLabel = document.querySelector<HTMLElement>('#system-map-ruler-label')
  if (rulerLabel) rulerLabel.textContent = formatMapDistance(rulerDistance)
  const boundary = document.querySelector<HTMLElement>('#system-map-boundary')
  if (boundary) {
    boundary.hidden = systemMapZoom > 3
    const side = mapSystemRadiusMeters * 2 * scale
    boundary.style.cssText = `left:${origin.x - side / 2}px;top:${origin.y - side / 2}px;width:${side}px;height:${side}px`
  }
  if (systemMapZoomIn) systemMapZoomIn.disabled = systemMapZoom >= systemMapMaximumZoom
  if (systemMapZoomOut) systemMapZoomOut.disabled = systemMapZoom <= 1
  updateSystemMapZones()
  updateSystemMapCellLabels()
  updateSystemMapMarkers()
}

function updateSystemMapZones() {
  const overlay = document.querySelector<SVGSVGElement>('#system-map-zones')
  const legend = document.querySelector<HTMLElement>('#system-map-zone-legend')
  if (!overlay || !legend) return
  const svgNamespace = 'http://www.w3.org/2000/svg'
  const scale = systemMapPixelsPerMeter()
  const bands = document.createElementNS(svgNamespace, 'g')
  for (const zone of [...mapResourceZones].sort((left, right) => right.zone_class - left.zone_class)) {
    const circle = document.createElementNS(svgNamespace, 'path')
    circle.setAttribute('d', resourceZonePath(zone, projectSystemMapPosition, scale))
    circle.dataset.zoneId = zone.zone_id
    circle.setAttribute('fill', zone.display_color)
    circle.setAttribute('fill-opacity', '0.16')
    circle.setAttribute('stroke', zone.display_color)
    circle.setAttribute('stroke-opacity', '0.6')
    const title = document.createElementNS(svgNamespace, 'title')
    title.textContent = `Class ${zone.zone_class}`
    circle.append(title)
    bands.append(circle)
  }
  overlay.replaceChildren(bands)
  legend.replaceChildren(...mapResourceZones.map((zone) => {
    const label = document.createElement('span')
    label.style.setProperty('--zone-color', zone.display_color)
    label.textContent = `Class ${zone.zone_class}`
    return label
  }))
}

function updateSystemMapCellLabels() {
  const labels = document.querySelector<HTMLElement>('#system-map-cell-labels')
  if (!labels || !systemMapDisplay) return
  const cellPixels = systemMapCellSizeMeters * systemMapPixelsPerMeter()
  if (cellPixels < 72) {
    labels.replaceChildren()
    return
  }
  const center = {
    x: -systemMapPan.x / systemMapPixelsPerMeter(),
    z: systemMapPan.y / systemMapPixelsPerMeter(),
  }
  const halfWidth = systemMapDisplay.clientWidth / systemMapPixelsPerMeter() / 2
  const halfHeight = systemMapDisplay.clientHeight / systemMapPixelsPerMeter() / 2
  const firstX = Math.max(-50, Math.floor((center.x - halfWidth) / systemMapCellSizeMeters))
  const lastX = Math.min(49, Math.floor((center.x + halfWidth) / systemMapCellSizeMeters))
  const firstZ = Math.max(-50, Math.floor((center.z - halfHeight) / systemMapCellSizeMeters))
  const lastZ = Math.min(49, Math.floor((center.z + halfHeight) / systemMapCellSizeMeters))
  labels.replaceChildren(...Array.from({ length: lastX - firstX + 1 }, (_, xOffset) => Array.from({ length: lastZ - firstZ + 1 }, (_, zOffset) => {
    const cell = { x: firstX + xOffset, z: firstZ + zOffset }
    const label = document.createElement('span')
    const point = projectSystemMapPosition({
      x: (cell.x + 0.5) * systemMapCellSizeMeters,
      z: (cell.z + 0.5) * systemMapCellSizeMeters,
    })
    label.textContent = `X ${cell.x >= 0 ? '+' : ''}${cell.x}\nZ ${cell.z >= 0 ? '+' : ''}${cell.z}`
    label.style.left = `${point.x}px`
    label.style.top = `${point.y}px`
    return label
  })).flat())
}

function changeSystemMapZoom(factor: number, anchor = { x: 0, y: 0 }) {
  const previousZoom = systemMapAnimation === undefined ? systemMapZoom : systemMapZoomTarget
  systemMapZoomTarget = Math.max(1, Math.min(systemMapMaximumZoom, previousZoom * factor))
  const ratio = systemMapZoomTarget / systemMapZoom
  systemMapPanTarget = {
    x: anchor.x - (anchor.x - systemMapPan.x) * ratio,
    y: anchor.y - (anchor.y - systemMapPan.y) * ratio,
  }
  stopSystemMapAnimation()
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    systemMapZoom = systemMapZoomTarget
    systemMapPan = { ...systemMapPanTarget }
    updateSystemMapZoom()
    return
  }
  let previousTime = performance.now()
  const animate = (time: number) => {
    const amount = 1 - Math.exp(-Math.max(1, time - previousTime) / 65)
    previousTime = time
    systemMapZoom += (systemMapZoomTarget - systemMapZoom) * amount
    systemMapPan.x += (systemMapPanTarget.x - systemMapPan.x) * amount
    systemMapPan.y += (systemMapPanTarget.y - systemMapPan.y) * amount
    const complete = Math.abs(systemMapZoom - systemMapZoomTarget) / systemMapZoomTarget < 0.00001
    if (complete) {
      systemMapZoom = systemMapZoomTarget
      systemMapPan = { ...systemMapPanTarget }
    }
    updateSystemMapZoom()
    systemMapAnimation = complete ? undefined : window.requestAnimationFrame(animate)
  }
  systemMapAnimation = window.requestAnimationFrame(animate)
}

function positionSystemMapMarker(marker: HTMLElement | null, position: { x: number; z: number }) {
  if (!marker) return
  const point = projectSystemMapPosition(position)
  marker.style.left = `${point.x}px`
  marker.style.top = `${point.y}px`
}

function updateSystemMapMarkers() {
  if (systemMapModal?.hidden !== false) return
  const scale = systemMapPixelsPerMeter()
  systemPois.forEach((poi) => {
    const name = poi.dataset.poi as PoiName
    poi.setAttribute('aria-label', poiDetails[name].name)
    positionSystemMapMarker(poi, poiDetails[name].position)
    const definition = systemPoiDefinitions.find((definition) => definition.id === name)
    const celestialBody = definition?.planet ?? definition?.star
    if (celestialBody) {
      poi.style.setProperty('--world-diameter', `${Math.max(10, celestialBody.diameterKilometers * 1_000 * scale)}px`)
      poi.style.setProperty('--world-color', celestialBody.color)
    }
    poi.hidden = !isInVisibleSystemMapRange(poiDetails[name].position)
  })
  if (systemMapDiscoveries) {
    for (const field of discoveredFields.values()) {
      const poiId = `discovered-field-${field.id}`
      let marker = document.getElementById(poiId)
      if (!marker) {
        marker = document.createElement('button')
        marker.id = poiId
        marker.className = 'system-poi system-poi-discovery'
        marker.dataset.poi = poiId
        marker.innerHTML = `<span>${escapeHtml(field.display_name)}</span>`
        marker.setAttribute('aria-label', field.display_name)
        marker.addEventListener('click', () => selectPoi(poiId))
        systemMapDiscoveries.append(marker)
      }
      const position = { x: field.position_x, z: field.position_z }
      const zone = resourceZoneAt(mapResourceZones, position.x, position.z)
      marker.style.color = zone?.display_color ?? ''
      marker.title = `${field.display_name}${zone ? ` / Class ${zone.zone_class}` : ''}`
      positionSystemMapMarker(marker, position)
      marker.hidden = !isInVisibleSystemMapRange(position)
      marker.classList.toggle('is-selected', selectedPoi === poiId)
      marker.setAttribute('aria-pressed', String(selectedPoi === poiId))
    }
  }
  positionSystemMapMarker(systemMapPlayer, playerMapPosition)
  if (systemMapPlayer) {
    systemMapPlayer.hidden = !isInVisibleSystemMapRange(playerMapPosition)
    systemMapPlayer.style.setProperty('--heading-degrees', `${playerMapYaw * 180 / Math.PI}deg`)
  }
  const sensorRange = document.querySelector<HTMLElement>('#system-map-sensor-range')
  if (sensorRange) {
    positionSystemMapMarker(sensorRange, playerMapPosition)
    const rangeMeters = currentSensorRange()
    sensorRange.style.width = sensorRange.style.height = `${rangeMeters * scale * 2}px`
    sensorRange.title = `Equipped sensor range: ${formatMapDistance(rangeMeters)}`
    sensorRange.hidden = !systemMapSensorRangeVisible || !isInSystemSpace || rangeMeters * scale < 3
  }
  document.querySelectorAll<HTMLElement>('.system-map-survey').forEach((marker, index) => {
    const survey = systemMapSurveys[index]!
    positionSystemMapMarker(marker, survey)
    marker.style.width = marker.style.height = `${survey.radius * scale * 2}px`
    marker.hidden = survey.radius * scale < 2
  })
  layoutSystemMapLabels()
  if (!systemMapContacts) return
  const contacts = (scene.getTargetables?.() ?? []).filter((target) => (
    systemMapWorld?.dataset.detail === 'local' && target.kind === 'asteroid'
      && Math.hypot(target.position.x - playerMapPosition.x, target.position.y - playerMapPosition.y, target.position.z - playerMapPosition.z) <= currentSensorRange()
      && isInVisibleSystemMapRange({ x: target.position.x, z: target.position.z })
  ))
  systemMapContacts.innerHTML = contacts.map((target) => {
    const point = projectSystemMapPosition(target.position)
    return `<span class="system-map-contact system-map-contact-${target.kind}" title="${escapeHtml(target.name)}" style="left:${point.x}px;top:${point.y}px"></span>`
  }).join('')
}

function layoutSystemMapLabels() {
  const occupied: { left: number; top: number; right: number; bottom: number }[] = []
  const markers = [...(systemMapWorld?.querySelectorAll<HTMLElement>('[data-poi]') ?? [])]
    .sort((left, right) => Number(right.dataset.poi === selectedPoi) - Number(left.dataset.poi === selectedPoi))
  for (const marker of markers) {
    const label = marker.querySelector<HTMLElement>('span')!
    label.hidden = true
    if (marker.hidden || (systemMapWorld?.dataset.detail !== 'local' && marker.classList.contains('system-poi-discovery') && marker.dataset.poi !== selectedPoi)) continue
    const point = projectSystemMapPosition(poiDetails[marker.dataset.poi!]!.position)
    const width = Math.min(180, (label.textContent?.length ?? 0) * 6.5)
    for (const offset of [{ x: 18, y: -10 }, { x: -width - 18, y: -10 }, { x: -width / 2, y: 24 }, { x: -width / 2, y: -48 }]) {
      const box = { left: point.x + offset.x, top: point.y + offset.y, right: point.x + offset.x + width, bottom: point.y + offset.y + 34 }
      const legend = document.querySelector<HTMLElement>('#system-map-zone-legend')
      const labelTop = Math.max(42, (legend?.offsetTop ?? 44) + (legend?.offsetHeight ?? 0) + 12)
      if (box.left < 8 || box.top < labelTop || box.right > (systemMapDisplay?.clientWidth ?? 0) - 8 || box.bottom > (systemMapDisplay?.clientHeight ?? 0) - 52) continue
      if (occupied.some((other) => box.left < other.right + 8 && box.right > other.left - 8 && box.top < other.bottom + 4 && box.bottom > other.top - 4)) continue
      label.style.cssText = `left:calc(50% + ${offset.x}px);top:calc(50% + ${offset.y}px);width:${width}px`
      label.hidden = false
      occupied.push(box)
      break
    }
  }
}

function renderSystemMapDestinations() {
  const list = document.querySelector<HTMLElement>('#system-map-destinations')
  if (!list) return
  list.innerHTML = Object.entries(poiDetails).map(([id, details]) => `<div class="system-map-destination"><button type="button" data-destination="${escapeHtml(id)}" aria-pressed="${selectedPoi === id}"><span>${escapeHtml(details.name)}</span><small>${formatMapDistance(distanceToPoi(id))}</small></button><button type="button" class="system-map-destination-warp" data-warp-destination="${escapeHtml(id)}" ${distanceToPoi(id) <= 100_000 || !isInSystemSpace ? 'disabled' : ''}>WARP TO</button></div>`).join('')
  list.querySelectorAll<HTMLButtonElement>('[data-destination]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.destination!
    selectPoi(id)
    if (!isInVisibleSystemMapRange(poiDetails[id]!.position)) {
      stopSystemMapAnimation()
      const position = poiDetails[id]!.position
      const scale = systemMapPixelsPerMeter()
      systemMapPan = { x: -position.x * scale, y: position.z * scale }
      updateSystemMapZoom()
    }
  }))
  list.querySelectorAll<HTMLButtonElement>('[data-warp-destination]').forEach((button) => button.addEventListener('click', () => {
    warpToPoi(button.dataset.warpDestination as PoiName)
  }))
}

async function refreshSystemMap() {
  if (systemMapRefresh?.disabled) return
  systemMapRefresh?.setAttribute('aria-busy', 'true')
  try {
    await Promise.all([loadDiscoveryBootstrap(), refreshNearbyAsteroids(), refreshNearbyJettisonedItems()])
    updateSystemMapMarkers()
  } finally {
    systemMapRefresh?.removeAttribute('aria-busy')
  }
}

function selectPoi(name: PoiName) {
  selectedPoi = name
  systemMapWorld?.querySelectorAll<HTMLElement>('[data-poi]').forEach((poi) => {
    const isSelected = poi.dataset.poi === name
    poi.classList.toggle('is-selected', isSelected)
    poi.setAttribute('aria-pressed', String(isSelected))
  })
  document.querySelectorAll<HTMLElement>('[data-destination]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.destination === name)))
  layoutSystemMapLabels()
}

function warpToPoi(name: PoiName) {
  if (locationTransitionPending || !isInSystemSpace) return
  const destination = poiDetails[name].position
  if (scene.warpTo?.(new Vector3(destination.x, destination.y, destination.z))) closeSystemMap()
  else showGameToast('WARP UNAVAILABLE: CHECK RANGE, CAPACITOR AND FLIGHT STATUS')
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

async function openWallet() {
  if (locationTransitionPending || !gameModal || !gameModalEyebrow || !gameModalTitle || !gameModalContent || !gameModalActions) return
  closeSystemMap()
  invalidateInventoryView()
  gameModal.dataset.view = 'wallet'
  gameModalEyebrow.textContent = 'PERSONAL FINANCE'
  gameModalTitle.textContent = 'WALLET'
  gameModalContent.innerHTML = '<p class="modal-copy">Loading wallet...</p>'
  gameModalActions.replaceChildren()
  gameModal.removeAttribute('hidden')
  gameModalClose?.focus()
  try {
    const response = await fetch(`${apiBaseUrl}/market/wallet`, { headers: { authorization: `Bearer ${pilotAccessToken}` } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const wallet = await response.json() as WalletSnapshot
    if (gameModal?.dataset.view === 'wallet') {
      gameModalContent.innerHTML = `<dl class="docked-dialog-details"><div><dt>AVAILABLE CREDITS</dt><dd>${wallet.wallet_balance_credits.toLocaleString()} CR</dd></div></dl>`
    }
  } catch {
    if (gameModal?.dataset.view === 'wallet') gameModalContent.innerHTML = '<p class="modal-copy">Unable to load wallet balance.</p>'
  }
}

function shipStatisticLabel(name: string): string {
  return name.replaceAll('_', ' ').toUpperCase()
}

function shipStatisticValue(name: string, value: number): string {
  if (name.includes('range') || name.includes('speed')) return `${value.toLocaleString()} m`
  if (name.includes('mass')) return `${value.toLocaleString()} kg`
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2)
}

function renderShipDossier() {
  if (!gameModalContent || !fittingSnapshot) return
  const fittings = fittingSnapshot.fitted_modules?.map((module) => `<li><strong>${module.display_name}</strong><span>${module.slot_location.replaceAll('_', ' ').toUpperCase()} ${module.slot_index + 1}</span><small>${module.durability.toFixed(0)}% integrity · ${module.mass_kg.toLocaleString()} kg</small></li>`).join('') || '<li class="ship-dossier-empty">No modules are fitted.</li>'
  const statistics = Object.entries(fittingSnapshot.statistics ?? {}).filter(([, value]) => Number.isFinite(value)).map(([name, value]) => `<div><dt>${shipStatisticLabel(name)}</dt><dd>${shipStatisticValue(name, value)}</dd></div>`).join('') || '<p class="ship-dossier-empty">Operational statistics are unavailable.</p>'
  gameModalContent.innerHTML = `<section class="ship-dossier-overview"><p class="eyebrow">${fittingSnapshot.hull_definition_id?.replace(/^hull\./, '').replaceAll('_', ' ') ?? 'STARTER CORVETTE'}</p><dl><div><dt>STATUS</dt><dd>${isInSystemSpace ? 'IN SPACE' : 'DOCKED'}</dd></div><div><dt>HULL</dt><dd>${Math.ceil(shipHull)}%</dd></div><div><dt>SHIELDS</dt><dd>${Math.ceil(shipShields)}%</dd></div><div><dt>POWER</dt><dd>${shipPowerMegajoules.toFixed(2)} MJ</dd></div><div><dt>FUEL</dt><dd>${shipFuelLiters.toFixed(2)} L</dd></div><div><dt>CARGO</dt><dd>${cargoCubicMeters.toFixed(2)} / ${cargoCapacityCubicMeters.toFixed(2)} M3</dd></div></dl></section><section class="ship-dossier-section"><p class="eyebrow">FITTED MODULES</p><ul class="ship-dossier-fittings">${fittings}</ul></section><section class="ship-dossier-section"><p class="eyebrow">SHIP STATISTICS</p><dl class="ship-dossier-statistics">${statistics}</dl></section>`
}

async function openShipDossier() {
  if (locationTransitionPending || !gameModal || !gameModalEyebrow || !gameModalTitle || !gameModalContent || !gameModalActions) return
  closeSystemMap()
  invalidateInventoryView()
  gameModal.dataset.view = 'ship'
  gameModalEyebrow.textContent = 'CURRENT VESSEL'
  gameModalTitle.textContent = 'SHIP DOSSIER'
  gameModalContent.innerHTML = '<p class="modal-copy">Loading ship systems...</p>'
  gameModalActions.innerHTML = ''
  gameModal.removeAttribute('hidden')
  gameModalClose?.focus()
  try {
    await loadActiveFitting()
    renderShipDossier()
  } catch {
    gameModalContent.innerHTML = '<p class="modal-copy">Ship systems are temporarily unavailable.</p>'
  }
}

/*
function renderAdminSettings(configuration: AdminConfiguration) {
  if (!gameModalContent || !gameModalActions) return
  const fields: { key: keyof AdminConfiguration; label: string; step?: string }[] = [
    { key: 'simulation_tick_hz', label: 'SIMULATION TICK RATE', step: '1' },
    { key: 'snapshot_tick_hz', label: 'SNAPSHOT TICK RATE', step: '1' },
    { key: 'asteroid_spawn_interval_seconds', label: 'ASTEROID SPAWN INTERVAL', step: '1' },
    { key: 'asteroid_field_maximum_active_asteroids', label: 'MAXIMUM ACTIVE ASTEROIDS', step: '1' },
    { key: 'refinery_tick_seconds', label: 'REFINERY WORKER INTERVAL', step: '0.1' },
    { key: 'ollama_model', label: 'LOCAL MODEL' },
    { key: 'ollama_timeout_seconds', label: 'LOCAL MODEL TIMEOUT', step: '0.1' },
  ]
  gameModalContent.innerHTML = `<form id="admin-settings-form" class="admin-settings-form">${fields.map(({ key, label, step }) => `<label>${label}<input name="${key}" type="${typeof configuration[key] === 'number' ? 'number' : 'text'}" value="${String(configuration[key])}"${step ? ` step="${step}" min="0"` : ''} required></label>`).join('')}<p id="admin-settings-feedback" class="admin-settings-feedback" role="status"></p></form>`
  gameModalActions.innerHTML = '<button id="admin-settings-reload" class="modal-button" type="button">RELOAD</button><button id="admin-settings-save" class="modal-button modal-button-primary" type="submit" form="admin-settings-form">SAVE SETTINGS</button>'
  document.querySelector<HTMLButtonElement>('#admin-settings-reload')?.addEventListener('click', () => void loadAdminSettings())
  document.querySelector<HTMLFormElement>('#admin-settings-form')?.addEventListener('submit', (event) => {
    event.preventDefault()
    void saveAdminSettings(configuration)
  })
}

async function loadAdminSettings() {
  if (!gameModalContent || gameModal?.dataset.view !== 'admin') return
  gameModalContent.innerHTML = '<p class="modal-copy">Loading configuration...</p>'
  gameModalActions?.replaceChildren()
  try {
    const response = await fetch(`${apiBaseUrl}/admin/configuration`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    renderAdminSettings(await response.json() as AdminConfiguration)
  } catch (error) {
    gameModalContent.innerHTML = `<p class="admin-settings-feedback">Unable to load system settings: ${error instanceof Error ? error.message : 'Network error'}.</p>`
  }
}

async function saveAdminSettings(configuration: AdminConfiguration) {
  const form = document.querySelector<HTMLFormElement>('#admin-settings-form')
  const feedback = document.querySelector<HTMLElement>('#admin-settings-feedback')
  const save = document.querySelector<HTMLButtonElement>('#admin-settings-save')
  if (!form || !feedback || !save) return
  const values = new FormData(form)
  const payload = Object.fromEntries(Object.entries(configuration).map(([key, value]) => [key, typeof value === 'number' ? Number(values.get(key)) : values.get(key)]))
  save.disabled = true
  feedback.textContent = 'Saving configuration...'
  try {
    const response = await fetch(`${apiBaseUrl}/admin/configuration`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    feedback.textContent = 'System settings saved.'
  } catch (error) {
    feedback.textContent = `Unable to save system settings: ${error instanceof Error ? error.message : 'Network error'}.`
  } finally {
    save.disabled = false
  }
}

*/
async function saveShipState(dockedStationName: string | null, position = playerMapPosition) {
  const response = await fetch(`${apiBaseUrl}/auth/ship-state`, {
      method: 'PUT',
      keepalive: true,
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
  realtimeReconnectEnabled = false
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
let marketSnapshot: MarketSnapshot | null = null
let marketTab: 'buy' | 'sell' | 'orders' = 'buy'
let marketDurationDays = 1
let marketFilter = ''
let marketSort: 'name' | 'price' = 'name'
let marketCatalogFilter = ''
let expandedMarketCatalogs = new Set(['extracted', 'refined'])
let selectedMarketItemId: string | null = null
let marketBusy = false
let shipInventorySnapshot: InventoryContainer | null = null
let refinerySnapshot: RefinerySnapshot | null = null
let selectedRefinerySource: { id: string; kind: 'raw_ore' | 'intermediate'; name: string } | null = null
let refineryInventoryExpanded = true
let refineryClockTimer: number | undefined
let refineryServerTime = 0
let refinerySnapshotReceivedAt = 0
let refineryClockTicks = 0
let refineryRefreshInFlight = false
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
      <span class="inventory-item-icon" aria-hidden="true">${entry.kind === 'ore' ? `<img class="inventory-item-icon-image" src="${rawOreIconUrl}" alt="">` : inventoryIcon(entry.item.definition_id)}</span>
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

function marketItemName(definitionId: string) { return definitionId.replace(/^(?:module|material)\./, '').replaceAll('_', ' ') }
function marketFeeCredits(quantity: number, unitPriceCredits: number, durationDays: number) { return Math.max(1, Math.ceil(quantity * unitPriceCredits * durationDays * 0.001)) }
function marketDurationLabel(durationDays: number) { return durationDays === 1 ? '1 DAY' : durationDays === 7 ? '1 WEEK' : '1 MONTH' }
function marketExpiryLabel(expiresAt: string) { return new Date(expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase() }

function confirmMarketPurchase(listing: MarketListing, quantity: number, buyAll: boolean) {
  if (!gameModal || !gameModalEyebrow || !gameModalTitle || !gameModalContent || !gameModalActions) return
  const commission = marketFeeCredits(quantity, listing.unit_price_credits, listing.duration_days)
  const total = quantity * listing.unit_price_credits + commission
  gameModal.dataset.view = 'market-buy-all'
  gameModalEyebrow.textContent = 'MARKET CONFIRMATION'
  gameModalTitle.textContent = buyAll ? 'BUY ALL UNITS' : 'BUY UNITS'
  gameModalContent.innerHTML = `<p class="modal-copy">Purchase ${buyAll ? 'all ' : ''}${quantity.toLocaleString()} units of ${escapeHtml(marketItemName(listing.definition_id))} from ${escapeHtml(listing.seller_display_name)}?</p><dl class="docked-dialog-details"><div><dt>UNIT PRICE</dt><dd>${listing.unit_price_credits.toLocaleString()} CR</dd></div><div><dt>COMMISSION</dt><dd>${commission.toLocaleString()} CR</dd></div><div><dt>TOTAL</dt><dd>${total.toLocaleString()} CR</dd></div></dl>`
  gameModalActions.innerHTML = `<button id="market-purchase-cancel" class="modal-button" type="button">CANCEL</button><button id="market-purchase-confirm" class="modal-button modal-button-primary" type="button">${buyAll ? 'BUY ALL' : 'BUY'}</button>`
  gameModal.removeAttribute('hidden')
  document.querySelector<HTMLButtonElement>('#market-purchase-cancel')?.addEventListener('click', closeGameModal)
  document.querySelector<HTMLButtonElement>('#market-purchase-confirm')?.addEventListener('click', () => {
    closeGameModal()
    void mutateMarket(`/listings/${listing.id}/buy`, { quantity, idempotency_key: crypto.randomUUID() })
  })
}

function renderMarket() {
  if (!marketPanel || !marketSnapshot || !dockedInventory) return
  const listings = marketSnapshot.listings.filter((listing) => marketItemName(listing.definition_id).includes(marketFilter.toLowerCase()) && listing.definition_id.includes(marketCatalogFilter)).sort((left, right) => (marketSort === 'price' ? left.unit_price_credits - right.unit_price_credits : marketItemName(left.definition_id).localeCompare(marketItemName(right.definition_id))))
  const selected = dockedInventory.station.items.find((item) => item.id === selectedMarketItemId)
  const buyOrders = marketSnapshot.buy_orders ?? []
  const rows = listings.map((listing) => `<article class="market-row"><div><strong>${escapeHtml(marketItemName(listing.definition_id))}</strong><small>SELLER: ${escapeHtml(listing.seller_display_name)} · ${listing.quantity} available · EXPIRES ${marketExpiryLabel(listing.expires_at)}</small></div><div><strong>${listing.unit_price_credits} CR</strong><small data-market-commission="${listing.id}">+ ${marketFeeCredits(1, listing.unit_price_credits, listing.duration_days)} CR ${marketDurationLabel(listing.duration_days)} COMMISSION</small><input data-market-quantity="${listing.id}" type="number" min="1" max="${listing.quantity}" value="1"><button data-market-buy="${listing.id}" type="button" ${marketBusy ? 'disabled' : ''}>BUY</button><button data-market-buy-all="${listing.id}" type="button" ${marketBusy ? 'disabled' : ''}>BUY ALL</button></div></article>`).join('') || '<p class="inventory-empty">No listings match this search.</p>'
  const sources = dockedInventory.station.items.map((item) => `<button class="inventory-item" data-market-item="${item.id}" type="button" draggable="true"><span class="inventory-item-icon">${inventoryIcon(item.definition_id)}</span><span class="inventory-item-name">${escapeHtml(marketItemName(item.definition_id))}</span><span class="inventory-item-quantity">${item.quantity}</span></button>`).join('') || '<p class="inventory-empty">No station items available.</p>'
  const mine = marketSnapshot.my_listings.map((listing) => `<article class="market-row"><strong>${escapeHtml(marketItemName(listing.definition_id))}</strong><span>${listing.quantity} at ${listing.unit_price_credits} CR · ${marketDurationLabel(listing.duration_days)} · EXPIRES ${marketExpiryLabel(listing.expires_at)}</span><button data-market-cancel="${listing.id}" type="button" ${marketBusy ? 'disabled' : ''}>CANCEL</button></article>`).join('') || '<p class="inventory-empty">No active listings.</p>'
  const expanded = (category: string) => expandedMarketCatalogs.has(category)
  const treeItem = (label: string, filter: string) => `<li><button data-market-catalog-filter="${filter}" type="button" aria-pressed="${marketCatalogFilter === filter}">${label}</button></li>`
  const treeBranch = (label: string, category: string, filter: string, children: string) => `<li><div class="market-tree-branch"><button data-market-catalog-filter="${filter}" type="button" aria-pressed="${marketCatalogFilter === filter}">${label}</button><button class="market-tree-toggle" data-market-catalog-toggle="${category}" type="button" aria-label="${expanded(category) ? 'Collapse' : 'Expand'} ${label}" aria-expanded="${expanded(category)}"><span aria-hidden="true">${expanded(category) ? '−' : '+'}</span></button></div>${expanded(category) ? `<ul>${children}</ul>` : ''}</li>`
  const tree = `<ul>${treeItem('RAW ORE', 'ore.raw')}${treeBranch('EXTRACTED ORE', 'extracted', 'material.ore.', `${treeItem('Iron Ore', 'material.ore.iron')}${treeItem('Copper Ore', 'material.ore.copper')}${treeItem('Nickel Ore', 'material.ore.nickel')}${treeItem('Silicate Ore', 'material.ore.silicate')}`)}${treeBranch('REFINED ORE', 'refined', 'material.pure.', `${treeItem('Pure Iron', 'material.pure.iron')}${treeItem('Pure Copper', 'material.pure.copper')}${treeItem('Pure Nickel', 'material.pure.nickel')}${treeItem('Pure Silicate', 'material.pure.silicate')}`)}</ul>`
  const orders = buyOrders.map((order) => `<article class="market-row"><div><strong>${escapeHtml(marketItemName(order.definition_id))}</strong><small>BUYER: ${escapeHtml(order.buyer_display_name)} · ${order.quantity} wanted · EXPIRES ${marketExpiryLabel(order.expires_at)}</small></div><div><strong>${order.unit_price_credits} CR</strong><input data-buy-order-quantity="${order.id}" type="number" min="1" max="${order.quantity}" value="1"><button data-buy-order-fill="${order.id}" type="button">FILL</button></div></article>`).join('') || '<p class="inventory-empty">No active buy orders.</p>'
  const orderForm = `<section class="market-listing-tray"><strong>PLACE BUY ORDER</strong><label>ITEM <select id="market-buy-order-item"><option value="material.ore.iron">IRON ORE</option><option value="material.ore.copper">COPPER ORE</option><option value="material.ore.nickel">NICKEL ORE</option><option value="material.ore.silicate">SILICATE ORE</option></select></label><label>QUANTITY <input id="market-buy-order-quantity" type="number" min="1" value="1"></label><label>PRICE / UNIT <input id="market-buy-order-price" type="number" min="1" value="100"></label><label>DURATION <select id="market-buy-order-duration"><option value="1">1 DAY</option><option value="7">1 WEEK</option><option value="30">1 MONTH</option></select></label><button id="market-buy-order-place" type="button">PLACE BUY ORDER</button></section>`
  marketPanel.innerHTML = `<header class="market-heading"><div><p class="eyebrow">KEPLER EXCHANGE</p><h1>MARKET</h1></div><div><strong>${marketSnapshot.wallet_balance_credits.toLocaleString()} CR</strong><button id="exit-market" type="button">EXIT MARKET</button></div></header><div class="market-layout"><aside class="market-item-tree" aria-label="Item categories"><p class="eyebrow">ITEM CATALOG</p>${tree}</aside><div class="market-content"><nav class="market-tabs"><button data-market-tab="buy" aria-pressed="${marketTab === 'buy'}" type="button">BUY</button><button data-market-tab="sell" aria-pressed="${marketTab === 'sell'}" type="button">SELL</button><button data-market-tab="orders" aria-pressed="${marketTab === 'orders'}" type="button">ORDERS</button></nav>${marketTab === 'buy' ? `<div class="market-tools"><input data-market-filter type="search" value="${escapeHtml(marketFilter)}" placeholder="SEARCH ITEMS"><button data-market-sort type="button">SORT: ${marketSort.toUpperCase()}</button></div><section class="market-list">${rows}</section>` : marketTab === 'orders' ? `<div class="market-sell-layout">${orderForm}<section class="market-list">${orders}</section></div>` : `<div class="market-sell-layout"><section class="inventory-items">${sources}</section><section class="market-listing-tray" data-market-drop>${selected ? `<strong>${escapeHtml(marketItemName(selected.definition_id))}</strong><label>QUANTITY <input id="market-list-quantity" type="number" min="1" max="${selected.quantity}" value="${selected.quantity}"></label><label>PRICE / UNIT <input id="market-list-price" type="number" min="1" value="100"></label><label>DURATION <select id="market-list-duration"><option value="1">1 DAY</option><option value="7">1 WEEK</option><option value="30">1 MONTH</option></select></label><button id="market-list" type="button">LIST FOR SALE</button>` : '<p>Drag a station item here to list it.</p>'}</section></div><section class="market-list">${mine}</section>`}</div></div>`
  marketPanel.querySelectorAll<HTMLButtonElement>('[data-market-tab]').forEach((button) => button.addEventListener('click', () => { marketTab = button.dataset.marketTab as 'buy' | 'sell' | 'orders'; renderMarket() }))
  marketPanel.querySelector<HTMLButtonElement>('#market-buy-order-place')?.addEventListener('click', () => void mutateMarket('/buy-orders', { definition_id: marketPanel.querySelector<HTMLSelectElement>('#market-buy-order-item')?.value, definition_version: 1, quantity: Number(marketPanel.querySelector<HTMLInputElement>('#market-buy-order-quantity')?.value), unit_price_credits: Number(marketPanel.querySelector<HTMLInputElement>('#market-buy-order-price')?.value), duration_days: Number(marketPanel.querySelector<HTMLSelectElement>('#market-buy-order-duration')?.value), idempotency_key: crypto.randomUUID() }))
  marketPanel.querySelectorAll<HTMLButtonElement>('[data-buy-order-fill]').forEach((button) => button.addEventListener('click', () => void mutateMarket(`/buy-orders/${button.dataset.buyOrderFill}/fill`, { quantity: Number(marketPanel.querySelector<HTMLInputElement>(`[data-buy-order-quantity="${button.dataset.buyOrderFill}"]`)?.value), idempotency_key: crypto.randomUUID() })))
  marketPanel.querySelector<HTMLInputElement>('[data-market-filter]')?.addEventListener('input', (event) => { marketFilter = (event.target as HTMLInputElement).value; marketCatalogFilter = ''; renderMarket() })
  marketPanel.querySelector<HTMLButtonElement>('[data-market-sort]')?.addEventListener('click', () => { marketSort = marketSort === 'name' ? 'price' : 'name'; renderMarket() })
  marketPanel.querySelectorAll<HTMLButtonElement>('[data-market-catalog-filter]').forEach((button) => button.addEventListener('click', () => {
    marketCatalogFilter = button.dataset.marketCatalogFilter ?? ''
    marketFilter = ''
    renderMarket()
  }))
  marketPanel.querySelectorAll<HTMLButtonElement>('[data-market-catalog-toggle]').forEach((button) => button.addEventListener('click', () => {
    const category = button.dataset.marketCatalogToggle
    if (!category) return
    expandedMarketCatalogs.has(category) ? expandedMarketCatalogs.delete(category) : expandedMarketCatalogs.add(category)
    renderMarket()
  }))
  marketPanel.querySelectorAll<HTMLButtonElement>('[data-market-buy]').forEach((button) => button.addEventListener('click', () => {
    const listing = listings.find((candidate) => candidate.id === button.dataset.marketBuy)
    const quantity = Number(marketPanel.querySelector<HTMLInputElement>(`[data-market-quantity="${button.dataset.marketBuy}"]`)?.value)
    if (!listing || !Number.isInteger(quantity) || quantity < 1 || quantity > listing.quantity) return
    confirmMarketPurchase(listing, quantity, false)
  }))
  marketPanel.querySelectorAll<HTMLButtonElement>('[data-market-buy-all]').forEach((button) => button.addEventListener('click', () => {
    const listing = listings.find((candidate) => candidate.id === button.dataset.marketBuyAll)
    if (!listing) return
    confirmMarketPurchase(listing, listing.quantity, true)
  }))
  marketPanel.querySelectorAll<HTMLInputElement>('[data-market-quantity]').forEach((input) => input.addEventListener('input', () => {
    const listing = listings.find((candidate) => candidate.id === input.dataset.marketQuantity)
    const commission = marketPanel.querySelector<HTMLElement>(`[data-market-commission="${input.dataset.marketQuantity}"]`)
    if (listing && commission) commission.textContent = `+ ${marketFeeCredits(Number(input.value), listing.unit_price_credits, listing.duration_days)} CR ${marketDurationLabel(listing.duration_days)} COMMISSION`
  }))
  marketPanel.querySelectorAll<HTMLButtonElement>('[data-market-cancel]').forEach((button) => button.addEventListener('click', () => void mutateMarket(`/listings/${button.dataset.marketCancel}/cancel`, {})))
  marketPanel.querySelectorAll<HTMLButtonElement>('[data-market-item]').forEach((button) => { button.addEventListener('click', () => { selectedMarketItemId = button.dataset.marketItem!; renderMarket() }); button.addEventListener('dragstart', (event) => event.dataTransfer?.setData('application/x-spaceconomy-market-item', button.dataset.marketItem!)) })
  const tray = marketPanel.querySelector<HTMLElement>('[data-market-drop]')
  tray?.addEventListener('dragover', (event) => event.preventDefault())
  tray?.addEventListener('drop', (event) => { event.preventDefault(); selectedMarketItemId = event.dataTransfer?.getData('application/x-spaceconomy-market-item') || null; renderMarket() })
  const updateListingFee = () => {
    const quantity = Number(marketPanel.querySelector<HTMLInputElement>('#market-list-quantity')?.value)
    const unitPrice = Number(marketPanel.querySelector<HTMLInputElement>('#market-list-price')?.value)
    const fee = marketPanel.querySelector<HTMLElement>('#market-list-fee')
    if (fee) fee.textContent = `${marketFeeCredits(quantity, unitPrice, marketDurationDays).toLocaleString()} CR`
  }
  marketPanel.querySelector<HTMLInputElement>('#market-list-quantity')?.addEventListener('input', updateListingFee)
  marketPanel.querySelector<HTMLInputElement>('#market-list-price')?.addEventListener('input', updateListingFee)
  marketPanel.querySelector<HTMLSelectElement>('#market-list-duration')?.addEventListener('change', (event) => { marketDurationDays = Number((event.target as HTMLSelectElement).value); updateListingFee() })
  marketPanel.querySelector<HTMLButtonElement>('#market-list')?.addEventListener('click', () => {
    if (!selectedMarketItemId) return
    void mutateMarket('/listings', {
      inventory_item_id: selectedMarketItemId,
      quantity: Number(marketPanel.querySelector<HTMLInputElement>('#market-list-quantity')?.value),
      unit_price_credits: Number(marketPanel.querySelector<HTMLInputElement>('#market-list-price')?.value),
      duration_days: marketDurationDays,
      idempotency_key: crypto.randomUUID(),
    })
  })
  marketPanel.querySelector<HTMLButtonElement>('#exit-market')?.addEventListener('click', closeStationServices)
}

async function loadDockedMarket() {
  if (!marketPanel) return
  marketPanel.innerHTML = '<p class="station-service-empty">Loading market...</p>'
  const [marketResponse, inventoryResponse] = await Promise.all([fetch(`${apiBaseUrl}/market/docked`, { headers: { authorization: `Bearer ${pilotAccessToken}` } }), fetch(`${apiBaseUrl}/inventory/docked`, { headers: { authorization: `Bearer ${pilotAccessToken}` } })])
  if (!marketResponse.ok || !inventoryResponse.ok) throw new Error('Unable to load market.')
  marketSnapshot = await marketResponse.json() as MarketSnapshot
  dockedInventory = await inventoryResponse.json() as DockedInventory
  renderMarket()
}

async function mutateMarket(endpoint: string, body: object) {
  if (marketBusy) return
  marketBusy = true
  try {
    const response = await fetch(`${apiBaseUrl}/market${endpoint}`, { method: 'POST', headers: { authorization: `Bearer ${pilotAccessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (!response.ok) throw new Error(await response.text())
    const payload = await response.json() as MarketSnapshot & { inventory: InventorySnapshot }
    marketSnapshot = payload
    applyInventorySnapshot(payload.inventory)
    selectedMarketItemId = null
  } finally { marketBusy = false; renderMarket() }
}

function refineryOutputLabel(definitionId: string) {
  return definitionId.replace(/^material\.(?:ore|pure)\./, '').replaceAll('_', ' ')
}

function refineryCountdown(completesAt: string | null): string {
  if (!completesAt) return 'AWAITING LANE'
  const remainingSeconds = Math.max(0, Math.ceil((Date.parse(completesAt) - (refineryServerTime + (Date.now() - refinerySnapshotReceivedAt))) / 1_000))
  const minutes = Math.floor(remainingSeconds / 60)
  return `${minutes}:${String(remainingSeconds % 60).padStart(2, '0')} REMAINING`
}

function updateRefineryCountdowns() {
  refiningPanel?.querySelectorAll<HTMLElement>('[data-refinery-completes-at]').forEach((countdown) => {
    countdown.textContent = refineryCountdown(countdown.dataset.refineryCompletesAt ?? null)
  })
}

function stopRefineryClock() {
  if (refineryClockTimer !== undefined) window.clearInterval(refineryClockTimer)
  refineryClockTimer = undefined
}

function startRefineryClock() {
  stopRefineryClock()
  refineryClockTicks = 0
  updateRefineryCountdowns()
  if (refiningPanel?.hidden === false && refinerySnapshot?.jobs.some((job) => job.state === 'processing' || job.state === 'queued')) {
    refineryClockTimer = window.setInterval(() => {
      updateRefineryCountdowns()
      refineryClockTicks += 1
      if (refineryClockTicks % 2 === 0) void loadDockedRefinery(false)
    }, 1_000)
  }
}

function renderRefinery() {
  if (!refiningPanel || !refinerySnapshot || !dockedInventory) return
  const materialTree = '<style>.refinery-content { grid-column: 1 / -1; }</style>'
  const sources = [
    ...dockedInventory.station.raw_ore_lots.map((lot) => ({ id: lot.id, kind: 'raw_ore' as const, definitionId: 'ore.raw', name: `${lot.composition} raw ore`, volume: lot.volume_cubic_meters, outputs: lot.mineral_assay.map((mineral) => ({ definition_id: `material.ore.${mineral.definition_id}`, quantity_cubic_meters: Math.floor(lot.volume_cubic_meters * mineral.percentage / 100 * refinerySnapshot!.service.first_pass_efficiency) })) })),
    ...dockedInventory.station.items.filter((item) => item.definition_id.startsWith('material.ore.')).map((item) => ({ id: item.id, kind: 'intermediate' as const, definitionId: item.definition_id, name: refineryOutputLabel(item.definition_id), volume: item.quantity, outputs: [{ definition_id: item.definition_id.replace('material.ore.', 'material.pure.'), quantity_cubic_meters: Math.floor(item.quantity * refinerySnapshot!.service.second_pass_efficiency) }] })),
  ]
  const selected = sources.find((source) => source.id === selectedRefinerySource?.id && source.kind === selectedRefinerySource.kind)
  const sourceTiles = sources.filter((source) => source.id !== selected?.id || source.kind !== selected.kind).map((source) => `<button class="inventory-item refinery-source" type="button" draggable="true" data-refinery-source="${escapeHtml(source.id)}" data-refinery-kind="${source.kind}"><span class="inventory-item-icon" aria-hidden="true">${source.kind === 'raw_ore' ? `<img class="inventory-item-icon-image" src="${rawOreIconUrl}" alt="">` : inventoryIcon(source.definitionId)}</span><span class="inventory-item-name">${escapeHtml(source.name)}</span><span class="inventory-item-quantity">${source.kind === 'raw_ore' ? 'LOT' : 'ORE'}</span><span class="inventory-item-volume">${source.volume.toFixed(3)} m3</span></button>`).join('') || '<p class="inventory-empty">No refinery inputs in station storage.</p>'
  const inputTray = selected ? `<button class="inventory-item refinery-input is-selected" type="button" draggable="true" data-staged-refinery-input><span class="inventory-item-icon" aria-hidden="true">${selected.kind === 'raw_ore' ? `<img class="inventory-item-icon-image" src="${rawOreIconUrl}" alt="">` : inventoryIcon(selected.definitionId)}</span><span class="inventory-item-name">${escapeHtml(selected.name)}</span><span class="inventory-item-quantity">READY</span><span class="inventory-item-volume">${selected.volume.toFixed(3)} m3</span></button>` : '<p class="refinery-drop-copy">Drag a raw ore lot or mineral ore stack here.</p>'
  const preview = selected ? `<p class="eyebrow">EXPECTED OUTPUT</p><ul class="refinery-output">${selected.outputs.filter((output) => output.quantity_cubic_meters > 0).map((output) => `<li>${escapeHtml(refineryOutputLabel(output.definition_id))}: ${output.quantity_cubic_meters} m3</li>`).join('') || '<li>No recoverable output at this efficiency.</li>'}</ul><p class="refinery-quote">${selected.volume.toFixed(3)} seconds · ${selected.kind === 'raw_ore' ? refinerySnapshot.service.first_pass_efficiency : refinerySnapshot.service.second_pass_efficiency} yield · ${refinerySnapshot.service.fee_credits.toFixed(0)} credits</p>` : '<p>Select a station input to preview its refinement.</p>'
  const activeJobs = refinerySnapshot.jobs.filter((job) => job.state === 'queued' || job.state === 'processing')
  const currentJobs = activeJobs.filter((job) => job.state === 'processing').map((job) => `<li class="refinery-job is-processing"><div><strong>PROCESSING</strong><span>${job.stage === 'crush' ? 'ORE SEPARATION' : 'PURIFICATION'}</span></div><time data-refinery-completes-at="${job.completes_at ?? ''}">${refineryCountdown(job.completes_at)}</time></li>`).join('') || '<li class="refinery-job-empty">No job is processing.</li>'
  const queuedJobs = activeJobs.filter((job) => job.state === 'queued').map((job, index) => `<li class="refinery-job"><div><strong>QUEUED ${index + 1}</strong><span>${job.stage === 'crush' ? 'ORE SEPARATION' : 'PURIFICATION'}</span></div><time>${job.quoted_duration_seconds.toFixed(0)} SECONDS</time></li>`).join('') || '<li class="refinery-job-empty">No queued jobs.</li>'
  refiningPanel.innerHTML = `<div class="refinery-layout">${materialTree}<div class="refinery-content"><header class="refinery-heading"><div><p class="eyebrow">${escapeHtml(refinerySnapshot.service.display_name)}</p><h1>REFINING</h1></div><div><p class="refinery-capacity">${activeJobs.length} / ${refinerySnapshot.service.queue_capacity} JOBS</p><button id="exit-refinery" class="exit-refinery" type="button">EXIT REFINERY</button></div></header><section class="inventory-container refinery-inventory${refineryInventoryExpanded ? '' : ' is-collapsed'}" data-refinery-storage><header class="inventory-container-heading"><div><p class="eyebrow">PERSONAL STORAGE</p><h3>STATION INVENTORY</h3></div><button id="toggle-refinery-inventory" class="refinery-inventory-toggle" type="button" aria-expanded="${refineryInventoryExpanded}" aria-label="${refineryInventoryExpanded ? 'Collapse station inventory' : 'Expand station inventory'}" title="${refineryInventoryExpanded ? 'Collapse station inventory' : 'Expand station inventory'}">${refineryInventoryExpanded ? '⌃' : '⌄'}</button></header>${refineryInventoryExpanded ? `<div class="inventory-items refinery-inputs">${sourceTiles}</div>` : ''}</section><div class="refinery-stages"><section class="refinery-stage"><header><p class="eyebrow">01</p><h2>INPUT</h2></header><div class="refinery-input-tray" data-refinery-input>${inputTray}</div></section><section class="refinery-stage refinery-execution"><header><p class="eyebrow">02</p><h2>CONFIGURATION &amp; EXECUTION</h2></header><p class="refinery-quote">${selected ? `${selected.volume.toFixed(3)} seconds · ${selected.kind === 'raw_ore' ? refinerySnapshot.service.first_pass_efficiency : refinerySnapshot.service.second_pass_efficiency} yield · ${refinerySnapshot.service.fee_credits.toFixed(0)} credits` : 'Load an input to configure a refinery job.'}</p><button id="queue-refinery-job" type="button" ${selected ? '' : 'disabled'}>START REFINING</button></section><section class="refinery-stage"><header><p class="eyebrow">03</p><h2>OUTPUT</h2></header><div class="refinery-output-tray">${preview}</div></section></div><section class="refinery-current-jobs"><header><div><p class="eyebrow">REFINERY ACTIVITY</p><h2>CURRENT JOBS</h2></div></header><div class="refinery-job-columns"><section><p class="eyebrow">PROCESSING</p><ol>${currentJobs}</ol></section><section><p class="eyebrow">QUEUED</p><ol>${queuedJobs}</ol></section></div></section></div></div>`
  refiningPanel.querySelectorAll<HTMLButtonElement>('[data-refinery-source]').forEach((button) => {
    button.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('application/x-spaceconomy-refinery-source', JSON.stringify({ id: button.dataset.refinerySource, kind: button.dataset.refineryKind === 'raw_ore' ? 'ore' : 'item', containerId: dockedInventory?.station.id }))
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    })
  })
  refiningPanel.querySelector<HTMLElement>('[data-refinery-input]')?.addEventListener('dragover', (event) => event.preventDefault())
  refiningPanel.querySelector<HTMLElement>('[data-refinery-input]')?.addEventListener('drop', (event) => {
    event.preventDefault()
    const source = parseInventoryDrag(event.dataTransfer?.getData('application/x-spaceconomy-refinery-source') ?? '')
    if (!source) return
    const matchingSource = sources.find((candidate) => candidate.id === source.id && ((source.kind === 'ore' && candidate.kind === 'raw_ore') || (source.kind === 'item' && candidate.kind === 'intermediate')))
    if (!matchingSource) return
    selectedRefinerySource = { id: matchingSource.id, kind: matchingSource.kind, name: '' }
    renderRefinery()
  })
  refiningPanel.querySelector<HTMLButtonElement>('[data-staged-refinery-input]')?.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData('application/x-spaceconomy-refinery-staged', 'true')
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  })
  refiningPanel.querySelector<HTMLElement>('[data-refinery-storage]')?.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('application/x-spaceconomy-refinery-staged')) event.preventDefault()
  })
  refiningPanel.querySelector<HTMLElement>('[data-refinery-storage]')?.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.types.includes('application/x-spaceconomy-refinery-staged')) return
    event.preventDefault()
    selectedRefinerySource = null
    renderRefinery()
  })
  refiningPanel.querySelector<HTMLButtonElement>('#queue-refinery-job')?.addEventListener('click', () => void queueRefineryJob())
  refiningPanel.querySelector<HTMLButtonElement>('#exit-refinery')?.addEventListener('click', closeStationServices)
  refiningPanel.querySelector<HTMLButtonElement>('#toggle-refinery-inventory')?.addEventListener('click', () => {
    refineryInventoryExpanded = !refineryInventoryExpanded
    renderRefinery()
  })
}

async function loadDockedRefinery(clearSelectedSource = true) {
  if (refineryRefreshInFlight) return
  refineryRefreshInFlight = true
  if (clearSelectedSource && refiningPanel) refiningPanel.innerHTML = '<p class="station-service-empty">Loading refinery...</p>'
  try {
    const [refineryResponse, inventoryResponse] = await Promise.all([
      fetch(`${apiBaseUrl}/refinery/docked`, { headers: { authorization: `Bearer ${pilotAccessToken}` } }),
      fetch(`${apiBaseUrl}/inventory/docked`, { headers: { authorization: `Bearer ${pilotAccessToken}` } }),
    ])
    if (!refineryResponse.ok || !inventoryResponse.ok) throw new Error('Unable to load refinery.')
    refinerySnapshot = await refineryResponse.json() as RefinerySnapshot
    refineryServerTime = Date.parse(refinerySnapshot.server_time)
    refinerySnapshotReceivedAt = Date.now()
    dockedInventory = await inventoryResponse.json() as DockedInventory
    if (clearSelectedSource) selectedRefinerySource = null
    renderRefinery()
    startRefineryClock()
  } finally {
    refineryRefreshInFlight = false
  }
}

async function queueRefineryJob() {
  if (!selectedRefinerySource) return
  const response = await fetch(`${apiBaseUrl}/refinery/jobs`, {
    method: 'POST', headers: { authorization: `Bearer ${pilotAccessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ source_kind: selectedRefinerySource.kind, source_id: selectedRefinerySource.id, idempotency_key: crypto.randomUUID() }),
  })
  if (!response.ok) {
    if (refiningPanel) refiningPanel.insertAdjacentHTML('beforeend', `<p class="inventory-error">${escapeHtml(await response.text())}</p>`)
    return
  }
  refinerySnapshot = await response.json() as RefinerySnapshot
  await loadDockedRefinery()
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
topbarMap?.addEventListener('click', openSystemMap)
topbarShip?.addEventListener('click', () => void openShipDossier())
topbarWallet?.addEventListener('click', () => void openWallet())
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
systemMapRefresh?.addEventListener('click', () => void refreshSystemMap())
systemMapDestinationsToggle?.addEventListener('click', () => setSystemMapDestinationsOpen(!systemMapDestinationsOpen))
systemMapDestinationsClose?.addEventListener('click', () => setSystemMapDestinationsOpen(false))
systemMapZoomOut?.addEventListener('click', () => changeSystemMapZoom(0.5))
systemMapZoomIn?.addEventListener('click', () => changeSystemMapZoom(2))
document.querySelector('#system-map-recenter')?.addEventListener('click', resetSystemMapToPlayerCell)
document.querySelector('#system-map-overview')?.addEventListener('click', () => {
  stopSystemMapAnimation()
  systemMapZoom = 1
  systemMapPan = { x: 0, y: 0 }
  updateSystemMapZoom()
})
document.querySelector('#system-map-scan')?.addEventListener('click', () => void runSensorScan())
document.querySelector<HTMLButtonElement>('#system-map-sensor-range-toggle')?.addEventListener('click', (event) => {
  if (!(event.currentTarget instanceof HTMLButtonElement)) return
  systemMapSensorRangeVisible = !systemMapSensorRangeVisible
  const button = event.currentTarget
  button.setAttribute('aria-pressed', String(systemMapSensorRangeVisible))
  button.setAttribute('aria-label', systemMapSensorRangeVisible ? 'Hide sensor range' : 'Show sensor range')
  button.title = systemMapSensorRangeVisible ? 'Hide sensor range' : 'Show sensor range'
  button.replaceChildren(createElement(systemMapSensorRangeVisible ? Eye : EyeOff))
  updateSystemMapMarkers()
})
function resizeSystemMap() {
  if (systemMapModal?.hidden !== false || !systemMapDisplay) return
  stopSystemMapAnimation()
  updateSystemMapZoom()
}
window.addEventListener('resize', resizeSystemMap)
if (typeof ResizeObserver !== 'undefined' && systemMapDisplay) new ResizeObserver(resizeSystemMap).observe(systemMapDisplay)
systemMapDisplay?.addEventListener('keydown', (event) => {
  if (event.target !== systemMapDisplay) return
  const offsets: Record<string, { x: number; y: number }> = {
    ArrowLeft: { x: 80, y: 0 }, ArrowRight: { x: -80, y: 0 },
    ArrowUp: { x: 0, y: 80 }, ArrowDown: { x: 0, y: -80 },
  }
  const offset = offsets[event.key]
  if (offset) {
    event.preventDefault()
    stopSystemMapAnimation()
    systemMapPan.x += offset.x
    systemMapPan.y += offset.y
    updateSystemMapZoom()
  } else if (event.key === '+' || event.key === '=' || event.key === '-') {
    event.preventDefault()
    changeSystemMapZoom(event.key === '-' ? 0.5 : 2)
  } else if (event.key === 'Home') {
    event.preventDefault()
    resetSystemMapToPlayerCell()
  }
})
systemMapDisplay?.addEventListener('wheel', (event) => {
  event.preventDefault()
  const bounds = systemMapDisplay.getBoundingClientRect()
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1)
  changeSystemMapZoom(Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.002), {
    x: event.clientX - bounds.left - bounds.width / 2,
    y: event.clientY - bounds.top - bounds.height / 2,
  })
}, { passive: false })
systemMapDisplay?.addEventListener('pointerdown', (event) => {
  if (systemMapZoom === 1 || event.button !== 0) return
  stopSystemMapAnimation()
  systemMapSuppressClick = false
  systemMapDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    panX: systemMapPan.x,
    panY: systemMapPan.y,
    moved: false,
  }
})
systemMapDisplay?.addEventListener('pointermove', (event) => {
  if (!systemMapDrag || event.pointerId !== systemMapDrag.pointerId) return
  if (!systemMapDrag.moved) {
    if (Math.hypot(event.clientX - systemMapDrag.startX, event.clientY - systemMapDrag.startY) < 4) return
    systemMapDrag.moved = true
    systemMapDisplay.setPointerCapture(event.pointerId)
  }
  systemMapPan = {
    x: systemMapDrag.panX + event.clientX - systemMapDrag.startX,
    y: systemMapDrag.panY + event.clientY - systemMapDrag.startY,
  }
  updateSystemMapZoom()
})
function stopSystemMapPan(event: PointerEvent) {
  if (!systemMapDrag || event.pointerId !== systemMapDrag.pointerId) return
  systemMapSuppressClick = systemMapDrag.moved
  if (systemMapDisplay?.hasPointerCapture(event.pointerId)) systemMapDisplay.releasePointerCapture(event.pointerId)
  systemMapDrag = undefined
}
window.addEventListener('pointerup', stopSystemMapPan)
systemMapDisplay?.addEventListener('pointercancel', stopSystemMapPan)
systemMapDisplay?.addEventListener('lostpointercapture', stopSystemMapPan)
systemMapDisplay?.addEventListener('click', (event) => {
  if (!systemMapSuppressClick || event.detail === 0) return
  event.preventDefault()
  event.stopImmediatePropagation()
  systemMapSuppressClick = false
}, true)
systemPois.forEach((poi) => poi.addEventListener('click', () => selectPoi(poi.dataset.poi as PoiName)))

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
  const fittedModule = fittingSnapshot?.fitted_modules.find((module) => module.family === 'mining_laser')
  const effectiveRange = fittedModule?.effective_range_meters ?? 500
  const targetDistance = Vector3.Distance(
    new Vector3(playerMapPosition.x, playerMapPosition.y, playerMapPosition.z),
    selectedTarget.position,
  )
  if (nextIsActive && targetDistance > effectiveRange) {
    showGameToast(`MINING LASER: OUT OF RANGE (${targetDistance.toFixed(0)} M / ${effectiveRange.toFixed(0)} M)`)
    return
  }
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

function updateTargetWindow() {
  if (!targetWindow || !targetName || !targetRange || !targetLockLabel || !targetLockProgress) return
  if (!lockedTarget) {
    targetWindow.setAttribute('hidden', '')
    return
  }
  targetLockLabel.textContent = lockedTarget.locking ? 'ACQUIRING LOCK' : 'TARGET LOCK'
  targetName.textContent = lockedTarget.name
  targetThumbnail?.classList.toggle('is-ship', lockedTarget.kind === 'pilot')
  targetThumbnail?.setAttribute('data-ship-type', lockedTarget.kind === 'pilot' ? lockedTarget.shipType ?? 'starter-corvette' : '')
  const distance = Vector3.Distance(new Vector3(playerMapPosition.x, playerMapPosition.y, playerMapPosition.z), lockedTarget.position)
  targetRange.textContent = distance >= 1_000 ? `${(distance / 1_000).toFixed(1)} km` : `${distance.toFixed(0)} m`
  targetLockProgress.toggleAttribute('hidden', !lockedTarget.locking)
  targetLockProgress.firstElementChild?.setAttribute('style', `width: ${(lockedTarget.lockProgress * 100).toFixed(1)}%`)
  if (targetActiveModules) {
    const moduleIcons = [...activeModuleTargetIds]
      .filter(([, targetId]) => targetId === lockedTarget?.id)
      .map(([moduleName]) => starterHardpoints.find((module) => module.moduleName === moduleName)?.icon)
      .filter((icon): icon is string => Boolean(icon))
    targetActiveModules.innerHTML = moduleIcons.map((icon) => `<span class="target-module-icon">${icon}</span>`).join('')
  }
  document.querySelector<HTMLButtonElement>('#pickup-jettisoned-item')?.toggleAttribute('hidden', lockedTarget.kind !== 'cargo')
  targetWindow.removeAttribute('hidden')
}

function updateTargetList() {
  if (!targetListItems) return
  const configuredSensorRange = fittingSnapshot?.statistics.sensor_range_meters
  const sensorRangeMeters = typeof configuredSensorRange === 'number'
    && Number.isFinite(configuredSensorRange) && configuredSensorRange >= 0
    ? configuredSensorRange
    : 0
  const targets = (scene.getTargetables?.() ?? [])
    .filter((target) => targetListFilter === 'all' || target.kind === targetListFilter)
    .filter((target) => Vector3.Distance(new Vector3(playerMapPosition.x, playerMapPosition.y, playerMapPosition.z), target.position) <= sensorRangeMeters)
    .sort((left, right) => Vector3.Distance(new Vector3(playerMapPosition.x, playerMapPosition.y, playerMapPosition.z), left.position) - Vector3.Distance(new Vector3(playerMapPosition.x, playerMapPosition.y, playerMapPosition.z), right.position))
  targetListItems.innerHTML = targets.map((target) => {
    const distance = Vector3.Distance(new Vector3(playerMapPosition.x, playerMapPosition.y, playerMapPosition.z), target.position)
    const range = distance >= 1_000 ? `${(distance / 1_000).toFixed(1)} km` : `${distance.toFixed(0)} m`
    const selected = selectedTarget?.id === target.id
    return `<button class="target-list-item target-list-item-${target.kind}${selected ? ' is-selected' : ''}${target.locked ? ' is-locked' : ''}" type="button" data-target-id="${escapeHtml(target.id)}"><span class="target-list-type">${target.kind.toUpperCase()}</span><span class="target-list-name">${escapeHtml(target.name)}</span><span class="target-list-state">${target.locking ? 'LOCKING' : target.locked ? 'LOCKED' : 'SELECT'}</span><span class="target-list-range">${range}</span></button>`
  }).join('') || '<p class="target-list-empty">NO TARGETS IN RANGE</p>'
  targetListItems.querySelectorAll<HTMLButtonElement>('[data-target-id]').forEach((button) => {
    button.addEventListener('click', () => scene.selectTarget?.(button.dataset.targetId ?? ''))
  })
}

targetFilterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    targetListFilter = button.dataset.targetFilter as typeof targetListFilter
    targetFilterButtons.forEach((filter) => filter.setAttribute('aria-pressed', String(filter === button)))
    updateTargetList()
  })
})

clearTarget?.addEventListener('click', () => {
  scene.toggleTargetLock()
})

approachTarget?.addEventListener('click', () => {
  if (scene.approachTarget?.() && collisionAlert) collisionAlert.textContent = 'APPROACHING TARGET'
})

function renderTargetDetails() {
  if (!selectedTarget || !targetDetails || !targetDetailsTitle || !targetDetailsContent) return
  const distance = Vector3.Distance(new Vector3(playerMapPosition.x, playerMapPosition.y, playerMapPosition.z), selectedTarget.position)
  const range = distance >= 1_000 ? `${(distance / 1_000).toFixed(1)} km` : `${distance.toFixed(0)} m`
  const rows = [['Type', selectedTarget.kind], ['Range', range]]
  if (selectedTarget.kind === 'asteroid') rows.push(['Ore remaining', `${selectedTarget.oreRemainingCubicMeters.toFixed(1)} m3`])
  if (selectedTarget.kind === 'asteroid') {
    if (scannedAsteroid && scannedAsteroid.id === selectedTarget.id && selectedTarget.oreRemainingCubicMeters >= 1) {
      for (const mineral of scannedAsteroid.assay) {
        rows.push([`${mineral.definition_id.replaceAll('_', ' ')} (v${mineral.definition_version ?? mineral.version ?? 1})`, `${mineral.percentage}%`])
      }
    } else rows.push(['Assay', 'Not scanned'])
  }
  if (scanTargetAssay) {
    scanTargetAssay.hidden = selectedTarget.kind !== 'asteroid'
    scanTargetAssay.disabled = sensorScanPending || !isInSystemSpace || !selectedTarget.id || selectedTarget.oreRemainingCubicMeters < 1
  }
  targetDetailsTitle.textContent = selectedTarget.name
  targetDetailsContent.innerHTML = rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')
}

function openTargetDetails() {
  if (!selectedTarget) return
  renderTargetDetails()
  targetDetails?.showModal()
}

scanTargetAssay?.addEventListener('click', () => void scanSelectedAsteroid())

async function scanSelectedAsteroid() {
  const asteroidId = selectedTarget?.kind === 'asteroid' ? selectedTarget.id : undefined
  if (!asteroidId || sensorScanPending || !isInSystemSpace || scanTargetAssay?.disabled) return
  sensorScanPending = true
  renderTargetDetails()
  if (targetScanStatus) targetScanStatus.textContent = 'Scanning...'
  try {
    await saveShipState(null, playerMapPosition)
    if (!targetDetails?.isConnected) return
    const response = await fetch(`${apiBaseUrl}/mining/asteroids/${encodeURIComponent(asteroidId)}/scan`, {
      method: 'POST', headers: { authorization: `Bearer ${pilotAccessToken}` },
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { detail?: string }
      throw new Error(error.detail ?? `Scan failed (${response.status})`)
    }
    const payload = await response.json() as { asteroid_id: string; mineral_assay: ScannedMineral[]; power_megajoules: number }
    if (!targetDetails?.isConnected) return
    shipPowerMegajoules = payload.power_megajoules
    scene.setPowerMegajoules?.(shipPowerMegajoules)
    renderSavedShipState()
    if (selectedTarget?.id === asteroidId && payload.asteroid_id === asteroidId && selectedTarget.oreRemainingCubicMeters >= 1) {
      scannedAsteroid = { id: asteroidId, assay: payload.mineral_assay }
      if (targetScanStatus) targetScanStatus.textContent = 'Scan complete.'
    }
  } catch (error) {
    if (targetDetails?.isConnected && selectedTarget?.id === asteroidId && targetScanStatus) {
      targetScanStatus.textContent = error instanceof Error ? error.message : 'Scan failed.'
    }
  } finally {
    sensorScanPending = false
    if (targetDetails?.isConnected) renderTargetDetails()
  }
}

viewTargetDetails?.addEventListener('click', openTargetDetails)
document.querySelector<HTMLButtonElement>('#close-target-details')?.addEventListener('click', () => targetDetails?.close())

async function openDockedEntities() {
  if (isInSystemSpace || !dockedEntities || !dockedEntitiesTitle || !dockedEntitiesContent) return
  dockedEntitiesContent.innerHTML = '<p class="docked-dialog-empty">Loading docked entities...</p>'
  dockedEntities.showModal()
  try {
    const response = await fetch(`${apiBaseUrl}/inventory/docked-entities`, {
      headers: { authorization: `Bearer ${pilotAccessToken}` },
    })
    if (!response.ok) throw new Error(`Unable to load docked entities (${response.status})`)
    const payload = await response.json() as DockedEntityList
    dockedEntitiesTitle.textContent = payload.station_name
    dockedEntitiesContent.innerHTML = payload.entities.map((entity) => `
      <div class="docked-entity"><span class="docked-entity-icon" aria-hidden="true"></span><strong>${escapeHtml(entity.display_name)}</strong><small>${escapeHtml(entity.entity_type)}</small></div>
    `).join('') || '<p class="docked-dialog-empty">No other entities are docked here.</p>'
  } catch (error) {
    console.error(error)
    dockedEntitiesContent.innerHTML = '<p class="docked-dialog-empty">Unable to load docked entities.</p>'
  }
}

dockedEntitiesAction?.addEventListener('click', () => void openDockedEntities())
stationInformationAction?.addEventListener('click', () => stationInformation?.showModal())
document.querySelector<HTMLButtonElement>('#close-docked-entities')?.addEventListener('click', () => dockedEntities?.close())
document.querySelector<HTMLButtonElement>('#close-station-information')?.addEventListener('click', () => stationInformation?.close())

document.querySelector<HTMLButtonElement>('#pickup-jettisoned-item')?.addEventListener('click', () => {
  if (inventoryLocked()) return
  const feedback = document.querySelector<HTMLElement>('#cargo-pickup-feedback')
  if (feedback) feedback.textContent = 'Collecting public cargo…'
  void scene.pickupJettisonedItem?.().then((collected) => {
    if (feedback) feedback.textContent = collected ? 'Cargo collected.' : 'Collection failed or outcome unknown. Refresh inventory before trying again.'
  })
})

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
    maximumSublightSpeedMetersPerSecond: 300,
    initialLaunchSpeed,
    initialFlightAssistEnabled,
    onWarpUpdate(isWarping, phase) {
      const isInWarpTransit = isWarping && (phase === 'warping' || phase === 'cruising')
      warpOverlay?.toggleAttribute('hidden', !isInWarpTransit)
      warpOverlay?.setAttribute('data-phase', phase)
    },
    onTargetSelectionChange(target) {
      if (selectedTarget?.id !== target?.id || (target?.oreRemainingCubicMeters ?? 0) < 1) {
        scannedAsteroid = undefined
        if (targetScanStatus) targetScanStatus.textContent = ''
      }
      selectedTarget = target
      if (targetDetails?.open) {
        if (target) renderTargetDetails()
        else targetDetails.close()
      }
      if (target?.locked || target?.locking) lockedTarget = target
      else if (lockedTarget?.id === target?.id) lockedTarget = undefined
      updateTargetWindow()
      updateTargetList()
      updateHardpointAvailability()
    },
    onModuleActiveChange(moduleName, isActive, targetId) {
      const moduleSlot = Array.from(moduleSlots).find((slot) => slot.dataset.module === moduleName)
      if (isActive && targetId) activeModuleTargetIds.set(moduleName, targetId)
      else if (!isActive) activeModuleTargetIds.delete(moduleName)
      if (moduleSlot) {
        moduleSlot.setAttribute('aria-pressed', String(isActive))
        moduleSlot.classList.toggle('is-active', isActive)
      }
      updateTargetWindow()
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
      playerMapYaw = yaw
      positionSystemMapMarker(systemMapPlayer, playerMapPosition)
      systemMapPlayer?.style.setProperty('--heading-degrees', `${playerMapYaw * 180 / Math.PI}deg`)
      updateTargetWindow()
      if (performance.now() - lastTargetListUpdateAt >= 250) {
        lastTargetListUpdateAt = performance.now()
        updateTargetList()
        updateSystemMapMarkers()
      }
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
const realtimeUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/v1/realtime?token=${encodeURIComponent(pilotAccessToken)}`
let realtimeSocket: WebSocket | undefined
let realtimeReconnectTimer: number | undefined
let realtimeReconnectEnabled = true
let scene = createFlightScene()
updateTargetList()

async function loadActiveFitting() {
  const response = await fetch(`${apiBaseUrl}/fitting/active`, {
    headers: { authorization: `Bearer ${pilotAccessToken}` },
  })
  if (!response.ok) return
  const snapshot = await response.json() as FittingSnapshot
  if (!snapshot.statistics) return
  fittingSnapshot = snapshot
  scene.setMaximumSublightSpeedMetersPerSecond?.(snapshot.statistics.maximum_speed ?? 300)
  updateTargetList()
}

void loadActiveFitting().catch((error: unknown) => console.error('Unable to load active fitting.', error))

function revealDiscoveredFields(fields: DiscoveredField[]) {
  fields.forEach((field) => {
    discoveredFields.set(field.id, field)
    poiDetails[`discovered-field-${field.id}`] = {
      type: 'SCANNED ASTEROID FIELD',
      name: field.display_name,
      description: `Sensor contact resolved at ${(field.scan_quality * 100).toFixed(0)}% quality.`,
      position: { x: field.position_x, y: field.position_y, z: field.position_z },
    }
  })
  updateSystemMapMarkers()
  if (systemMapModal?.hidden === false) renderSystemMapDestinations()
}

async function loadDiscoveryBootstrap() {
  const response = await fetch(`${apiBaseUrl}/mining/bootstrap`, {
    headers: { authorization: `Bearer ${pilotAccessToken}` },
  })
  if (!response.ok) return
  const payload = await response.json() as { discovered_fields: DiscoveredField[]; resource_zones?: MapResourceZone[]; system?: { radius_meters: number } }
  mapResourceZones = payload.resource_zones ?? []
  if (payload.system) mapSystemRadiusMeters = payload.system.radius_meters
  revealDiscoveredFields(payload.discovered_fields)
  updateSystemMapZoom()
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
  const mapScanButton = document.querySelector<HTMLButtonElement>('#system-map-scan')
  if (sensorScanPending || sensorButton?.disabled || sensorButton?.getAttribute('aria-busy') === 'true' || !isInSystemSpace) return
  sensorScanPending = true
  renderTargetDetails()
  sensorButton?.setAttribute('aria-busy', 'true')
  mapScanButton?.setAttribute('aria-busy', 'true')
  const survey = { ...playerMapPosition, radius: currentSensorRange() }
  try {
    await saveShipState(null, survey)
    const response = await fetch(`${apiBaseUrl}/mining/scan`, {
      method: 'POST',
      headers: { authorization: `Bearer ${pilotAccessToken}` },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { detail?: string }
      showGameToast(response.status === 429 ? 'SENSORS RECHARGING' : body.detail?.toUpperCase() ?? `SENSOR SCAN FAILED (${response.status})`)
      return
    }
    const payload = await response.json() as { newly_discovered_fields: DiscoveredField[]; resource_zones?: MapResourceZone[]; power_megajoules: number; cooldown_seconds: number }
    shipPowerMegajoules = payload.power_megajoules
    scene.setPowerMegajoules?.(shipPowerMegajoules)
    renderSavedShipState()
    scene.emitSensorPing?.()
    systemMapSurveys.push(survey)
    const footprint = document.createElement('div')
    footprint.className = 'system-map-survey'
    document.querySelector('#system-map-surveys')?.append(footprint)
    const surveyStatus = document.querySelector('#system-map-survey-status')
    if (surveyStatus) surveyStatus.textContent = `${systemMapSurveys.length} SESSION SCAN${systemMapSurveys.length === 1 ? '' : 'S'}`
    revealDiscoveredFields(payload.newly_discovered_fields)
    mapResourceZones = payload.resource_zones ?? mapResourceZones
    updateSystemMapZoom()
    showGameToast(payload.newly_discovered_fields.length > 0
      ? `SCAN COMPLETE: ${payload.newly_discovered_fields.length} FIELD${payload.newly_discovered_fields.length === 1 ? '' : 'S'} DISCOVERED`
      : 'SCAN COMPLETE: NO NEW SIGNALS')
    void refreshNearbyAsteroids()
  } catch {
    showGameToast('SENSOR SCAN FAILED: CONNECTION UNAVAILABLE')
  } finally {
    sensorScanPending = false
    renderTargetDetails()
    sensorButton?.removeAttribute('aria-busy')
    mapScanButton?.removeAttribute('aria-busy')
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

void loadDiscoveryBootstrap()
void loadShipInventory(true)

function handleRealtimeMessage(event: MessageEvent<string>) {
  const message = JSON.parse(event.data) as { type: string; payload: { pilots?: { pilot_id: string; display_name: string; ship_type: string; x: number; y: number; z: number; yaw: number; pitch: number; roll: number }[]; pilot_id?: string; target_pilot_id?: string; display_name?: string; ship_type?: string; x?: number; y?: number; z?: number; yaw?: number; pitch?: number; roll?: number; active?: boolean; source_x?: number; source_y?: number; source_z?: number; target_x?: number; target_y?: number; target_z?: number; behavior_state?: string; warp_phase?: 'aligning' | 'accelerating' | 'warping' | 'cruising' | 'decelerating'; docked?: boolean } }
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
  if (message.type === 'pilot_activity' && message.payload.pilot_id && message.payload.behavior_state && message.payload.docked !== undefined && message.payload.target_x !== undefined && message.payload.target_y !== undefined && message.payload.target_z !== undefined) {
    scene.setRemotePilotActivity?.(message.payload.pilot_id, {
      behaviorState: message.payload.behavior_state,
      warpPhase: message.payload.warp_phase,
      docked: message.payload.docked,
      target: new Vector3(message.payload.target_x, message.payload.target_y, message.payload.target_z),
    })
    return
  }
  if (message.type === 'pilot_targeting' && message.payload.target_pilot_id === selectedPilotId) {
    scene.setHostileTargeting?.(message.payload.pilot_id ?? '', message.payload.active === true)
    return
  }
  if ((message.type === 'pilot_joined' || message.type === 'pilot_moved') && message.payload.pilot_id && message.payload.display_name && message.payload.ship_type && message.payload.x !== undefined && message.payload.y !== undefined && message.payload.z !== undefined && message.payload.yaw !== undefined && message.payload.pitch !== undefined && message.payload.roll !== undefined) {
    scene.updateRemotePilot?.({ pilotId: message.payload.pilot_id, displayName: message.payload.display_name, shipType: message.payload.ship_type, position: new Vector3(message.payload.x, message.payload.y, message.payload.z), yaw: message.payload.yaw, pitch: message.payload.pitch, roll: message.payload.roll })
  }
}

function connectRealtime() {
  const socket = new WebSocket(realtimeUrl)
  realtimeSocket = socket
  socket.addEventListener('open', () => {
    if (!isInSystemSpace) socket.send(JSON.stringify({ type: 'docked', payload: {} }))
  })
  socket.addEventListener('message', handleRealtimeMessage)
  socket.addEventListener('close', () => {
    if (!realtimeReconnectEnabled || realtimeSocket !== socket) return
    realtimeReconnectTimer = window.setTimeout(connectRealtime, 1_000)
  })
}

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
  stopRefineryClock()
  document.querySelector('.game-shell')?.classList.remove('is-refining', 'is-market')
  stationServices?.setAttribute('hidden', '')
}

function openStationServices(selectedService: string) {
  if (locationTransitionPending || isInSystemSpace) return
  closeGameModal()
  stationServices?.removeAttribute('hidden')
  stationServicePanel?.removeAttribute('hidden')
  document.querySelector('.game-shell')?.classList.toggle('is-refining', selectedService === 'refining')
    document.querySelector('.game-shell')?.classList.toggle('is-market', selectedService === 'market')
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
  const position = docking ? { ...playerMapPosition } : { x: -2_600_000_000, y: 480, z: -4_510_179_990.5 }
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
    if (selectedService === 'market') void loadDockedMarket().catch((error: unknown) => { if (marketPanel) marketPanel.innerHTML = '<p class="station-service-empty">Unable to load the Kepler market.</p>'; console.error(error) })
    if (selectedService === 'refining') void loadDockedRefinery().catch((error: unknown) => {
      if (refiningPanel) refiningPanel.innerHTML = '<p class="station-service-empty">Unable to load the Kepler refinery.</p>'
      console.error(error)
    })
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
  import.meta.hot.dispose(() => {
    checkpointBeforeExit()
    scene.dispose()
  })
}

let exitCheckpointStarted = false
function checkpointBeforeExit() {
  if (exitCheckpointStarted) return
  exitCheckpointStarted = true
  const dockedStationName = document.querySelector('.game-shell')?.classList.contains('is-docked') ? 'KEPLER STATION' : null
  void saveShipState(dockedStationName).catch(() => undefined)
}

window.addEventListener('pagehide', () => {
  checkpointBeforeExit()
  scene.dispose()
}, { once: true })
}
