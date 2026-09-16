// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.resetModules()
  document.body.innerHTML = ''
})

it('excludes NPC ships from the points of interest view', async () => {
  document.body.innerHTML = '<div id="app"></div>'
  window.history.replaceState({}, '', '/admin.html#poi')
  const responses: Record<string, unknown> = {
    '/configuration': {}, '/npcs': [], '/market/orders': { orders: [], ledger: [] },
    '/refinery/jobs': { jobs: [] }, '/minerals': [], '/resource-zones': { spawning_enabled: false, zones: [] },
    '/stations/services': { stations: [] },
    '/items': [],
    '/system/state': {
      npcs: [{ pilot_id: 'npc-1', display_name: 'Mining NPC', behavior_state: 'mining', location_kind: 'space', station_name: null, position_x: 100, position_y: 200, position_z: 300 }],
      players: [{ pilot_id: 'player-1', display_name: 'Player Pilot', location_kind: 'space', station_name: null, position_x: 400, position_y: 500, position_z: 600 }],
      asteroid_fields: [],
    },
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.split('/api/v1/admin')[1]
    return new Response(JSON.stringify(responses[path]), { status: 200 })
  }))
  await import('./admin')
  await vi.waitFor(() => expect(document.body.textContent).toContain('Player Pilot'))
  expect(document.body.textContent).toContain('LUNARA')
  expect(document.body.textContent).toContain('NOCTURNE')
  expect(document.body.textContent).toContain('KEPLER STATION')
  expect(document.body.textContent).toContain('FARPOINT DEPOT')
  expect(document.body.textContent).not.toContain('Mining NPC')
})

it('opens separate NPC and player population views', async () => {
  document.body.innerHTML = '<div id="app"></div>'
  window.history.replaceState({}, '', '/admin.html#npc')
  const responses: Record<string, unknown> = {
    '/configuration': {}, '/npcs': [], '/market/orders': { orders: [], ledger: [] },
    '/refinery/jobs': { jobs: [] }, '/minerals': [], '/resource-zones': { spawning_enabled: false, zones: [] },
    '/stations/services': { stations: [] }, '/items': [], '/system/state': { npcs: [], players: [], asteroid_fields: [] },
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(responses[url.split('/api/v1/admin')[1]]), { status: 200 })))
  await import('./admin')
  await vi.waitFor(() => expect(document.querySelector<HTMLIFrameElement>('.npc-population-frame')).not.toBeNull())
  expect(document.querySelector('[data-dashboard-view="players"]')?.closest('.sidebar')).not.toBeNull()
  expect(document.querySelector<HTMLIFrameElement>('.npc-population-frame')?.getAttribute('src')).toBe('/npc.html?population=npcs')
  document.querySelector<HTMLButtonElement>('[data-dashboard-view="players"]')!.click()
  expect(document.querySelector<HTMLIFrameElement>('.npc-population-frame')?.getAttribute('src')).toBe('/npc.html?population=players')
  expect(document.querySelector<HTMLButtonElement>('[data-dashboard-view="players"]')?.classList).toContain('is-active')
})

it('saves mineral metadata without clearing another row draft', async () => {
  document.body.innerHTML = '<div id="app"></div>'
  window.history.replaceState({}, '', '/admin.html#minerals')
  const minerals = ['iron', 'nickel'].map((name) => ({
    id: name, definition_id: name, version: 1, display_name: name,
    classification: 'scientific', rarity_tier: 'unrestricted', active: true,
    industrial_role: 'Alloys', visual_family: 'metallic', display_color: '#888888', in_spawn_catalog: true,
  }))
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    const path = url.split('/api/v1/admin')[1]
    if (options?.method === 'PATCH') {
      return new Response(JSON.stringify({ ...minerals[0], ...JSON.parse(String(options.body)) }), { status: 200 })
    }
    const responses: Record<string, unknown> = {
      '/configuration': {}, '/npcs': [], '/market/orders': { orders: [], ledger: [] },
      '/refinery/jobs': { jobs: [] }, '/system/state': { npcs: [], players: [], asteroid_fields: [] },
      '/minerals': minerals, '/resource-zones': { spawning_enabled: false, zones: [] },
      '/stations/services': { stations: [] },
      '/items': [],
    }
    return new Response(JSON.stringify(responses[path]), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  await import('./admin')
  await vi.waitFor(() => expect(document.querySelectorAll('[data-mineral-id]')).toHaveLength(2))
  const role = document.querySelector<HTMLInputElement>('[data-mineral-id="iron"] [name="industrial_role"]')!
  const draft = document.querySelector<HTMLInputElement>('[data-mineral-id="nickel"] [name="display_name"]')!
  role.value = 'Hull plating'
  draft.value = 'Unfinished nickel edit'
  document.querySelector<HTMLButtonElement>('[data-mineral-id="iron"] [data-save-mineral]')!.click()
  await vi.waitFor(() => expect(document.body.textContent).toContain('iron saved.'))
  expect(draft.isConnected).toBe(true)
  expect(draft.value).toBe('Unfinished nickel edit')
  const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH')
  expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
    display_name: 'iron', industrial_role: 'Hull plating', visual_family: 'metallic', display_color: '#888888', active: true,
  })
  expect(role.disabled).toBe(false)
})

it('updates service availability from the station configuration tab', async () => {
  document.body.innerHTML = '<div id="app"></div>'
  window.history.replaceState({}, '', '/admin.html#station')
  const service = { id: 'market', service_key: 'market', display_name: 'Market', available: true }
  const refining = { id: 'refining', service_key: 'refining', display_name: 'Refining', available: true }
  const refinery = { id: 'kepler-refinery', first_pass_efficiency: 0.5, second_pass_efficiency: 0.5 }
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    const path = url.split('/api/v1/admin')[1]
    if (options?.method === 'PATCH') {
      return new Response(JSON.stringify({ ...service, ...JSON.parse(String(options.body)) }), { status: 200 })
    }
    const responses: Record<string, unknown> = {
      '/configuration': {}, '/npcs': [], '/market/orders': { orders: [], ledger: [] },
      '/refinery/jobs': { jobs: [] }, '/system/state': { npcs: [], players: [], asteroid_fields: [] },
      '/minerals': [], '/resource-zones': { spawning_enabled: false, zones: [] },
      '/stations/services': { stations: [{ station_name: 'KEPLER STATION', services: [service, refining], refinery }] },
      '/items': [],
    }
    return new Response(JSON.stringify(responses[path]), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  await import('./admin')
  await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('[data-station-service-id="market"]')).not.toBeNull())
  const toggle = document.querySelector<HTMLInputElement>('[data-station-service-id="market"]')!
  toggle.click()
  await vi.waitFor(() => expect(document.body.textContent).toContain('Market disabled.'))
  const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH')
  expect(patch?.[0]).toContain('/stations/services/market')
  expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ available: false })
})

it('saves crushing and refining efficiencies from the Station tab', async () => {
  document.body.innerHTML = '<div id="app"></div>'
  window.history.replaceState({}, '', '/admin.html#station')
  const refinery = { id: 'kepler-refinery', first_pass_efficiency: 0.5, second_pass_efficiency: 0.5 }
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    const path = url.split('/api/v1/admin')[1]
    if (path === '/stations/refineries/kepler-refinery') return new Response(JSON.stringify({ ...refinery, ...JSON.parse(String(options?.body)) }), { status: 200 })
    const responses: Record<string, unknown> = {
      '/configuration': {}, '/npcs': [], '/market/orders': { orders: [], ledger: [] }, '/refinery/jobs': { jobs: [] },
      '/system/state': { npcs: [], players: [], asteroid_fields: [] }, '/minerals': [], '/resource-zones': { spawning_enabled: false, zones: [] },
      '/stations/services': { stations: [{ station_name: 'KEPLER STATION', services: [{ id: 'refining', service_key: 'refining', display_name: 'Refining', available: true }], refinery }] },
      '/items': [],
    }
    return new Response(JSON.stringify(responses[path]), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  await import('./admin')
  await vi.waitFor(() => expect(document.querySelector<HTMLFormElement>('[data-refinery-id="kepler-refinery"]')).not.toBeNull())
  const form = document.querySelector<HTMLFormElement>('[data-refinery-id="kepler-refinery"]')!
  form.querySelector<HTMLInputElement>('[name="first_pass_efficiency"]')!.value = '60'
  form.querySelector<HTMLInputElement>('[name="second_pass_efficiency"]')!.value = '70'
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await vi.waitFor(() => expect(document.body.textContent).toContain('Refining efficiencies saved.'))
  const patch = fetchMock.mock.calls.find(([url, options]) => String(url).includes('/stations/refineries/') && options?.method === 'PATCH')
  expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ first_pass_efficiency: 0.6, second_pass_efficiency: 0.7 })
})

it('filters item definitions and displays crafted module materials', async () => {
  document.body.innerHTML = '<div id="app"></div>'
  window.history.replaceState({}, '', '/admin.html#items')
  const items = [
    { id: 'iron_ore', display_name: 'Iron Ore', category: 'Materials', subcategory: 'Raw Ore', version: 1, active: true, image_kind: 'metallic', stats: { rarity: 'common' }, materials: [] },
    { id: 'mining_laser_i', display_name: 'Mining Laser I', category: 'Modules', subcategory: 'Mining', version: 1, active: true, image_kind: 'module', stats: { 'CPU demand': 12 }, materials: [{ definition_id: 'iron_ore', definition_version: 1, quantity: 20 }] },
  ]
  const responses: Record<string, unknown> = {
    '/configuration': {}, '/npcs': [], '/market/orders': { orders: [], ledger: [] }, '/refinery/jobs': { jobs: [] },
    '/system/state': { npcs: [], players: [], asteroid_fields: [] }, '/minerals': [], '/resource-zones': { spawning_enabled: false, zones: [] },
    '/stations/services': { stations: [] }, '/items': items,
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(responses[url.split('/api/v1/admin')[1]]), { status: 200 })))
  await import('./admin')
  await vi.waitFor(() => expect(document.body.textContent).toContain('Mining Laser I'))
  document.querySelector<HTMLButtonElement>('.item-tree-branch-label[data-item-branch-toggle="Materials"]')!.click()
  await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('.item-tree-branch-label[data-item-branch-toggle="Materials"]')?.getAttribute('aria-expanded')).toBe('false'))
  expect(document.querySelector('.item-tree-branch > ul[hidden]')?.textContent).toContain('Ore')
  document.querySelector<HTMLButtonElement>('.item-tree-branch-label[data-item-branch-toggle="Materials"]')!.click()
  await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('.item-tree-branch-label[data-item-branch-toggle="Materials"]')?.getAttribute('aria-expanded')).toBe('true'))
  expect(document.body.textContent).toContain('Refined')
  const search = document.querySelector<HTMLInputElement>('#item-search')!
  search.value = 'laser'
  search.dispatchEvent(new Event('input', { bubbles: true }))
  await vi.waitFor(() => expect(document.querySelectorAll('[data-item-id]')).toHaveLength(1))
  document.querySelector<HTMLButtonElement>('[data-item-id="mining_laser_i"]')!.click()
  expect(document.body.textContent).toContain('Crafting Materials')
  expect(document.body.textContent).toContain('iron ore')
  expect(document.body.textContent).toContain('20')
})

it('projects class regions and field labels through the same map zoom', async () => {
  document.body.innerHTML = '<div id="app"></div>'
  window.history.replaceState({}, '', '/npc.html?view=map')
  vi.spyOn(window, 'setInterval').mockReturnValue(0)
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
  const zones = Array.from({ length: 10 }, (_, index) => ({
    zone_id: `kepler-class-${index + 1}`, zone_class: index + 1, display_color: '#368bc1',
    regions: [{ min_x: (index - 5) * 1_000_000_000, max_x: (index - 4) * 1_000_000_000, min_z: -5_000_000_000, max_z: 5_000_000_000 }],
  }))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    npcs: [], players: [], resource_zones: zones, system_radius_meters: 3_100_000_000,
    asteroid_fields: [{ id: 'field', display_name: 'Sample Field', position_x: 3_000_000_000, position_y: 0, position_z: -50_000 }],
  }), { status: 200 })))
  await import('./npc-admin')
  await vi.waitFor(() => expect(document.querySelectorAll('[data-zone-id]')).toHaveLength(10))
  expect(document.querySelectorAll('.resource-zone-legend span')).toHaveLength(10)
  const ring = document.querySelector<SVGPathElement>('[data-zone-id="kepler-class-1"]')!
  const field = document.querySelector<HTMLElement>('.map-field[data-map-x]')!
  expect(field.textContent).toContain('Class 9')
  const coordinates = () => ring.getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
  const width = coordinates()[2]!
  expect(coordinates()[0]! + 8 * width).toBeCloseTo(parseFloat(field.style.left))
  expect(coordinates()[1]! + 5.00005 * width).toBeCloseTo(parseFloat(field.style.top))
  document.querySelector<HTMLButtonElement>('#map-zoom-in')!.click()
  expect(coordinates()[2]).toBeCloseTo(width * 2)
  expect(coordinates()[0]! + 8 * coordinates()[2]!).toBeCloseTo(parseFloat(field.style.left))
  expect(coordinates()[1]! + 5.00005 * coordinates()[2]!).toBeCloseTo(parseFloat(field.style.top))
  document.querySelector<HTMLButtonElement>('#map-recenter')!.click()
  expect(coordinates()[2]).toBeCloseTo(width)
})