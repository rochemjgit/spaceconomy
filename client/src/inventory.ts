export type InventoryItem = {
  id: string
  definition_id: string
  module_definition_id: string | null
  definition_version: number
  quantity: number
  durability: number
  volume_per_unit: number
}

export type RawOreLot = {
  id: string
  asteroid_id: string
  composition: string
  mineral_assay: { definition_id: string; percentage: number }[]
  volume_cubic_meters: number
}

export type InventoryContainer = {
  id: string
  name: string
  capacity_cubic_meters: number | null
  used_volume_cubic_meters: number
  items: InventoryItem[]
  raw_ore_lots: RawOreLot[]
}

export type InventorySnapshot = { ship: InventoryContainer; station: InventoryContainer | null }
export type InventorySelection = { kind: 'item' | 'ore'; id: string; containerId: string }
export type InventoryEntry = InventorySelection & { name: string; volume: number } & (
  { kind: 'item'; item: InventoryItem } | { kind: 'ore'; lot: RawOreLot }
)
export type InventoryAction = 'transfer' | 'split' | 'jettison'

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

export function inventoryEntries(container: InventoryContainer, filter = '', sort: 'name' | 'volume' = 'name'): InventoryEntry[] {
  const entries: InventoryEntry[] = [
    ...container.items.map((item): InventoryEntry => ({ kind: 'item', id: item.id, containerId: container.id, name: item.definition_id.replace(/^module\./, '').replaceAll('_', ' '), volume: item.quantity * item.volume_per_unit, item })),
    ...container.raw_ore_lots.map((lot): InventoryEntry => ({ kind: 'ore', id: lot.id, containerId: container.id, name: `${lot.composition} raw ore`, volume: lot.volume_cubic_meters, lot })),
  ]
  const query = filter.trim().toLowerCase()
  return entries.filter((entry) => {
    const text = entry.kind === 'item' ? `${entry.name} ${entry.item.definition_id}` : `${entry.name} ore.raw ${entry.lot.asteroid_id} ${entry.lot.mineral_assay.map((mineral) => mineral.definition_id).join(' ')}`
    return text.toLowerCase().includes(query)
  }).sort((a, b) => (sort === 'volume' ? b.volume - a.volume : 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export function resolveInventoryEntry(containers: InventoryContainer[], selection: InventorySelection | null): InventoryEntry | undefined {
  if (!selection) return undefined
  const container = containers.find((candidate) => candidate.id === selection.containerId)
  return container && inventoryEntries(container).find((entry) => entry.kind === selection.kind && entry.id === selection.id)
}

export function freeVolume(container: InventoryContainer): number {
  return container.capacity_cubic_meters === null ? Infinity : Math.max(0, container.capacity_cubic_meters - container.used_volume_cubic_meters)
}

export function quantityLimit(entry: InventoryEntry, action: InventoryAction, destination?: InventoryContainer): number {
  let maximum = entry.kind === 'item' ? entry.item.quantity : entry.volume
  if (action === 'split') {
    if (entry.kind === 'item' && entry.item.module_definition_id !== null) return 0
    // Decimal ore has no fixed server quantum. Choose a representably smaller Max.
    maximum = entry.kind === 'item' ? maximum - 1 : maximum - Math.max(Number.MIN_VALUE, maximum * Number.EPSILON)
  }
  if (action === 'transfer') {
    if (!destination || destination.id === entry.containerId) return 0
    const unitVolume = entry.kind === 'item' ? entry.item.volume_per_unit : 1
    // Match the server's absolute capacity tolerance, including any existing overage.
    // Clamping remaining space first would grant another tolerance on every transfer.
    const remaining = destination.capacity_cubic_meters === null ? Infinity
      : destination.capacity_cubic_meters - destination.used_volume_cubic_meters + 1e-9
    if (remaining < 0) return 0
    if (unitVolume > 0) maximum = Math.min(maximum, remaining / unitVolume)
  }
  return Math.max(0, entry.kind === 'item' ? Math.floor(maximum) : maximum)
}

export function validateQuantity(text: string, entry: InventoryEntry, action: InventoryAction, destination?: InventoryContainer): number | null {
  const value = text.trim()
  if (!(entry.kind === 'item' ? /^\d+$/ : /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i).test(value)) return null
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0 || (entry.kind === 'item' && !Number.isSafeInteger(amount))) return null
  if (amount > quantityLimit(entry, action, destination)) return null
  if (action === 'split' && entry.kind === 'ore' && (entry.volume - amount <= 0 || entry.volume - amount === entry.volume)) return null
  return amount
}

export function parseInventoryDrag(text: string): InventorySelection | null {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return null
    const candidate = value as Partial<InventorySelection>
    return (candidate.kind === 'item' || candidate.kind === 'ore') && typeof candidate.id === 'string' && typeof candidate.containerId === 'string'
      ? { kind: candidate.kind, id: candidate.id, containerId: candidate.containerId } : null
  } catch { return null }
}

/** A load is valid only in its original view and before any newer request/write. */
export class InventoryRequestGuard {
  private revision = 0
  invalidate() { this.revision += 1 }
  capture() { return this.revision }
  isCurrent(revision: number) { return revision === this.revision }
}