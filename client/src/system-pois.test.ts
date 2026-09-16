import { describe, expect, it } from 'vitest'
import { planetPois, primaryStarPoi, stationPois } from './system-pois'

describe('Kepler system POIs', () => {
  it('defines the primary star as a 500,000 km celestial body', () => {
    expect(primaryStarPoi.star).toMatchObject({ diameterKilometers: 500_000, color: '#ff731f' })
  })

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

  it('places stations between 100 km and 300 km above the surface of their parent worlds', () => {
    const parentByStationName = new Map([
      ['KEPLER STATION', 'LUNARA'], ['CINDER GATE', 'CINDER'], ['MERIDIAN EXCHANGE', 'MERIDIAN'], ['VERDANCE HAVEN', 'VERDANCE'], ['PELAGOS ANCHORAGE', 'PELAGOS'], ['EMBERFALL FORGE', 'EMBERFALL'], ['NACRE RELAY', 'NACRE'], ['HELIOS CROWN', 'HELIOS'], ['UMBRA WATCH', 'UMBRA'], ['AURORA SPIRE', 'AURORA'],
    ])
    const planetByName = new Map(planetPois.map((planet) => [planet.name, planet]))

    for (const station of stationPois) {
      const parentName = parentByStationName.get(station.name)
      if (!parentName) continue
      const planet = planetByName.get(parentName)!
      const altitudeMeters = Math.hypot(station.position.x - planet.position.x, station.position.z - planet.position.z) - planet.planet!.diameterKilometers * 500
      expect(altitudeMeters).toBeGreaterThanOrEqual(100_000)
      expect(altitudeMeters).toBeLessThanOrEqual(300_000)
    }
    expect(new Set(stationPois.filter((station) => parentByStationName.has(station.name)).map((station) => {
      const planet = planetByName.get(parentByStationName.get(station.name)!)!
      return Math.hypot(station.position.x - planet.position.x, station.position.z - planet.position.z) - planet.planet!.diameterKilometers * 500
    })).size).toBeGreaterThan(1)
  })
})