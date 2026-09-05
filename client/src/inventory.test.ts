import { describe, expect, it } from 'vitest'
import { escapeHtml, freeVolume, inventoryEntries, InventoryRequestGuard, parseInventoryDrag, quantityLimit, resolveInventoryEntry, validateQuantity } from './inventory'
import type { InventoryContainer } from './inventory'

const ship: InventoryContainer = {
  id: 'ship', name: 'Cargo', capacity_cubic_meters: 24, used_volume_cubic_meters: 12,
  items: [{ id: 'laser', definition_id: 'module.mining_laser', module_definition_id: 'definition', definition_version: 2, quantity: 4, durability: 82, volume_per_unit: 2 }],
  raw_ore_lots: [{ id: 'ore', asteroid_id: 'asteroid', composition: 'Silicate', mineral_assay: [{ definition_id: 'mineral.quartz', percentage: 60 }], volume_cubic_meters: 4 }],
}
const station: InventoryContainer = { id: 'station', name: 'Storage', capacity_cubic_meters: null, used_volume_cubic_meters: 100000, items: [], raw_ore_lots: [] }
const item = inventoryEntries(ship).find((entry) => entry.kind === 'item')!
const ore = inventoryEntries(ship).find((entry) => entry.kind === 'ore')!

describe('combined inventory entries', () => {
  it('renders item and ore entries from either container, with a shared volume sort', () => {
    expect(inventoryEntries(ship, '', 'volume').map((entry) => entry.id)).toEqual(['laser', 'ore'])
    expect(inventoryEntries({ ...ship, id: 'station' }).map((entry) => entry.kind)).toEqual(['item', 'ore'])
    expect(inventoryEntries(ship)[1]).toMatchObject({ lot: ship.raw_ore_lots[0] })
  })
  it('filters by friendly name, definition, composition, source and assay', () => {
    for (const query of [' SILICATE ', 'quartz', 'asteroid', 'ore.raw']) expect(inventoryEntries(ship, query).map((entry) => entry.id)).toEqual(['ore'])
    expect(inventoryEntries(ship, 'mining laser').map((entry) => entry.id)).toEqual(['laser'])
    expect(inventoryEntries(ship, 'module.')).toHaveLength(1)
    expect(inventoryEntries(ship, 'missing')).toEqual([])
  })
  it('sorts deterministically without mutating source arrays or assays', () => {
    const before = structuredClone(ship)
    inventoryEntries(ship, '', 'volume')
    expect(ship).toEqual(before)
    const entries = inventoryEntries({ ...ship, raw_ore_lots: [{ ...ship.raw_ore_lots[0]!, volume_cubic_meters: 20 }] }, '', 'volume')
    expect(entries[0]!.kind).toBe('ore')
  })
  it('resolves exact live container, entry id and kind, never another snapshot', () => {
    const selection = { kind: 'item' as const, id: 'laser', containerId: 'ship' }
    expect(resolveInventoryEntry([{ ...ship, items: [{ ...ship.items[0]!, quantity: 2 }] }, station], selection)).toMatchObject({ item: { quantity: 2 } })
    expect(resolveInventoryEntry([ship, station], { ...selection, containerId: 'missing' })).toBeUndefined()
    expect(resolveInventoryEntry([ship, station], { ...selection, kind: 'ore' })).toBeUndefined()
    expect(resolveInventoryEntry([{ ...ship, items: [] }, station], selection)).toBeUndefined()
  })
})

describe('limits and strict quantity validation', () => {
  it('keeps station unlimited and accounts for remaining destination volume', () => {
    expect(freeVolume(station)).toBe(Infinity)
    expect(quantityLimit(item, 'transfer', station)).toBe(4)
    const limited = { ...station, capacity_cubic_meters: 10, used_volume_cubic_meters: 7.5 }
    expect(quantityLimit(item, 'transfer', limited)).toBe(1)
    expect(quantityLimit(ore, 'transfer', limited)).toBe(2.5 + 1e-9)
    expect(validateQuantity('3', ore, 'transfer', limited)).toBeNull()
    expect(quantityLimit(item, 'transfer', ship)).toBe(0)
    expect(quantityLimit(item, 'transfer')).toBe(0)
    expect(quantityLimit(item, 'transfer', { ...limited, used_volume_cubic_meters: 11 })).toBe(0)
  })
  it.each(['1.5', '1.0', '2junk', '1e0', 'Infinity', 'NaN', '', ' ', '-1', '+1', '0', '0x2', '9007199254740993'])('rejects malformed or non-integer item input %j', (text) => {
    expect(validateQuantity(text, item, 'jettison')).toBeNull()
  })
  it('accepts whole items and decimal ore, enforcing split leftovers', () => {
    if (item.kind !== 'item') throw new Error('Invalid fixture')
    const stack = { ...item, item: { ...item.item, module_definition_id: null } }
    expect(validateQuantity(' 2 ', stack, 'split')).toBe(2)
    expect(validateQuantity('4', stack, 'split')).toBeNull()
    expect(validateQuantity('4', item, 'split')).toBeNull()
    expect(validateQuantity('4', item, 'jettison')).toBe(4)
    expect(validateQuantity('4.01', ore, 'jettison')).toBeNull()
    expect(validateQuantity('0.125', ore, 'split')).toBe(0.125)
    expect(validateQuantity('.5', ore, 'transfer', station)).toBe(.5)
    expect(validateQuantity('4', ore, 'split')).toBeNull()
    expect(validateQuantity('4', ore, 'jettison')).toBe(4)
    expect(validateQuantity('1e-3', ore, 'split')).toBe(.001)
    expect(validateQuantity('1e309', ore, 'split')).toBeNull()
    expect(validateQuantity('2garbage', ore, 'split')).toBeNull()
    expect(validateQuantity(String(quantityLimit(ore, 'split')), ore, 'split')).not.toBeNull()
  })
  it('handles indivisible single units, zero-volume items and very small ore', () => {
    if (item.kind !== 'item' || ore.kind !== 'ore') throw new Error('Invalid fixture')
    expect(quantityLimit({ ...item, item: { ...item.item, quantity: 1 } }, 'split')).toBe(0)
    expect(quantityLimit({ ...item, item: { ...item.item, volume_per_unit: 0 } }, 'transfer', { ...station, capacity_cubic_meters: 0, used_volume_cubic_meters: 0 })).toBe(4)
    const tiny = { ...ore, volume: 0.000000001, lot: { ...ore.lot, volume_cubic_meters: 0.000000001 } }
    expect(validateQuantity(String(quantityLimit(tiny, 'split')), tiny, 'split')).not.toBeNull()
    expect(validateQuantity('1e-999', tiny, 'split')).toBeNull()
    expect(validateQuantity('1e-300', ore, 'split')).toBeNull()
  })
  it('disallows splitting modules even when a snapshot reports multiple units', () => {
    expect(quantityLimit(item, 'split')).toBe(0)
    expect(validateQuantity('1', item, 'split')).toBeNull()
  })
  it('allows exact-fit decimal items without rounding a unit away', () => {
    if (item.kind !== 'item') throw new Error('Invalid fixture')
    const decimal = { ...item, item: { ...item.item, module_definition_id: null, volume_per_unit: 0.1 } }
    const destination = { ...station, capacity_cubic_meters: 0.3, used_volume_cubic_meters: 0 }
    expect(quantityLimit(decimal, 'transfer', destination)).toBe(3)
    expect(validateQuantity('3', decimal, 'transfer', destination)).toBe(3)
    expect(validateQuantity('4', decimal, 'transfer', destination)).toBeNull()
  })
  it('uses only the unspent absolute tolerance when already over capacity', () => {
    if (item.kind !== 'item') throw new Error('Invalid fixture')
    const tiny = { ...item, item: { ...item.item, volume_per_unit: 0.4e-9 } }
    const destination = { ...station, capacity_cubic_meters: 1, used_volume_cubic_meters: 1 + 0.5e-9 }
    expect(freeVolume(destination)).toBe(0)
    expect(quantityLimit(tiny, 'transfer', destination)).toBe(1)
    expect(validateQuantity('2', tiny, 'transfer', destination)).toBeNull()
    const after = { ...destination, used_volume_cubic_meters: destination.used_volume_cubic_meters + 0.4e-9 }
    expect(quantityLimit(tiny, 'transfer', after)).toBe(0)
    expect(validateQuantity('0.6e-9', ore, 'transfer', destination)).toBeNull()
    expect(quantityLimit({ ...tiny, item: { ...tiny.item, volume_per_unit: 0 } }, 'transfer', { ...destination, used_volume_cubic_meters: 1 + 2e-9 })).toBe(0)
    // Tolerance must not scale with hold size.
    expect(quantityLimit(item, 'transfer', { ...station, capacity_cubic_meters: 1e12, used_volume_cubic_meters: 1e12 })).toBe(0)
  })
})

describe('untrusted text and asynchronous state', () => {
  it('escapes text and quoted attributes including filter payloads', () => {
    expect(escapeHtml(`<img src="x" onerror='run()'>&`)).toBe('&lt;img src=&quot;x&quot; onerror=&#39;run()&#39;&gt;&amp;')
  })
  it.each(['', '{', 'null', '42', '[]', '{"kind":"other","id":"ore","containerId":"ship"}', '{"kind":"ore","id":1,"containerId":"ship"}'])('rejects malformed drag data %j', (text) => {
    expect(parseInventoryDrag(text)).toBeNull()
  })
  it('accepts typed drag identity without trusting stale quantities', () => {
    expect(parseInventoryDrag('{"kind":"ore","id":"ore","containerId":"ship","quantity":999}')).toEqual({ kind: 'ore', id: 'ore', containerId: 'ship' })
  })
  it('invalidates pending loads on view changes, newer loads and mutations', () => {
    const guard = new InventoryRequestGuard()
    const initial = guard.capture()
    expect(guard.isCurrent(initial)).toBe(true)
    for (const reason of ['close', 'different view', 'refresh', 'mutation']) {
      const pending = guard.capture()
      guard.invalidate()
      expect(guard.isCurrent(pending), reason).toBe(false)
      expect(guard.isCurrent(initial)).toBe(false)
    }
  })
})