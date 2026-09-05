// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SceneOptions } from './game/scene'
import type { InventoryContainer } from './inventory'

const scenes = vi.hoisted(() => ({ flight: vi.fn(), station: vi.fn(), options: [] as SceneOptions[] }))
vi.mock('./game/scene', () => ({
  createSystemScene: scenes.flight.mockImplementation((_canvas: unknown, options: SceneOptions) => {
    scenes.options.push(options)
    // Exercise a synchronous callback to catch socket declaration TDZ regressions.
    options.onMiningLaserUpdate?.(false)
    return { dispose: vi.fn(), setCargoCubicMeters: vi.fn(), setModuleActive: vi.fn() }
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
    if (path.endsWith('/auth/login')) return json({ access_token: 'test-account', refresh_token: 'test-refresh', pilots: [{ id: 'pilot', display_name: 'Test pilot' }] })
    if (path.endsWith('/auth/select-pilot')) return json({ access_token: 'test-pilot', ship_state: {
      position_x: 123078, position_y: 480, position_z: -2691,
      docked_station_name: initiallyDocked ? 'KEPLER STATION' : null,
      power_megajoules: 100, shields: 100, hull: 100, fuel_liters: 80, cargo_cubic_meters: 1,
    } })
    if (path.endsWith('/auth/ship-state')) return checkpoint()
    if (path.endsWith('/inventory/docked')) return dockedLoad()
    if (path.endsWith('/inventory/ship')) return json(ship)
    if (path.endsWith('/mining/bootstrap')) return json({ discovered_fields: [] })
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
  click('#pilot-select-launch')
  await vi.waitFor(() => expect(document.querySelector('.game-shell')).not.toBeNull())
}

describe('checkpoint-gated location transitions', () => {
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
    expect(scenes.options[1]!.initialPosition).toMatchObject({ x: 123078, y: 480, z: -2690.5 })
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