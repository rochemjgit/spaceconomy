import { describe, expect, it } from 'vitest'
import { planetPois, stationPois } from './system-pois'

describe('Kepler system POIs', () => {
  it('authors fourteen varied planets and thirteen stations', () => {
    expect(planetPois).toHaveLength(14)
    expect(stationPois).toHaveLength(13)
    expect(stationPois.filter((poi) => ['FARPOINT DEPOT', 'SOLACE ARRAY', 'NORTHWIND RELAY'].includes(poi.name)).map((poi) => poi.position)).toEqual([
      { x: -4_450_000_000, y: 480, z: -2_950_000_000 },
      { x: 2_050_000_000, y: 480, z: -2_950_000_000 },
      { x: -1_950_000_000, y: 480, z: 2_150_000_000 },
    ])
    expect(new Set(planetPois.map((poi) => poi.planet!.color)).size).toBeGreaterThan(10)
    expect(new Set(planetPois.map((poi) => Math.hypot(poi.position.x, poi.position.z))).size).toBe(14)
  })
})