// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Vector3 } from '@babylonjs/core'
import type { SceneOptions, TargetableObject } from './game/scene'
import type { InventoryContainer } from './inventory'

const scenes = vi.hoisted(() => ({ flight: vi.fn(), station: vi.fn(), options: [] as SceneOptions[], targets: [] as TargetableObject[], selectTarget: vi.fn(), approachTarget: vi.fn(() => true), warpTo: vi.fn(() => true) }))
const powerSync = vi.hoisted(() => vi.fn())
vi.mock('./game/scene', () => ({
  createSystemScene: scenes.flight.mockImplementation((_canvas: unknown, options: SceneOptions) => {
    scenes.options.push(options)
    // Exercise a synchronous callback to catch socket declaration TDZ regressions.
    options.onMiningLaserUpdate?.(false)
    return { dispose: vi.fn(), setCargoCubicMeters: vi.fn(), setPowerMegajoules: powerSync, setModuleActive: vi.fn(), getTargetables: () => scenes.targets, selectTarget: scenes.selectTarget, approachTarget: scenes.approachTarget, warpTo: scenes.warpTo }
  }),
  createStationInteriorScene: scenes.station.mockImplementation(() => ({ dispose: vi.fn(), setModuleActive: vi.fn() })),
}))

const ship: InventoryContainer = {
  id: 'ship', name: 'Cargo', capacity_cubic_meters: 24, used_volume_cubic_meters: 1,
  items: [
    { id: 'module', definition_id: 'module.laser', module_definition_id: 'laser-v1', definition_version: 1, quantity: 4, durability: 82, volume_per_unit: 0.1 },
    { id: 'stack', definition_id: 'mineral.quartz', module_definition_id: null, definition_version: 1, quantity: 6, durability: 20, volume_per_unit: 0.1 },
  ], raw_ore_lots: [],
}
const station: InventoryContainer = { id: 'station', name: 'Station storage', capacity_cubic_meters: null, used_volume_cubic_meters: 0, items: [], raw_ore_lots: [] }
const resourceZones = Array.from({ length: 10 }, (_, index) => ({
  zone_id: `class-${index + 1}`, zone_class: index + 1, display_color: '#368bc1',
  regions: [{ min_x: (index - 5) * 1_000_000_000, max_x: (index - 4) * 1_000_000_000, min_z: -5_000_000_000, max_z: 5_000_000_000 }],
}))
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector)
  if (!result) throw new Error(`Missing ${selector}`)
  return result
}
function click(selector: string) { element<HTMLButtonElement>(selector).click() }
const docked = () => element('.game-shell').classList.contains('is-docked')
let initiallyDocked = true
let checkpoint: () => Promise<Response>
let dockedLoad: () => Promise<Response>
let mutation: () => Promise<Response>
let cleanupListeners: () => void
const requests = vi.fn<typeof fetch>()
const requestCount = (path: string) => requests.mock.calls.filter(([url]) => String(url).endsWith(path)).length
const sockets: FakeSocket[] = []
class FakeSocket extends EventTarget {
  static OPEN = 1
  readyState = 1
  send = vi.fn()
  close = vi.fn()
  constructor() { super(); sockets.push(this) }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  scenes.options.length = 0
  sockets.length = 0
  scenes.targets = []
  initiallyDocked = true
  checkpoint = async () => json({})
  dockedLoad = async () => json({ ship, station })
  mutation = async () => json({ ship, station })
  document.body.innerHTML = '<div id="app"></div>'
  localStorage.clear()
  sessionStorage.clear()
  const listenerSpy = vi.spyOn(window, 'addEventListener')
  cleanupListeners = () => {
    for (const [type, listener, options] of listenerSpy.mock.calls) window.removeEventListener(type, listener, options)
  }
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } },
    close: { configurable: true, value: function (this: HTMLDialogElement) {
      this.open = false
      // Browser close events are queued, not synchronous with submission.
      queueMicrotask(() => this.dispatchEvent(new Event('close')))
    } },
  })
  requests.mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/auth/login')) return json({ access_token: 'test-account', refresh_token: 'test-refresh', pilots: [{ id: 'pilot', display_name: 'Test pilot', balance_credits: 10_000 }] })
    if (path.endsWith('/auth/refresh')) return json({ access_token: 'refreshed-account', refresh_token: 'refreshed-refresh', pilots: [{ id: 'pilot', display_name: 'Test pilot', balance_credits: 10_000 }] })
    if (path.endsWith('/auth/select-pilot')) return json({ access_token: 'test-pilot', ship_state: {
      position_x: 123078, position_y: 480, position_z: -2691,
      docked_station_name: initiallyDocked ? 'KEPLER STATION' : null,
      power_megajoules: 100, shields: 100, hull: 100, fuel_liters: 80, cargo_cubic_meters: 1,
    } })
    if (path.endsWith('/auth/ship-state')) return checkpoint()
    if (path.endsWith('/inventory/docked')) return dockedLoad()
    if (path.endsWith('/inventory/ship')) return json(ship)
    if (path.endsWith('/mining/bootstrap')) return json({ discovered_fields: [], system: { radius_meters: 3_100_000_000 }, resource_zones: resourceZones })
    if (path.endsWith('/fitting/active')) return json({ statistics: { sensor_range_meters: 500_000 } })
    if (path.endsWith('/market/wallet')) return json({ wallet_balance_credits: 10_000 })
    if (path.endsWith('/inventory/split') || path.endsWith('/inventory/merge-all')) return mutation()
    return json([])
  })
  vi.stubGlobal('fetch', requests)
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  cleanupListeners()
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function launch(inSpace = false) {
  initiallyDocked = !inSpace
  await import('./main')
  element<HTMLInputElement>('#auth-email').value = 'test@example.invalid'
  element<HTMLInputElement>('#auth-password').value = 'test-password'
  element('#auth-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(document.querySelector('#pilot-select-launch')).not.toBeNull())
  expect(element('#loading-pilot-wallet').textContent).toBe('10,000 CR')
  click('#pilot-select-launch')
  await vi.waitFor(() => expect(document.querySelector('.game-shell')).not.toBeNull())
}

describe('stored authentication', () => {
  it('restores and rotates a remembered session after a client reload', async () => {
    localStorage.setItem('spaceconomy.refresh-token', 'stored-refresh')

    await import('./main')

    await vi.waitFor(() => expect(document.querySelector('#pilot-select-launch')).not.toBeNull())
    expect(requestCount('/auth/refresh')).toBe(1)
    expect(localStorage.getItem('spaceconomy.refresh-token')).toBe('refreshed-refresh')
  })
})

describe('page lifecycle checkpoint', () => {
  it('persists the active ship state with a keepalive request on page hide', async () => {
    await launch(true)

    window.dispatchEvent(new Event('pagehide'))

    await vi.waitFor(() => expect(requestCount('/auth/ship-state')).toBe(1))
    const [, options] = requests.mock.calls.find(([url]) => String(url).endsWith('/auth/ship-state'))!
    expect(options).toMatchObject({ method: 'PUT', keepalive: true })
  })
})

describe('checkpoint-gated location transitions', () => {
  it('shows the docked station services as compact icon controls with hover descriptions', async () => {
    await launch()
    const services = document.querySelectorAll<HTMLButtonElement>('.station-service-strip [data-station-service]')
    expect(services).toHaveLength(7)
    expect(element('#station-hotspots').classList.contains('station-service-strip')).toBe(true)
    expect(element<HTMLButtonElement>('[data-station-service="market"]')
      .getAttribute('data-tooltip')).toContain('buy and sell')
    expect(element<HTMLButtonElement>('[data-station-service="refining"]')
      .getAttribute('aria-label')).toBe('Refining')
  })

  it('uses compact docked controls for entities, station information, and undocking', async () => {
    requests.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/inventory/docked-entities')) {
        return json({
          station_name: 'KEPLER STATION',
          entities: [
            { pilot_id: 'pilot', display_name: 'Test pilot', entity_type: 'PILOT' },
            { pilot_id: 'npc', display_name: 'Garrik Stonehand', entity_type: 'NPC' },
          ],
        })
      }
      if (path.endsWith('/auth/login')) return json({ access_token: 'test-account', refresh_token: 'test-refresh', pilots: [{ id: 'pilot', display_name: 'Test pilot', balance_credits: 10_000 }] })
      if (path.endsWith('/auth/select-pilot')) return json({ access_token: 'test-pilot', ship_state: { position_x: 123078, position_y: 480, position_z: -2691, docked_station_name: 'KEPLER STATION', power_megajoules: 100, shields: 100, hull: 100, fuel_liters: 80, cargo_cubic_meters: 1 } })
      if (path.endsWith('/inventory/docked')) return dockedLoad()
      if (path.endsWith('/inventory/ship')) return json(ship)
      if (path.endsWith('/mining/bootstrap')) return json({ discovered_fields: [] })
      return json({})
    })
    await launch()
    expect(element('#docked-status').textContent).not.toContain('DOCKING BAY')
    click('#station-information-action')
    expect(element<HTMLDialogElement>('#station-information').open).toBe(true)
    click('#docked-entities-action')
    await vi.waitFor(() => expect(element('#docked-entities-content').textContent).toContain('Garrik Stonehand'))
    expect(element<HTMLDialogElement>('#docked-entities').open).toBe(true)
    expect(element<HTMLButtonElement>('#undock-action').getAttribute('aria-label')).toContain('Undock')
  })

  it.each(['HTTP', 'network'])('keeps the station and displays a useful error after a failed %s undock', async (failure) => {
    await launch()
    const pending = deferred<Response>()
    checkpoint = () => pending.promise
    const loads = requestCount('/inventory/docked')
    click('#undock-action')
    element('#undock-action').dispatchEvent(new Event('click'))
    click('[data-station-service="inventory"]')
    expect(requestCount('/auth/ship-state')).toBe(1)
    expect(requestCount('/inventory/docked')).toBe(loads)
    expect(element<HTMLButtonElement>('#undock-action').disabled).toBe(true)
    expect(docked()).toBe(true)
    expect(scenes.flight).toHaveBeenCalledTimes(1)
    if (failure === 'HTTP') pending.resolve(json({ detail: 'Station unavailable' }, 409))
    else pending.reject(new TypeError('Failed to fetch'))
    await vi.waitFor(() => expect(element('#docked-transition-error').hidden).toBe(false))
    expect(element('#docked-transition-error').textContent).toContain(failure === 'HTTP' ? '409' : 'Failed to fetch')
    expect(element<HTMLButtonElement>('#undock-action').disabled).toBe(false)
    expect(docked()).toBe(true)
    expect(scenes.flight).toHaveBeenCalledTimes(1)
  })

  it('pauses flight while docking; rejection preserves the scene and persistent collision error', async () => {
    await launch(true)
    const pending = deferred<Response>()
    checkpoint = () => pending.promise
    click('#dock-action')
    element('#dock-action').dispatchEvent(new Event('click'))
    expect(requestCount('/auth/ship-state')).toBe(1)
    expect(scenes.options[0]!.isSimulationPaused?.()).toBe(true)
    expect(scenes.options[0]!.isInputBlocked?.()).toBe(true)
    expect(docked()).toBe(false)
    expect(scenes.station).not.toHaveBeenCalled()
    pending.resolve(json({ detail: 'Outside docking range' }, 409))
    await vi.waitFor(() => expect(element('#collision-alert').textContent).toContain('409'))
    scenes.options[0]!.onShipStatusChange?.({ shields: 100, hull: 100, fuelLiters: 80, maximumFuelLiters: 80, powerMegajoules: 100, maximumPowerMegajoules: 100, warpCapacity: 100, maximumWarpCapacity: 100, maximumWarpRangeKilometers: 100, cargoCubicMeters: 1, maximumCargoCubicMeters: 24, destroyed: false })
    expect(element('#collision-alert').textContent).toContain('Outside docking range')
    expect(scenes.options[0]!.isSimulationPaused?.()).toBe(false)
    expect(scenes.station).not.toHaveBeenCalled()
    expect(docked()).toBe(false)
  })

  it('waits for accepted docking before showing station inventory or broadcasting docked', async () => {
    await launch(true)
    const pending = deferred<Response>()
    checkpoint = () => pending.promise
    sockets[0]!.send.mockClear()
    click('#dock-action')
    click('[data-station-service="inventory"]')
    expect(requestCount('/inventory/docked')).toBe(0)
    expect(sockets[0]!.send).not.toHaveBeenCalled()
    pending.resolve(json({}))
    await vi.advanceTimersByTimeAsync(250)
    expect(docked()).toBe(true)
    expect(scenes.station).toHaveBeenCalledTimes(1)
    expect(sockets[0]!.send).toHaveBeenCalledWith(JSON.stringify({ type: 'docked', payload: {} }))
    expect(requestCount('/inventory/docked')).toBe(1)
    expect(element<HTMLButtonElement>('#dock-action').disabled).toBe(false)
  })

  it('discards a delayed startup docked snapshot after undocking', async () => {
    const stale = deferred<Response>()
    dockedLoad = () => stale.promise
    await launch()
    const pending = deferred<Response>()
    checkpoint = () => pending.promise
    click('#undock-action')
    expect(docked()).toBe(true)
    expect(requestCount('/inventory/ship')).toBe(0)
    pending.resolve(json({}))
    await vi.advanceTimersByTimeAsync(250)
    expect(docked()).toBe(false)
    expect(requestCount('/inventory/ship')).toBe(1)
    stale.resolve(json({ ship: { ...ship, used_volume_cubic_meters: 22 }, station }))
    await vi.advanceTimersByTimeAsync(0)
    expect(element('#ship-cargo').textContent).toBe('1.00 / 24.00 M3')
    expect(scenes.flight).toHaveBeenCalledTimes(2)
    expect(scenes.options[1]!.initialPosition).toMatchObject({ x: -2_600_000_000, y: 480, z: -4_510_179_990.5 })
  })
})

describe('target list', () => {
  it('shows the server scan error detail when sensors cannot scan', async () => {
    requests.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/auth/login')) return json({ access_token: 'test-account', refresh_token: 'test-refresh', pilots: [{ id: 'pilot', display_name: 'Test pilot', balance_credits: 10_000 }] })
      if (path.endsWith('/auth/select-pilot')) return json({ access_token: 'test-pilot', ship_state: { position_x: 123078, position_y: 480, position_z: -2691, docked_station_name: null, power_megajoules: 10, shields: 100, hull: 100, fuel_liters: 80, cargo_cubic_meters: 1 } })
      if (path.endsWith('/inventory/ship')) return json(ship)
      if (path.endsWith('/mining/bootstrap')) return json({ discovered_fields: [] })
      if (path.endsWith('/mining/scan')) return json({ detail: 'insufficient power for sensor scan' }, 409)
      return json([])
    })
    await launch(true)
    click('[data-core-system="sensors"]')
    await vi.waitFor(() => expect(element('#game-toast').textContent).toBe('INSUFFICIENT POWER FOR SENSOR SCAN'))
    expect(requestCount('/auth/ship-state')).toBe(1)
  })

  it('filters targets using the equipped survey range and selects the clicked row', async () => {
    scenes.targets = [
      { id: 'ore-1', name: 'Silicate Asteroid', kind: 'asteroid', position: new Vector3(123200, 480, -2691), locked: false, locking: false },
      { id: 'player-1', name: 'Prospector', kind: 'player', position: new Vector3(123300, 480, -2691), locked: false, locking: false },
      { id: 'ore-far', name: 'Distant Asteroid', kind: 'asteroid', position: new Vector3(423_079, 480, -2691), locked: false, locking: false },
    ]
    await launch(true)
    expect(element('#target-list-items').textContent).toContain('Silicate Asteroid')
    expect(element('#target-list-items').textContent).toContain('Prospector')
    expect(element('#target-list-items').textContent).toContain('Distant Asteroid')
    click('[data-target-filter="asteroid"]')
    expect(element('#target-list-items').textContent).toContain('Silicate Asteroid')
    expect(element('#target-list-items').textContent).not.toContain('Prospector')
    click('[data-target-id="ore-1"]')
    expect(scenes.selectTarget).toHaveBeenCalledWith('ore-1')
  })

  it('offers approach and details after a target lock completes', async () => {
    await launch(true)
    scenes.options[0]!.onTargetSelectionChange?.({
      id: 'ore-1',
      name: 'Silicate Asteroid',
      kind: 'asteroid',
      position: new Vector3(123200, 480, -2691),
      oreRemainingCubicMeters: 42.5,
      initialOreCubicMeters: 80,
      locked: true,
      locking: false,
      lockProgress: 1,
    })
    click('#approach-target')
    expect(scenes.approachTarget).toHaveBeenCalledOnce()
    click('#view-target-details')
    expect(element<HTMLDialogElement>('#target-details').open).toBe(true)
    expect(element('#target-details-content').textContent).toContain('42.5 m3')
  })

  it('keeps the locked target card visible when another target is selected', async () => {
    await launch(true)
    scenes.options[0]!.onTargetSelectionChange?.({
      id: 'ore-1', name: 'Silicate Asteroid', kind: 'asteroid',
      position: new Vector3(123200, 480, -2691), oreRemainingCubicMeters: 42.5,
      initialOreCubicMeters: 80, locked: true, locking: false, lockProgress: 1,
    })
    scenes.options[0]!.onTargetSelectionChange?.({
      id: 'ore-2', name: 'Ferrous Asteroid', kind: 'asteroid',
      position: new Vector3(123300, 480, -2691), oreRemainingCubicMeters: 35,
      initialOreCubicMeters: 70, locked: false, locking: false, lockProgress: 0,
    })
    expect(element('#target-window').hasAttribute('hidden')).toBe(false)
    expect(element('#target-name').textContent).toBe('Silicate Asteroid')
  })
})

describe('inventory dialog and mutation ownership', () => {
  async function openInventory() {
    click('[data-station-service="inventory"]')
    await vi.waitFor(() => expect(document.querySelector('[data-entry-id="module"]')).not.toBeNull())
  }

  it('disables module splitting explicitly and labels durability in points', async () => {
    await launch()
    await openInventory()
    click('[data-entry-id="module"]')
    expect(element<HTMLButtonElement>('[data-inventory-control="split"]').disabled).toBe(true)
    expect(element('.inventory-details').textContent).toContain('Condition: 82.0 points')
    expect(element('.inventory-details').textContent).not.toContain('82.0%')
    click('[data-entry-id="stack"]')
    expect(element<HTMLButtonElement>('[data-inventory-control="split"]').disabled).toBe(false)
  })

  it('does not release an in-flight mutation when the submitted dialog closes or the view changes', async () => {
    await launch()
    await openInventory()
    click('[data-entry-id="stack"]')
    click('[data-inventory-control="split"]')
    const pending = deferred<Response>()
    mutation = () => pending.promise
    element('dialog form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    // Flush the old dialog's queued close event while the POST remains pending.
    await vi.advanceTimersByTimeAsync(0)
    click('#exit-services-action')
    click('[data-station-service="inventory"]')
    element('[data-inventory-control="merge"]').dispatchEvent(new Event('click'))
    click('#undock-action')
    expect(requestCount('/inventory/split')).toBe(1)
    expect(requestCount('/inventory/merge-all')).toBe(0)
    expect(requestCount('/auth/ship-state')).toBe(0)
    expect(element<HTMLButtonElement>('[data-inventory-control="merge"]').disabled).toBe(true)
    pending.resolve(json({ ship, station }))
    await vi.waitFor(() => expect(element<HTMLButtonElement>('[data-inventory-control="merge"]').disabled).toBe(false))
  })

  it('releases only the dialog lock when cancelling or closing its view', async () => {
    await launch()
    await openInventory()
    click('[data-entry-id="stack"]')
    click('[data-inventory-control="split"]')
    click('[data-cancel]')
    await vi.advanceTimersByTimeAsync(0)
    expect(element<HTMLButtonElement>('[data-inventory-control="merge"]').disabled).toBe(false)
    click('[data-inventory-control="split"]')
    click('#exit-services-action')
    await vi.advanceTimersByTimeAsync(0)
    click('#undock-action')
    expect(requestCount('/auth/ship-state')).toBe(1)
    await vi.advanceTimersByTimeAsync(250)
    expect(docked()).toBe(false)
  })
})

describe('top-bar major functions', () => {
  function openMap() {
    const display = element('.system-map-display')
    Object.defineProperties(display, {
      clientWidth: { configurable: true, value: 800 }, clientHeight: { configurable: true, value: 600 },
    })
    click('#topbar-map')
    return display
  }

  it('uses equal axis scales and renders only asteroid contacts within the scan radius', async () => {
    scenes.targets = [
      { id: 'near', name: 'Nearby', kind: 'asteroid', position: new Vector3(123088, 480, -2691), locked: false, locking: false },
      { id: 'far', name: 'Beyond sensors', kind: 'asteroid', position: new Vector3(723078, 480, -2691), locked: false, locking: false },
      { id: 'above', name: 'Above sensors', kind: 'player', position: new Vector3(123078, 300480, -2691), locked: false, locking: false },
    ]
    await launch(true)
    const display = openMap()
    expect(element('#system-map-world').dataset.detail).toBe('local')
    expect(document.querySelectorAll('.system-map-contact')).toHaveLength(1)
    expect(document.querySelector('.system-map-contact-player')).toBeNull()
    expect(element('#system-map-contacts').textContent).not.toContain('Above sensors')
    expect(parseFloat(element('.system-map-contact').style.left)).toBeCloseTo(400.006, 8)
    click('#system-map-overview')
    expect(document.querySelectorAll('.system-map-contact')).toHaveLength(0)
    expect(element('#system-map-world').dataset.detail).toBe('system')
    expect(parseFloat(element('#system-map-boundary').style.width)).toBeCloseTo(372)
    expect(parseFloat(element('#system-map-boundary').style.height)).toBeCloseTo(372)
    expect(element('[data-poi="primary-star"]').style.left).toBe('400px')
    expect(element('[data-poi="primary-star"]').style.top).toBe('300px')
    click('#system-map-recenter')
    Object.defineProperties(display, { clientWidth: { value: 400 }, clientHeight: { value: 800 } })
    window.dispatchEvent(new Event('resize'))
    expect(parseFloat(element('#system-map-player').style.left)).toBeCloseTo(200, 8)
    expect(parseFloat(element('#system-map-player').style.top)).toBeCloseTo(400, 8)
  })

  it('shows the player heading when the map is zoomed into five thousand kilometers', async () => {
    await launch(true)
    openMap()
    const player = element('#system-map-player')
    expect(player.classList.contains('show-heading')).toBe(true)
    scenes.options[0]!.onFlightUpdate(new Vector3(123078, 480, -2691), 0, true, Math.PI / 2, 0, 0)
    expect(player.classList.contains('show-heading')).toBe(true)
    expect(player.style.getPropertyValue('--heading-degrees')).toBe('90deg')
  })

  it('labels local cells from the stellar origin with positive up/right coordinates', async () => {
    await launch(true)
    const display = openMap()
    const labels = [...document.querySelectorAll<HTMLElement>('#system-map-cell-labels span')]
    expect(labels.some((label) => label.textContent === 'X +0\nZ +0')).toBe(true)
    expect(labels.some((label) => label.textContent === 'X +0\nZ -1')).toBe(true)
    expect(element('#system-map-grid-label').textContent).toContain('CELL X +0 / Z -1')
    click('#system-map-overview')
    expect(document.querySelectorAll('#system-map-cell-labels span')).toHaveLength(0)
    expect(element('#system-map-grid-label').textContent).toContain('CELL X +0 / Z +0')
    expect(display.clientWidth).toBe(800)
  })

  it('projects class regions across the whole grid and preserves them on element resize', async () => {
    let resize: (() => void) | undefined
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
    })
    await launch(true)
    const display = openMap()
    click('#system-map-overview')
    const circles = () => [...document.querySelectorAll<SVGPathElement>('#system-map-zones [data-zone-id]')]
    expect(circles()).toHaveLength(10)
    expect(circles().map((circle) => circle.dataset.zoneId)).toEqual([...resourceZones].reverse().map((zone) => zone.zone_id))
    expect([...document.querySelectorAll('#system-map-zone-legend span')].map((label) => label.textContent)).toEqual(resourceZones.map((zone) => `Class ${zone.zone_class}`))
    const inner = circles().at(-1)!
    const coordinates = () => circles().at(-1)!.getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
    coordinates().forEach((value, index) => expect(value).toBeCloseTo([100, 0, 60, 600, -60][index]!))
    expect(inner.tagName).toBe('path')
    expect(document.querySelector('#system-map-zones clipPath')).toBeNull()
    click('#system-map-zoom-in')
    await vi.advanceTimersByTimeAsync(800)
    expect(coordinates()[2]).toBeGreaterThan(60)
    scenes.options[0]!.onFlightUpdate(new Vector3(3_000_000_000, 480, -50_000), 0, true, 0, 0, 0)
    click('#system-map-recenter')
    Object.defineProperties(display, { clientWidth: { value: 780 }, clientHeight: { value: 400 } })
    resize!()
    expect(parseFloat(element('#system-map-player').style.left)).toBeCloseTo(390, 6)
    expect(parseFloat(element('#system-map-player').style.top)).toBeCloseTo(200, 6)
    const [left, top, width] = coordinates()
    const scale = width! / 1_000_000_000
    expect(left! + 8_000_000_000 * scale).toBeCloseTo(390, 6)
    expect(top! + 5_000_050_000 * scale).toBeCloseTo(200, 6)
    expect(requests.mock.calls.some(([url]) => String(url).includes('/admin/'))).toBe(false)
  })

  it('reveals only successful scans, retains discoveries, and warps to the selected 3D coordinates', async () => {
    const fallback = requests.getMockImplementation()!
    const scan = deferred<Response>()
    requests.mockImplementation((input, init) => String(input).endsWith('/mining/scan') ? scan.promise : fallback(input, init))
    await launch(true)
    openMap()
    click('#system-map-scan')
    click('#system-map-scan')
    await vi.waitFor(() => expect(requestCount('/mining/scan')).toBe(1))
    expect(document.querySelectorAll('.system-map-survey')).toHaveLength(0)
    scan.resolve(json({ newly_discovered_fields: [{ id: 'scanned', display_name: 'Surveyed field', position_x: 250000, position_y: 1400, position_z: -40000, scan_quality: 0.9 }], resource_zones: [{ zone_id: 'class-4', zone_class: 4, display_color: '#be8a38', regions: [{ min_x: 200000, max_x: 300000, min_z: -100000, max_z: 0 }] }], power_megajoules: 90, cooldown_seconds: 5 }))
    await vi.waitFor(() => expect(document.querySelectorAll('.system-map-survey')).toHaveLength(1))
    expect(document.querySelectorAll('#system-map-zones [data-zone-id]')).toHaveLength(1)
    expect(element('#system-map-zone-legend').textContent).toContain('Class 4')
    click('#system-map-close')
    click('#topbar-map')
    click('[data-poi="discovered-field-scanned"]')
    expect(element('[data-poi="discovered-field-scanned"]').getAttribute('aria-pressed')).toBe('true')
    expect(element('[data-destination="discovered-field-scanned"]').getAttribute('aria-pressed')).toBe('true')
    click('[data-warp-destination="discovered-field-scanned"]')
    expect(scenes.warpTo).toHaveBeenCalledWith(new Vector3(250000, 1400, -40000))
    expect(element('#system-map-modal').hidden).toBe(true)
  })

  it('does not reveal a survey after a rejected scan and disables scans and warp while docked', async () => {
    const fallback = requests.getMockImplementation()!
    requests.mockImplementation((input, init) => String(input).endsWith('/mining/scan') ? Promise.resolve(json({ detail: 'insufficient power' }, 409)) : fallback(input, init))
    await launch(true)
    openMap()
    click('#system-map-scan')
    await vi.waitFor(() => expect(element('#game-toast').textContent).toContain('INSUFFICIENT POWER'))
    expect(document.querySelectorAll('.system-map-survey')).toHaveLength(0)
    click('#system-map-close')
    click('#dock-action')
    await vi.advanceTimersByTimeAsync(250)
    click('#topbar-map')
    expect(element<HTMLButtonElement>('#system-map-scan').disabled).toBe(true)
    expect(element<HTMLButtonElement>('[data-warp-destination="primary-star"]').disabled).toBe(true)
  })

  it('pans without selecting a dragged POI and supports keyboard navigation', async () => {
    await launch(true)
    const display = openMap()
    Object.assign(display, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() })
    const pointer = (target: HTMLElement | Window, type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY: 200 })
      Object.defineProperty(event, 'pointerId', { value: 1 })
      target.dispatchEvent(event)
    }
    const planet = element('[data-poi="starter-world"]')
    const initial = Number(element('#system-map-world').dataset.panX)
    pointer(planet, 'pointerdown', 200)
    pointer(display, 'pointermove', 260)
    pointer(window, 'pointerup', 260)
    planet.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(element('[data-poi="primary-star"]').getAttribute('aria-pressed')).toBe('true')
    expect(Number(element('#system-map-world').dataset.panX)).toBeCloseTo(initial + 60)
    display.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(Number(element('#system-map-world').dataset.panX)).toBeCloseTo(initial + 140)
    pointer(planet, 'pointerdown', 200)
    pointer(window, 'pointerup', 200)
    planet.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(element('[data-poi="starter-world"]').getAttribute('aria-pressed')).toBe('true')
    click('[data-destination="kepler-station"]')
    expect(element('[data-poi="kepler-station"]').hidden).toBe(false)
  })

  it('preserves local position precision and anchors wheel zoom to the cursor', async () => {
    await launch(true)
    const display = element('.system-map-display')
    Object.defineProperties(display, {
      clientWidth: { value: 800 }, clientHeight: { value: 600 },
    })
    vi.spyOn(display, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 600 } as DOMRect)
    click('#topbar-map')
    await vi.advanceTimersByTimeAsync(20)
    expect(parseFloat(element('#system-map-player').style.left)).toBeCloseTo(400, 8)
    expect(parseFloat(element('#system-map-player').style.top)).toBeCloseTo(300, 8)
    const camera = () => {
      const values = element('#system-map-world').dataset
      return { x: Number(values.panX), y: Number(values.panY), zoom: Number(values.zoom) }
    }
    const before = camera()
    display.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: 600, clientY: 200, cancelable: true }))
    await vi.advanceTimersByTimeAsync(800)
    const after = camera()
    expect(after.zoom).toBeGreaterThan(before.zoom)
    expect((200 - after.x) / after.zoom).toBeCloseTo((200 - before.x) / before.zoom, 8)
    expect((-100 - after.y) / after.zoom).toBeCloseTo((-100 - before.y) / before.zoom, 8)
    display.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 600, clientY: 200 }))
    await vi.advanceTimersByTimeAsync(32)
    const during = camera()
    display.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 200, clientY: 400 }))
    await vi.advanceTimersByTimeAsync(800)
    const final = camera()
    expect((-200 - final.x) / final.zoom).toBeCloseTo((-200 - during.x) / during.zoom, 8)
    expect((100 - final.y) / final.zoom).toBeCloseTo((100 - during.y) / during.zoom, 8)
  })

  it('renders a scanned dynamic field as a selectable system map destination', async () => {
    requests.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname
      if (path.endsWith('/auth/login')) return json({ access_token: 'test-account', refresh_token: 'test-refresh', pilots: [{ id: 'pilot', display_name: 'Test pilot', balance_credits: 10_000 }] })
      if (path.endsWith('/auth/select-pilot')) return json({ access_token: 'test-pilot', ship_state: { position_x: 123078, position_y: 480, position_z: -2691, docked_station_name: null, power_megajoules: 100, shields: 100, hull: 100, fuel_liters: 80, cargo_cubic_meters: 1 } })
      if (path.endsWith('/inventory/ship')) return json(ship)
      if (path.endsWith('/mining/bootstrap')) return json({ discovered_fields: [{ id: 'field-1', display_name: 'UNSURVEYED ASTEROID FIELD A1B2C3D4', position_x: 200_000, position_y: 120, position_z: -80_000, distance_meters: 110_000, scan_quality: 0.8 }] })
      if (path.endsWith('/fitting/active')) return json({ statistics: { sensor_range_meters: 500_000 } })
      return json([])
    })
    await launch(true)
    Object.defineProperties(element('.system-map-display'), { clientWidth: { value: 800 }, clientHeight: { value: 600 } })
    click('#topbar-map')
    const sensorRange = element('#system-map-sensor-range')
    expect(sensorRange.hidden).toBe(false)
    expect(sensorRange.title).toBe('Equipped sensor range: 500 km')
    expect(parseFloat(sensorRange.style.width)).toBeCloseTo(600, 8)
    expect(parseFloat(sensorRange.style.left)).toBeCloseTo(400, 8)
    expect(parseFloat(sensorRange.style.top)).toBeCloseTo(300, 8)
    const sensorRangeToggle = element<HTMLButtonElement>('#system-map-sensor-range-toggle')
    expect(sensorRangeToggle.getAttribute('aria-pressed')).toBe('true')
    click('#system-map-sensor-range-toggle')
    expect(sensorRange.hidden).toBe(true)
    expect(sensorRangeToggle.getAttribute('aria-label')).toBe('Show sensor range')
    click('#system-map-sensor-range-toggle')
    expect(sensorRange.hidden).toBe(false)
    expect(sensorRangeToggle.getAttribute('aria-label')).toBe('Hide sensor range')
    const field = element<HTMLButtonElement>('[data-poi="discovered-field-field-1"]')
    expect(document.querySelectorAll('#system-map-zones [data-zone-id]')).toHaveLength(0)
    expect(element('#system-map-zone-legend').textContent).toBe('')
    expect(field.title).not.toContain('Class')
    expect(field.textContent).toContain('UNSURVEYED ASTEROID FIELD A1B2C3D4')
    field.click()
    expect(element('[data-destination="discovered-field-field-1"]').getAttribute('aria-pressed')).toBe('true')
  })

  it('opens the system map and the current pilot wallet', async () => {
    await launch()
    click('#topbar-map')
    expect(element('#system-map-modal').hasAttribute('hidden')).toBe(false)
    click('#system-map-close')
    click('#topbar-wallet')
    await vi.waitFor(() => expect(element('#game-modal-content').textContent).toContain('10,000 CR'))
    expect(element('#game-modal-title').textContent).toBe('WALLET')
  })

  it('opens the current ship dossier from the top navigation', async () => {
    await launch(true)
    click('#topbar-ship')
    await vi.waitFor(() => expect(element('#game-modal-content').textContent).toContain('SHIP STATISTICS'))
    expect(element('#game-modal-title').textContent).toBe('SHIP DOSSIER')
    expect(element('#game-modal-content').textContent).toContain('SENSOR RANGE')
    expect(element('#game-modal-content').textContent).toContain('500,000 m')
  })
})

describe('asteroid scans', () => {
  function selectAsteroid(id = 'asteroid') {
    scenes.options[0]!.onTargetSelectionChange?.({
      id, name: `Asteroid ${id}`, kind: 'asteroid', position: new Vector3(123078, 480, -2691),
      oreRemainingCubicMeters: 50, initialOreCubicMeters: 100,
      locked: true, locking: false, lockProgress: 1,
    })
  }

  it('shows exact composition only after an authenticated asteroid scan', async () => {
    await launch(true)
    selectAsteroid()
    click('#view-target-details')
    expect(element('#target-details-content').textContent).toContain('Not scanned')
    requests.mockImplementationOnce(async () => json({}))
    requests.mockImplementationOnce(async () => json({
      asteroid_id: 'asteroid', mineral_assay: [{ definition_id: 'iron', definition_version: 2, percentage: 100 }], power_megajoules: 90,
    }))
    click('#scan-target-assay')
    expect(element<HTMLButtonElement>('#scan-target-assay').disabled).toBe(true)
    await vi.waitFor(() => expect(element('#target-scan-status').textContent).toBe('Scan complete.'))
    expect(element('#target-details-content').textContent).toContain('iron (v2)100%')
    expect(powerSync).toHaveBeenCalledWith(90)
    expect(element('#target-details-content').textContent).not.toContain('Not scanned')
    const [, options] = requests.mock.calls.find(([url]) => String(url).endsWith('/asteroids/asteroid/scan'))!
    expect(options).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer test-pilot' } })
    selectAsteroid('other')
    expect(element('#target-details-content').textContent).not.toContain('100%')
    expect(element('#target-details-content').textContent).toContain('Not scanned')
  })

  it('does not attach a delayed scan result to a different target', async () => {
    await launch(true)
    selectAsteroid()
    click('#view-target-details')
    const pending = deferred<Response>()
    requests.mockImplementationOnce(async () => json({}))
    requests.mockImplementationOnce(() => pending.promise)
    click('#scan-target-assay')
    await vi.waitFor(() => expect(requestCount('/asteroids/asteroid/scan')).toBe(1))
    selectAsteroid('other')
    pending.resolve(json({ asteroid_id: 'asteroid', mineral_assay: [{ definition_id: 'gold', definition_version: 1, percentage: 100 }], power_megajoules: 90 }))
    await vi.waitFor(() => expect(element<HTMLButtonElement>('#scan-target-assay').disabled).toBe(false))
    expect(element('#target-details-title').textContent).toBe('Asteroid other')
    expect(element('#target-details-content').textContent).not.toContain('gold')
  })

  it('shows scan failures and keeps composition undisclosed', async () => {
    await launch(true)
    selectAsteroid()
    click('#view-target-details')
    requests.mockImplementationOnce(async () => json({}))
    requests.mockImplementationOnce(async () => json({ detail: 'sensor scan is recharging' }, 429))
    click('#scan-target-assay')
    await vi.waitFor(() => expect(element('#target-scan-status').textContent).toContain('recharging'))
    expect(element('#target-details-content').textContent).toContain('Not scanned')
    expect(element<HTMLButtonElement>('#scan-target-assay').disabled).toBe(false)
  })
})