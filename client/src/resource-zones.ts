export type ResourceZone = {
  zone_id: string
  zone_class: number
  display_color: string
  regions: { min_x: number; max_x: number; min_z: number; max_z: number }[]
}

export function resourceZoneAt(zones: ResourceZone[], x: number, z: number) {
  return zones.find((zone) => zone.regions.some((region) =>
    (x >= region.min_x && x < region.max_x || x === region.max_x && x === 5_000_000_000)
    && (z >= region.min_z && z < region.max_z || z === region.max_z && z === 5_000_000_000)))
}

export function resourceZonePath(zone: ResourceZone, project: (position: { x: number; z: number }) => { x: number; y: number }, scale: number): string {
  return zone.regions.map((region) => {
    const point = project({ x: region.min_x, z: region.max_z })
    const width = (region.max_x - region.min_x) * scale
    const height = (region.max_z - region.min_z) * scale
    return `M${point.x},${point.y}h${width}v${height}h${-width}Z`
  }).join(' ')
}