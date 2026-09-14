import './admin.css'

type InventorySummary = {
  container_type: string
  item_stacks: number
  item_units: number
  ore_lots: number
  volume_cubic_meters: number
  items: InventoryItem[]
  raw_ore_lots: RawOreLot[]
}

type InventoryItem = {
  definition_id: string
  quantity: number
  durability: number
  volume_per_unit: number
}

type RawOreLot = {
  composition: string
  volume_cubic_meters: number
}

type MarketOrder = {
  definition_id: string
  quantity: number
  unit_price_credits: number
  expires_at: string
}

type ActiveRefineryJob = {
  refinery_name: string
  stage: string
  state: string
  queue_sequence: number
  quoted_duration_seconds: number
  quoted_efficiency: number
  quoted_fee_credits: number
  started_at: string | null
  completes_at: string | null
}

type NpcState = {
  pilot_id: string
  display_name: string
  archetype_key: string
  backstory: string
  motivations: string[]
  capabilities: string[]
  lifecycle_state: 'active' | 'paused' | 'retired'
  behavior_state: string
  location_kind: 'docked' | 'space'
  station_name: string | null
  position_x: number
  position_y: number
  position_z: number
  cargo_cubic_meters: number
  inventory: InventorySummary[]
  wallet_balance_credits: number
  open_market_orders: MarketOrder[]
  active_refinery_jobs: ActiveRefineryJob[]
}

type PlayerMapPresence = {
  pilot_id: string
  display_name: string
  location_kind: 'docked' | 'space'
  station_name: string | null
  position_x: number
  position_y: number
  position_z: number
  cargo_cubic_meters: number
  inventory: InventorySummary[]
  wallet_balance_credits: number
  open_market_orders: MarketOrder[]
  active_refinery_jobs: ActiveRefineryJob[]
}

type AsteroidFieldMapPresence = {
  id: string
  display_name: string
  position_x: number
  position_y: number
  position_z: number
}

type SystemState = {
  npcs: NpcState[]
  players: PlayerMapPresence[]
  asteroid_fields: AsteroidFieldMapPresence[]
  system_radius_meters: number
}

type Panel = 'overview' | 'state' | 'inventory' | 'market' | 'refining' | 'navigation'
type PopulationView = 'control' | 'map'

type SystemPoint = {
  name: string
  kind: 'star' | 'world' | 'station' | 'belt'
  x: number
  z: number
}

const apiBaseUrl = 'http://127.0.0.1:8000/api/v1/admin'
const app = document.querySelector<HTMLDivElement>('#app')

if (!app) throw new Error('Application root was not found.')
const appRoot = app

let npcs: NpcState[] = []
let players: PlayerMapPresence[] = []
let asteroidFields: AsteroidFieldMapPresence[] = []
let selectedPilotId = new URLSearchParams(window.location.search).get('pilot_id')
let populationView: PopulationView = new URLSearchParams(window.location.search).get('view') === 'map' ? 'map' : 'control'
let activePanel: Panel = 'overview'
let npcFilter = ''
let mapZoom = 1
let mapPan = { x: 0, y: 0 }
let mapZoomTarget = 1
let mapPanTarget = { x: 0, y: 0 }
let mapDrag: { pointerId: number; startX: number; startY: number; panX: number; panY: number } | undefined
let mapAnimation: number | undefined
let mapRefreshTimer: number | undefined
const systemMapHalfExtentMeters = 5_000_000_000
const systemMapCellSizeMeters = 100_000_000
const systemMapMaximumZoom = 100_000_000
const systemPoints: SystemPoint[] = [
  { name: 'PRIMARY STAR', kind: 'star', x: 0, z: 0 },
  { name: 'STARTER WORLD', kind: 'world', x: 3_000_000_000, z: 0 },
  { name: 'KEPLER STATION', kind: 'station', x: 3_000_000_000, z: -50_000 },
]

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character)
}

function locationLabel(npc: NpcState): string {
  return npc.location_kind === 'docked' ? npc.station_name ?? 'Station' : 'Kepler system space'
}

function selectedNpc(): NpcState | undefined {
  return npcs.find((npc) => npc.pilot_id === selectedPilotId)
}

function selectedPlayer(): PlayerMapPresence | undefined {
  return players.find((player) => player.pilot_id === selectedPilotId)
}

function filteredNpcs(): NpcState[] {
  const query = npcFilter.trim().toLowerCase()
  if (!query) return npcs
  return npcs.filter((npc) => [npc.display_name, npc.archetype_key, npc.behavior_state, locationLabel(npc)]
    .some((value) => value.toLowerCase().includes(query)))
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string }
    throw new Error(body.detail ?? `Request failed with ${response.status}`)
  }
  return response.json() as Promise<T>
}

function setStatus(message: string, tone: 'success' | 'error' | 'neutral' = 'neutral') {
  const status = document.querySelector<HTMLElement>('#npc-status')
  if (!status) return
  status.textContent = message
  status.dataset.tone = tone
}

function systemMapMarkup(): string {
  const poiCount = systemPoints.length + asteroidFields.length + npcs.length + players.length
  return `<section id="admin-system-chart" class="admin-system-chart" aria-label="Kepler system chart showing all points of interest"><header class="admin-system-chart-heading"><div><p class="eyebrow">KEPLER / ADMINISTRATIVE NAVIGATION</p><h3 id="admin-system-map-title">KEPLER SYSTEM</h3></div><div class="map-controls"><button id="map-fullscreen" type="button" aria-label="Enter fullscreen map" title="Enter fullscreen map">&#x26F6;</button><button id="map-recenter" type="button" aria-label="Recenter map" title="Recenter map">&#8982;</button><button id="map-zoom-out" type="button" aria-label="Zoom out" title="Zoom out">−</button><button id="map-zoom-in" type="button" aria-label="Zoom in" title="Zoom in">+</button></div></header><div class="admin-system-map-viewport" aria-label="Kepler system grid with every point of interest"><div class="admin-system-map-scale" aria-hidden="true"><span id="admin-system-map-coordinate">ALL POIS: ${poiCount}</span><span>X / Z PLANE</span></div><div id="system-map-canvas" class="admin-system-map ${mapZoom >= 10 ? 'is-detail-scale' : ''}" role="list" style="--map-marker-scale:${1 / mapZoom};transform:translate(${mapPan.x}px,${mapPan.y}px) scale(${mapZoom})">${systemPoints.map((point) => {
    return `<div class="map-point map-point-${point.kind}" data-map-x="${point.x}" data-map-z="${point.z}" title="${point.name}"><span></span><strong>${point.name}</strong></div>`
  }).join('')}${asteroidFields.map((field) => {
    return `<div class="map-field" data-map-x="${field.position_x}" data-map-z="${field.position_z}" title="${escapeHtml(field.display_name)}"><span></span><strong>${escapeHtml(field.display_name)}</strong></div>`
  }).join('')}${npcs.map((npc) => {
    return `<button class="map-npc state-${npc.lifecycle_state}" data-map-x="${npc.position_x}" data-map-z="${npc.position_z}" data-npc-id="${npc.pilot_id}" type="button" aria-label="Open ${escapeHtml(npc.display_name)} details"><span></span><strong>${escapeHtml(npc.display_name)}</strong><small>${escapeHtml(npc.behavior_state.replaceAll('_', ' '))}</small></button>`
  }).join('')}${players.map((player) => {
    return `<div class="map-player" data-map-x="${player.position_x}" data-map-z="${player.position_z}" title="${escapeHtml(player.display_name)} - ${player.location_kind}"><span></span><strong>${escapeHtml(player.display_name)}</strong><small>${player.location_kind === 'docked' ? 'docked' : 'in space'}</small></div>`
  }).join('')}</div><div class="admin-system-map-ruler" aria-hidden="true"><span id="admin-system-map-ruler-label">1,000,000 km</span><i id="admin-system-map-ruler-line"></i></div><div class="admin-system-map-footer" aria-hidden="true"><span id="admin-system-map-grid-label">100 x 100 CELLS / ADMINISTRATIVE ALL-POI OVERLAY</span><span>${npcs.length} NPCS / ${players.length} PLAYERS / ${asteroidFields.length} FIELDS</span></div></div><div class="map-legend"><span><i class="map-point-star"></i> Star</span><span><i class="map-point-world"></i> World</span><span><i class="map-point-station"></i> Station</span><span><i class="map-field"></i> Active field</span><span><i class="state-active"></i> NPC</span><span><i class="map-player"></i> Player</span></div></section>`
}

function formatMapDistance(meters: number): string {
  return `${(meters / 1_000).toLocaleString('en-US', { maximumFractionDigits: 2 })} km`
}

function stopMapAnimation() {
  if (mapAnimation !== undefined) window.cancelAnimationFrame(mapAnimation)
  mapAnimation = undefined
}

function resetMapView() {
  stopMapAnimation()
  mapZoom = 1
  mapZoomTarget = 1
  mapPan = { x: 0, y: 0 }
  mapPanTarget = { x: 0, y: 0 }
  updateMapView()
}

async function toggleMapFullscreen() {
  const chart = document.querySelector<HTMLElement>('#admin-system-chart')
  if (!chart) return
  if (document.fullscreenElement === chart) {
    await document.exitFullscreen()
  } else {
    await chart.requestFullscreen()
  }
}

function updateMapFullscreenControl() {
  const chart = document.querySelector<HTMLElement>('#admin-system-chart')
  const button = document.querySelector<HTMLButtonElement>('#map-fullscreen')
  if (!chart || !button) return
  const isFullscreen = document.fullscreenElement === chart
  button.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen map' : 'Enter fullscreen map')
  button.title = isFullscreen ? 'Exit fullscreen map' : 'Enter fullscreen map'
  button.innerHTML = isFullscreen ? '&#x2715;' : '&#x26F6;'
  window.requestAnimationFrame(updateMapView)
}

function changeMapZoom(factor: number, anchor = { x: 0, y: 0 }) {
  const previousZoom = mapAnimation === undefined ? mapZoom : mapZoomTarget
  mapZoomTarget = Math.max(1, Math.min(systemMapMaximumZoom, previousZoom * factor))
  const ratio = mapZoomTarget / mapZoom
  mapPanTarget = {
    x: anchor.x - (anchor.x - mapPan.x) * ratio,
    y: anchor.y - (anchor.y - mapPan.y) * ratio,
  }
  stopMapAnimation()
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    mapZoom = mapZoomTarget
    mapPan = { ...mapPanTarget }
    updateMapView()
    return
  }
  let previousTime = performance.now()
  const animate = (time: number) => {
    const amount = 1 - Math.exp(-Math.max(1, time - previousTime) / 65)
    previousTime = time
    mapZoom += (mapZoomTarget - mapZoom) * amount
    mapPan.x += (mapPanTarget.x - mapPan.x) * amount
    mapPan.y += (mapPanTarget.y - mapPan.y) * amount
    const complete = Math.abs(mapZoom - mapZoomTarget) / mapZoomTarget < 0.00001
    if (complete) {
      mapZoom = mapZoomTarget
      mapPan = { ...mapPanTarget }
    }
    updateMapView()
    mapAnimation = complete ? undefined : window.requestAnimationFrame(animate)
  }
  mapAnimation = window.requestAnimationFrame(animate)
}

function clampMapPan() {
  const viewport = document.querySelector<HTMLElement>('.admin-system-map-viewport, .system-map-viewport')
  if (!viewport || mapZoom === 1) {
    mapPan = { x: 0, y: 0 }
    return
  }
  const maximumX = (viewport.clientWidth * (mapZoom - 1)) / 2
  const maximumY = (viewport.clientHeight * (mapZoom - 1)) / 2
  mapPan.x = Math.max(-maximumX, Math.min(maximumX, mapPan.x))
  mapPan.y = Math.max(-maximumY, Math.min(maximumY, mapPan.y))
}

function updateMapView() {
  clampMapPan()
  const canvas = document.querySelector<HTMLElement>('#system-map-canvas')
  if (!canvas) return
  const viewport = document.querySelector<HTMLElement>('.admin-system-map-viewport, .system-map-viewport')
  const side = Math.min(viewport?.clientWidth || 800, viewport?.clientHeight || 600)
  const scale = side * mapZoom / (systemMapHalfExtentMeters * 2)
  const span = (viewport?.clientWidth || 800) / scale
  const detail = span <= 2_000_000 ? 'local' : span <= 1_000_000_000 ? 'sector' : 'system'
  canvas.dataset.detail = detail
  canvas.classList.toggle('is-detail-scale', detail === 'local')
  canvas.style.setProperty('--map-marker-scale', '1')
  canvas.style.transform = 'none'
  const baseStep = 10 ** Math.floor(Math.log10(70 / scale))
  const step = baseStep * ([1, 2, 5, 10].find((multiple) => baseStep * multiple * scale >= 70) ?? 10)
  canvas.style.backgroundSize = `${step * scale}px ${step * scale}px`
  const viewportWidth = viewport?.clientWidth || 800
  const viewportHeight = viewport?.clientHeight || 600
  canvas.querySelectorAll<HTMLElement>('[data-map-x][data-map-z]').forEach((marker) => {
    const x = Number(marker.dataset.mapX)
    const z = Number(marker.dataset.mapZ)
    marker.style.left = `${viewportWidth / 2 + (x + mapPan.x / scale) * scale}px`
    marker.style.top = `${viewportHeight / 2 - (z - mapPan.y / scale) * scale}px`
  })
  const coordinate = document.querySelector<HTMLElement>('#admin-system-map-coordinate')
  if (coordinate) coordinate.textContent = `X ${formatMapDistance(-mapPan.x / scale)} / Z ${formatMapDistance(mapPan.y / scale)}`
  const title = document.querySelector<HTMLElement>('#admin-system-map-title')
  if (title) title.textContent = detail === 'local' ? 'LOCAL SPACE' : detail === 'sector' ? 'SECTOR CHART' : 'KEPLER SYSTEM'
  const gridLabel = document.querySelector<HTMLElement>('#admin-system-map-grid-label')
  if (gridLabel) gridLabel.textContent = `CELL X ${Math.floor((-mapPan.x / scale) / systemMapCellSizeMeters)} / Z ${Math.floor((mapPan.y / scale) / systemMapCellSizeMeters)} / ${formatMapDistance(step)} GRID / ${formatMapDistance(span)} ACROSS`
  const rulerBase = 10 ** Math.floor(Math.log10(160 / scale))
  const rulerDistance = rulerBase * ([5, 2, 1].find((multiple) => rulerBase * multiple * scale <= 160) ?? 1)
  const ruler = document.querySelector<HTMLElement>('#admin-system-map-ruler-line')
  if (ruler) ruler.style.width = `${rulerDistance * scale}px`
  const rulerLabel = document.querySelector<HTMLElement>('#admin-system-map-ruler-label')
  if (rulerLabel) rulerLabel.textContent = formatMapDistance(rulerDistance)
}

function npcDirectoryMarkup(): string {
  const visibleNpcs = filteredNpcs()
  const visiblePlayers = players.filter((player) => !npcFilter.trim() || [player.display_name, player.location_kind, player.station_name ?? ''].some((value) => value.toLowerCase().includes(npcFilter.trim().toLowerCase())))
  return `<aside class="npc-directory"><label class="npc-filter">FILTER PILOTS <input id="npc-filter" type="search" value="${escapeHtml(npcFilter)}" placeholder="Name, role, state, location"></label><div class="directory-heading"><span>NPCs</span><span>${visibleNpcs.length} of ${npcs.length}</span></div>${visibleNpcs.map((npc) => `<button class="npc-row ${npc.pilot_id === selectedPilotId ? 'is-selected' : ''}" data-npc-id="${npc.pilot_id}" type="button"><span class="npc-name">${escapeHtml(npc.display_name)}</span><span class="state state-${npc.lifecycle_state}">${escapeHtml(npc.behavior_state.replaceAll('_', ' '))}</span><span class="npc-location">${escapeHtml(locationLabel(npc))}</span></button>`).join('') || '<p class="loading">No matching NPCs.</p>'}<div class="directory-heading"><span>Players</span><span>${visiblePlayers.length} of ${players.length}</span></div>${visiblePlayers.map((player) => `<button class="npc-row ${player.pilot_id === selectedPilotId ? 'is-selected' : ''}" data-player-id="${player.pilot_id}" type="button"><span class="npc-name">${escapeHtml(player.display_name)}</span><span class="state">player</span><span class="npc-location">${escapeHtml(player.location_kind === 'docked' ? player.station_name ?? 'Station' : 'Kepler system space')}</span></button>`).join('') || '<p class="loading">No matching players.</p>'}</aside>`
}

function overviewMarkup(npc: NpcState): string {
  return `<div class="npc-detail-grid">
    <dl><dt>Role</dt><dd>${escapeHtml(npc.archetype_key.replaceAll('_', ' '))}</dd><dt>Lifecycle</dt><dd>${npc.lifecycle_state}</dd><dt>Behavior</dt><dd>${escapeHtml(npc.behavior_state.replaceAll('_', ' '))}</dd></dl>
    <dl><dt>Location</dt><dd>${escapeHtml(locationLabel(npc))}</dd><dt>Wallet</dt><dd>${npc.wallet_balance_credits.toLocaleString()} credits</dd><dt>Open orders</dt><dd>${npc.open_market_orders.length}</dd><dt>Cargo</dt><dd>${npc.cargo_cubic_meters.toFixed(1)} m3</dd></dl>
    <div class="npc-story"><p class="eyebrow">Background Story</p><p>${escapeHtml(npc.backstory)}</p><p class="eyebrow">Motivations</p><ul>${npc.motivations.map((motivation) => `<li>${escapeHtml(motivation)}</li>`).join('')}</ul></div>
  </div>`
}

function stateMarkup(npc: NpcState): string {
  return `<div class="npc-state-readout"><dl><dt>Current location</dt><dd>${escapeHtml(locationLabel(npc))}</dd><dt>World state</dt><dd>${npc.location_kind}</dd><dt>Simulation state</dt><dd>${escapeHtml(npc.behavior_state.replaceAll('_', ' '))}</dd></dl><dl><dt>X</dt><dd>${npc.position_x.toFixed(0)}</dd><dt>Y</dt><dd>${npc.position_y.toFixed(0)}</dd><dt>Z</dt><dd>${npc.position_z.toFixed(0)}</dd></dl></div>`
}

function inventoryMarkup(npc: NpcState): string {
  if (!npc.inventory.length) return '<p class="loading">Inventory containers will appear after this NPC enters the simulation.</p>'
  return `<div class="npc-inventory-detail">${npc.inventory.map((container) => `<section class="npc-container"><header><div><p class="eyebrow">${escapeHtml(container.container_type === 'ship_cargo' ? 'Cargo' : 'Station Storage')}</p><h3>${container.volume_cubic_meters.toFixed(1)} m3</h3></div><span>${container.item_stacks} stacks · ${container.ore_lots} ore lots</span></header>${container.items.length || container.raw_ore_lots.length ? `<div class="npc-inventory-table"><div class="inventory-heading"><span>Contents</span><span>Quantity</span><span>Volume</span></div>${container.items.map((item) => `<div class="inventory-row"><span>${escapeHtml(item.definition_id)}</span><span>${item.quantity}</span><span>${(item.quantity * item.volume_per_unit).toFixed(1)} m3</span></div>`).join('')}${container.raw_ore_lots.map((lot) => `<div class="inventory-row ore-row"><span>${escapeHtml(lot.composition)} raw ore</span><span>1 lot</span><span>${lot.volume_cubic_meters.toFixed(1)} m3</span></div>`).join('')}</div>` : '<p class="loading">Empty container.</p>'}</section>`).join('')}</div>`
}

function marketMarkup(npc: NpcState): string {
  if (!npc.open_market_orders.length) return '<p class="loading">No open market orders.</p>'
  return `<section class="npc-market"><header><div><p class="eyebrow">Wallet Balance</p><h3>${npc.wallet_balance_credits.toLocaleString()} credits</h3></div><span>${npc.open_market_orders.length} open orders</span></header><div class="npc-inventory-table"><div class="inventory-heading"><span>Item</span><span>Quantity</span><span>Unit price</span><span>Total</span><span>Expires</span></div>${npc.open_market_orders.map((order) => `<div class="inventory-row"><span>${escapeHtml(order.definition_id)}</span><span>${order.quantity}</span><span>${order.unit_price_credits.toLocaleString()}</span><span>${(order.quantity * order.unit_price_credits).toLocaleString()}</span><span>${new Date(order.expires_at).toLocaleDateString()}</span></div>`).join('')}</div></section>`
}

function refiningMarkup(jobs: ActiveRefineryJob[]): string {
  if (!jobs.length) return '<p class="loading">No active refinery jobs.</p>'
  return `<section class="npc-market"><header><div><p class="eyebrow">Active Refining</p><h3>${jobs.length} active jobs</h3></div></header><div class="npc-inventory-table"><div class="inventory-heading"><span>Refinery</span><span>Stage</span><span>State</span><span>Queue</span><span>Completes</span></div>${jobs.map((job) => `<div class="inventory-row"><span>${escapeHtml(job.refinery_name)}</span><span>${escapeHtml(job.stage)}</span><span>${escapeHtml(job.state)}</span><span>${job.queue_sequence + 1}</span><span>${job.completes_at ? new Date(job.completes_at).toLocaleString() : 'Waiting'}</span></div>`).join('')}</div></section>`
}

function navigationMarkup(npc: NpcState): string {
  const mapPosition = (x: number, z: number) => ({
    left: Math.min(99.5, Math.max(0.5, 50 + (x / systemMapHalfExtentMeters) * 50)),
    top: Math.min(99.5, Math.max(0.5, 50 - (z / systemMapHalfExtentMeters) * 50)),
  })
  const npcPosition = mapPosition(npc.position_x, npc.position_z)
  return `<section class="npc-navigation-map"><div class="section-heading"><div><p class="eyebrow">Navigation Map</p><h3>${escapeHtml(npc.display_name)}</h3></div><span class="population-count">${escapeHtml(npc.behavior_state.replaceAll('_', ' '))}</span></div><div class="map-controls"><button id="map-zoom-out" type="button" aria-label="Zoom out" title="Zoom out">−</button><button id="map-zoom-in" type="button" aria-label="Zoom in" title="Zoom in">+</button></div><div class="map-scale" aria-hidden="true"><span>-5,000,000 km</span><span>0 km</span><span>+5,000,000 km</span></div><div class="system-map-viewport" aria-label="Kepler system map centered on ${escapeHtml(npc.display_name)}"><div id="system-map-canvas" class="system-map system-map-grid ${mapZoom >= 10 ? 'is-detail-scale' : ''}" role="list" style="--map-marker-scale:${1 / mapZoom};transform:translate(${mapPan.x}px,${mapPan.y}px) scale(${mapZoom})">${systemPoints.map((point) => {
    const position = mapPosition(point.x, point.z)
    return `<div class="map-point map-point-${point.kind}" style="left:${position.left.toFixed(2)}%;top:${position.top.toFixed(2)}%" title="${point.name}"><span></span><strong>${point.name}</strong></div>`
  }).join('')}${asteroidFields.map((field) => {
    const position = mapPosition(field.position_x, field.position_z)
    return `<div class="map-field" style="left:${position.left.toFixed(2)}%;top:${position.top.toFixed(2)}%" title="${escapeHtml(field.display_name)}"><span></span><strong>${escapeHtml(field.display_name)}</strong></div>`
  }).join('')}<div class="map-npc state-${npc.lifecycle_state}" style="left:${npcPosition.left.toFixed(2)}%;top:${npcPosition.top.toFixed(2)}%" role="listitem"><span></span><strong>${escapeHtml(npc.display_name)}</strong><small>${escapeHtml(npc.behavior_state.replaceAll('_', ' '))}</small></div></div></div><div class="map-legend"><span><i class="map-point-star"></i> Star</span><span><i class="map-point-world"></i> World</span><span><i class="map-point-station"></i> Station</span><span><i class="map-field"></i> Active field</span><span><i class="state-active"></i> Selected NPC</span></div></section><div class="npc-navigation"><form id="coordinate-move-form" class="coordinate-form"><p class="eyebrow">Move To Coordinates</p><label>X <input name="position_x" type="number" step="1" value="${npc.position_x}" required></label><label>Y <input name="position_y" type="number" step="1" value="${npc.position_y}" required></label><label>Z <input name="position_z" type="number" step="1" value="${npc.position_z}" required></label><button type="submit">MOVE TO COORDINATES</button></form><div class="dock-command"><p class="eyebrow">Station Command</p><p>Place this NPC at Kepler Station. The mining controller will resume its normal docked behavior.</p><button id="dock-npc" class="secondary" type="button">DOCK AT KEPLER STATION</button></div></div>`
}

function contentMarkup(npc: NpcState): string {
  if (activePanel === 'state') return stateMarkup(npc)
  if (activePanel === 'inventory') return inventoryMarkup(npc)
  if (activePanel === 'market') return marketMarkup(npc)
  if (activePanel === 'refining') return refiningMarkup(npc.active_refinery_jobs)
  if (activePanel === 'navigation') return navigationMarkup(npc)
  return overviewMarkup(npc)
}

function detailMarkup(): string {
  const npc = selectedNpc()
  const player = selectedPlayer()
  if (!npc && !player) return '<p class="loading">Select a pilot to inspect their game state.</p>'
  if (player) return playerDetailMarkup(player)
  if (!npc) return '<p class="loading">Select a pilot to inspect their game state.</p>'
  const panels: { key: Panel; label: string }[] = [
    { key: 'overview', label: 'Overview' }, { key: 'state', label: 'State' },
    { key: 'inventory', label: 'Inventory' }, { key: 'market', label: 'Market' }, { key: 'refining', label: 'Refining' }, { key: 'navigation', label: 'Navigation' },
  ]
  return `<div class="npc-detail"><header class="npc-detail-header"><div><p class="eyebrow">${escapeHtml(npc.archetype_key.replaceAll('_', ' '))}</p><h2>${escapeHtml(npc.display_name)}</h2></div><div class="npc-detail-actions"><span class="state state-${npc.lifecycle_state}">${npc.lifecycle_state}</span><button id="delete-npc" type="button">DELETE NPC</button></div></header><nav class="npc-subnav" aria-label="NPC details">${panels.map((panel) => `<button class="${activePanel === panel.key ? 'is-active' : ''}" data-panel="${panel.key}" type="button">${panel.label}</button>`).join('')}</nav><section class="npc-detail-content">${contentMarkup(npc)}</section></div>`
}

function playerDetailMarkup(player: PlayerMapPresence): string {
  const playerState = { ...player, behavior_state: 'player_controlled' }
  const panels: { key: Exclude<Panel, 'navigation'>; label: string }[] = [
    { key: 'overview', label: 'Overview' }, { key: 'state', label: 'State' },
    { key: 'inventory', label: 'Inventory' }, { key: 'market', label: 'Market' }, { key: 'refining', label: 'Refining' },
  ]
  const content = activePanel === 'state' ? stateMarkup(playerState as NpcState) : activePanel === 'inventory' ? inventoryMarkup(playerState as NpcState) : activePanel === 'market' ? marketMarkup(playerState as NpcState) : activePanel === 'refining' ? refiningMarkup(player.active_refinery_jobs) : `<div class="npc-detail-grid"><dl><dt>Type</dt><dd>Player</dd><dt>Location</dt><dd>${escapeHtml(player.location_kind === 'docked' ? player.station_name ?? 'Station' : 'Kepler system space')}</dd></dl><dl><dt>Wallet</dt><dd>${player.wallet_balance_credits.toLocaleString()} credits</dd><dt>Open orders</dt><dd>${player.open_market_orders.length}</dd><dt>Cargo</dt><dd>${player.cargo_cubic_meters.toFixed(1)} m3</dd></dl></div>`
  return `<div class="npc-detail"><header class="npc-detail-header"><div><p class="eyebrow">Player</p><h2>${escapeHtml(player.display_name)}</h2></div><span class="state">player</span></header><nav class="npc-subnav" aria-label="Player details">${panels.map((panel) => `<button class="${activePanel === panel.key ? 'is-active' : ''}" data-panel="${panel.key}" type="button">${panel.label}</button>`).join('')}</nav><section class="npc-detail-content">${content}</section></div>`
}

function render() {
  const detail = selectedNpc() ?? selectedPlayer()
  const viewMarkup = populationView === 'map'
    ? `<button id="show-population-control" class="back-to-map" type="button">POPULATION CONTROL</button><section class="map-overview"><div class="section-heading"><div><p class="eyebrow">Kepler System</p><h2>Game State Overview</h2></div><span class="population-count">${npcs.length} NPCS · ${players.length} PLAYERS</span></div>${systemMapMarkup()}</section>`
    : `<button id="show-system-map" class="back-to-map" type="button">SYSTEM MAP</button><section class="npc-population-layout npc-detail-layout">${npcDirectoryMarkup()}${detailMarkup()}</section>`
  appRoot.innerHTML = `<main class="npc-population-shell"><header class="npc-population-header"><div><a class="back-link" href="/admin.html">Administration</a><p class="eyebrow">Population Control</p><h1>${populationView === 'map' ? 'NPC System Map' : detail ? escapeHtml(detail.display_name) : 'Population Control'}</h1></div><div><p id="npc-status" data-tone="neutral">Loading population state...</p><button id="refresh-npcs" class="secondary" type="button">REFRESH</button></div></header>${viewMarkup}</main>`
  bindEvents()
  updateMapView()
  syncMapAutoRefresh()
}

function syncMapAutoRefresh() {
  const isMapVisible = populationView === 'control' && activePanel === 'navigation'
  if (isMapVisible && mapRefreshTimer === undefined) {
    mapRefreshTimer = window.setInterval(() => void refresh(), 1_000)
    return
  }
  if (!isMapVisible && mapRefreshTimer !== undefined) {
    window.clearInterval(mapRefreshTimer)
    mapRefreshTimer = undefined
  }
}

async function refresh() {
  try {
    const state = await request<SystemState>('/system/state')
    npcs = state.npcs
    players = state.players
    asteroidFields = state.asteroid_fields
    selectedPilotId = [...npcs, ...players].some((pilot) => pilot.pilot_id === selectedPilotId) ? selectedPilotId : null
    if (populationView === 'control' && selectedPilotId === null) {
      selectedPilotId = npcs[0]?.pilot_id ?? players[0]?.pilot_id ?? null
    }
    render()
    setStatus('Population state refreshed.', 'success')
  } catch (error) {
    render()
    setStatus(error instanceof Error ? error.message : 'Unable to load NPC population.', 'error')
  }
}

async function moveNpc(payload: Record<string, unknown>) {
  const npc = selectedNpc()
  if (!npc) return
  try {
    const updated = await request<NpcState>(`/npcs/${npc.pilot_id}/move`, { method: 'POST', body: JSON.stringify(payload) })
    npcs = npcs.map((entry) => entry.pilot_id === updated.pilot_id ? updated : entry)
    render()
    setStatus(`${updated.display_name} relocated.`, 'success')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to move NPC.', 'error')
  }
}

async function deleteNpc() {
  const npc = selectedNpc()
  if (!npc || !window.confirm(`Delete ${npc.display_name} and all of its game data? This cannot be undone.`)) return
  try {
    await request<void>(`/npcs/${npc.pilot_id}`, { method: 'DELETE' })
    npcs = npcs.filter((entry) => entry.pilot_id !== npc.pilot_id)
    selectedPilotId = npcs[0]?.pilot_id ?? players[0]?.pilot_id ?? null
    activePanel = 'overview'
    render()
    setStatus(`${npc.display_name} and its game data were deleted.`, 'success')
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to delete NPC.', 'error')
  }
}

function bindEvents() {
  document.querySelector<HTMLButtonElement>('#refresh-npcs')?.addEventListener('click', () => void refresh())
  document.querySelectorAll<HTMLButtonElement>('[data-npc-id], [data-player-id]').forEach((button) => button.addEventListener('click', () => { selectedPilotId = button.dataset.npcId ?? button.dataset.playerId ?? null; populationView = 'control'; activePanel = 'overview'; window.history.pushState({}, '', `/npc.html?pilot_id=${selectedPilotId}`); render() }))
  document.querySelector<HTMLButtonElement>('#show-system-map')?.addEventListener('click', () => { populationView = 'map'; window.history.pushState({}, '', '/npc.html?view=map'); render(); void refresh() })
  document.querySelector<HTMLButtonElement>('#show-population-control')?.addEventListener('click', () => { populationView = 'control'; window.history.pushState({}, '', `/npc.html?pilot_id=${selectedPilotId ?? ''}`); render() })
  document.querySelector<HTMLButtonElement>('#map-fullscreen')?.addEventListener('click', () => void toggleMapFullscreen())
  document.querySelector<HTMLButtonElement>('#map-recenter')?.addEventListener('click', resetMapView)
  document.querySelector<HTMLButtonElement>('#map-zoom-out')?.addEventListener('click', () => changeMapZoom(0.5))
  document.querySelector<HTMLButtonElement>('#map-zoom-in')?.addEventListener('click', () => changeMapZoom(2))
  const mapViewport = document.querySelector<HTMLElement>('.admin-system-map-viewport, .system-map-viewport')
  mapViewport?.addEventListener('wheel', (event) => {
    event.preventDefault()
    const bounds = mapViewport.getBoundingClientRect()
    changeMapZoom(event.deltaY > 0 ? 0.8 : 1.25, {
      x: event.clientX - bounds.left - mapViewport.clientWidth / 2,
      y: event.clientY - bounds.top - mapViewport.clientHeight / 2,
    })
  }, { passive: false })
  mapViewport?.addEventListener('pointerdown', (event) => {
    if (mapZoom === 1 || event.button !== 0) return
    mapDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: mapPan.x, panY: mapPan.y }
    mapViewport.setPointerCapture(event.pointerId)
  })
  mapViewport?.addEventListener('pointermove', (event) => {
    if (!mapDrag || event.pointerId !== mapDrag.pointerId) return
    mapPan = { x: mapDrag.panX + event.clientX - mapDrag.startX, y: mapDrag.panY + event.clientY - mapDrag.startY }
    mapPanTarget = { ...mapPan }
    updateMapView()
  })
  const stopMapPan = (event: PointerEvent) => {
    if (!mapDrag || event.pointerId !== mapDrag.pointerId) return
    if (mapViewport?.hasPointerCapture(event.pointerId)) mapViewport.releasePointerCapture(event.pointerId)
    mapDrag = undefined
  }
  mapViewport?.addEventListener('pointerup', stopMapPan)
  mapViewport?.addEventListener('pointercancel', stopMapPan)
  document.querySelector<HTMLInputElement>('#npc-filter')?.addEventListener('input', (event) => { npcFilter = (event.currentTarget as HTMLInputElement).value; render() })
  document.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach((button) => button.addEventListener('click', () => { activePanel = button.dataset.panel as Panel; render() }))
  document.querySelector<HTMLButtonElement>('#delete-npc')?.addEventListener('click', () => void deleteNpc())
  document.querySelector<HTMLFormElement>('#coordinate-move-form')?.addEventListener('submit', (event) => { event.preventDefault(); const values = new FormData(event.currentTarget as HTMLFormElement); void moveNpc({ destination: 'coordinates', position_x: Number(values.get('position_x')), position_y: Number(values.get('position_y')), position_z: Number(values.get('position_z')) }) })
  document.querySelector<HTMLButtonElement>('#dock-npc')?.addEventListener('click', () => void moveNpc({ destination: 'station' }))
}

document.addEventListener('fullscreenchange', updateMapFullscreenControl)

void refresh()
