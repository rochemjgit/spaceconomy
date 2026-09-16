export type SystemPoi = {
  id: string
  type: 'STAR' | 'TERRESTRIAL WORLD' | 'GAS GIANT' | 'ICE WORLD' | 'VOLCANIC WORLD' | 'DWARF WORLD' | 'ORBITAL STATION'
  name: string
  description: string
  position: { x: number; y: number; z: number }
  mapKind: 'star' | 'world' | 'station'
  star?: { diameterKilometers: number; color: string }
  planet?: { diameterKilometers: number; color: string; massKg: number }
  stationStyle?: 'standard'
}

const planets: SystemPoi[] = [
  { id: 'starter-world', type: 'TERRESTRIAL WORLD', name: 'LUNARA', description: 'A temperate world supporting Kepler Station operations.', position: { x: -2_600_000_000, y: 0, z: -4_500_000_000 }, mapKind: 'world', planet: { diameterKilometers: 20_000, color: '#1f5794', massKg: 5.972e24 } },
  { id: 'cinder', type: 'VOLCANIC WORLD', name: 'CINDER', description: 'A scorched inner world traced by dense industrial traffic.', position: { x: 420_000_000, y: 0, z: 160_000_000 }, mapKind: 'world', planet: { diameterKilometers: 7_800, color: '#a64524', massKg: 2.1e23 } },
  { id: 'meridian', type: 'TERRESTRIAL WORLD', name: 'MERIDIAN', description: 'A cloud-banded terrestrial world on a stable inner orbit.', position: { x: 1_000_000_000, y: 0, z: -3_900_000_000 }, mapKind: 'world', planet: { diameterKilometers: 13_200, color: '#d59b4c', massKg: 4.3e24 } },
  { id: 'verdance', type: 'TERRESTRIAL WORLD', name: 'VERDANCE', description: 'A green-blue world with broad equatorial seas.', position: { x: -2_000_000_000, y: 0, z: 4_600_000_000 }, mapKind: 'world', planet: { diameterKilometers: 16_800, color: '#317d68', massKg: 6.9e24 } },
  { id: 'calyx', type: 'DWARF WORLD', name: 'CALYX', description: 'A small mineral-rich world in a close eccentric orbit.', position: { x: -600_000_000, y: 0, z: -2_300_000_000 }, mapKind: 'world', planet: { diameterKilometers: 5_600, color: '#8d6f63', massKg: 7.8e22 } },
  { id: 'pelagos', type: 'TERRESTRIAL WORLD', name: 'PELAGOS', description: 'A deep oceanic world with a sparse orbital population.', position: { x: -3_900_000_000, y: 0, z: 2_900_000_000 }, mapKind: 'world', planet: { diameterKilometers: 19_600, color: '#286ea8', massKg: 8.2e24 } },
  { id: 'emberfall', type: 'VOLCANIC WORLD', name: 'EMBERFALL', description: 'A tectonically active world lit by permanent lava fields.', position: { x: -4_500_000_000, y: 0, z: -500_000_000 }, mapKind: 'world', planet: { diameterKilometers: 11_400, color: '#bd512a', massKg: 2.9e24 } },
  { id: 'nacre', type: 'ICE WORLD', name: 'NACRE', description: 'A pale ice world with a reflective ammonia atmosphere.', position: { x: 2_220_000_000, y: 0, z: 1_370_000_000 }, mapKind: 'world', planet: { diameterKilometers: 15_100, color: '#a6cad7', massKg: 5.1e24 } },
  { id: 'helios', type: 'GAS GIANT', name: 'HELIOS', description: 'A vast gas giant marked by copper and gold storm bands.', position: { x: 2_510_000_000, y: 0, z: -1_550_000_000 }, mapKind: 'world', planet: { diameterKilometers: 68_000, color: '#c88745', massKg: 7.8e26 } },
  { id: 'umbra', type: 'ICE WORLD', name: 'UMBRA', description: 'A dark outer ice world beneath a thin carbon haze.', position: { x: 3_100_000_000, y: 0, z: 2_300_000_000 }, mapKind: 'world', planet: { diameterKilometers: 14_000, color: '#4f6388', massKg: 4.2e24 } },
  { id: 'kestrel', type: 'DWARF WORLD', name: 'KESTREL', description: 'A fractured dwarf world at the edge of the surveyed system.', position: { x: -2_860_000_000, y: 0, z: 620_000_000 }, mapKind: 'world', planet: { diameterKilometers: 4_400, color: '#84715d', massKg: 4.5e22 } },
  { id: 'aurora', type: 'GAS GIANT', name: 'AURORA', description: 'An outer gas giant with luminous polar storms.', position: { x: -2_530_000_000, y: 0, z: -1_480_000_000 }, mapKind: 'world', planet: { diameterKilometers: 55_000, color: '#8d69a8', massKg: 5.9e26 } },
  { id: 'silica', type: 'TERRESTRIAL WORLD', name: 'SILICA', description: 'A dry crystalline world with sharply reflective highlands.', position: { x: -1_820_000_000, y: 0, z: 1_880_000_000 }, mapKind: 'world', planet: { diameterKilometers: 10_100, color: '#c6b59b', massKg: 1.8e24 } },
  { id: 'nocturne', type: 'ICE WORLD', name: 'NOCTURNE', description: "A distant cobalt ice world in the system's shadowed reach.", position: { x: 3_500_000_000, y: 0, z: 4_700_000_000 }, mapKind: 'world', planet: { diameterKilometers: 12_600, color: '#385c94', massKg: 3.6e24 } },
]

const stationNames = ['KEPLER STATION', 'CINDER GATE', 'MERIDIAN EXCHANGE', 'VERDANCE HAVEN', 'PELAGOS ANCHORAGE', 'EMBERFALL FORGE', 'NACRE RELAY', 'HELIOS CROWN', 'UMBRA WATCH', 'AURORA SPIRE']
const stationPlanetIds = ['starter-world', 'cinder', 'meridian', 'verdance', 'pelagos', 'emberfall', 'nacre', 'helios', 'umbra', 'aurora']
const stationOrbitAltitudesKilometers = [180, 120, 240, 160, 280, 140, 220, 300, 200, 260]
const standaloneStations: SystemPoi[] = [
  { id: 'farpoint-depot', type: 'ORBITAL STATION', name: 'FARPOINT DEPOT', description: 'An independent logistics depot serving the western reaches of Kepler.', position: { x: -4_450_000_000, y: 480, z: -2_950_000_000 }, mapKind: 'station', stationStyle: 'standard' },
  { id: 'solace-array', type: 'ORBITAL STATION', name: 'SOLACE ARRAY', description: 'A free-standing research and resupply array in the eastern mining lanes.', position: { x: 2_050_000_000, y: 480, z: -2_950_000_000 }, mapKind: 'station', stationStyle: 'standard' },
  { id: 'northwind-relay', type: 'ORBITAL STATION', name: 'NORTHWIND RELAY', description: 'A remote communications relay and commercial stopover north of the primary.', position: { x: -1_950_000_000, y: 480, z: 2_150_000_000 }, mapKind: 'station', stationStyle: 'standard' },
]

export const systemPois: SystemPoi[] = [
  { id: 'primary-star', type: 'STAR', name: 'PRIMARY STAR', description: "The system's primary and central navigation reference.", position: { x: 0, y: 0, z: 0 }, mapKind: 'star', star: { diameterKilometers: 500_000, color: '#ff731f' } },
  ...planets,
  ...stationPlanetIds.map((planetId, index) => {
    const planet = planets.find((candidate) => candidate.id === planetId)!
    const orbitRadiusMeters = (planet.planet!.diameterKilometers / 2 + stationOrbitAltitudesKilometers[index]!) * 1_000
    return { id: index === 0 ? 'kepler-station' : `${planetId}-station`, type: 'ORBITAL STATION' as const, name: stationNames[index]!, description: index === 0 ? 'A protected orbital outpost. Docking is available inside the station shield.' : `A standard orbital station serving ${planet.name}.`, position: { x: planet.position.x, y: 480, z: planet.position.z - orbitRadiusMeters }, mapKind: 'station' as const, stationStyle: 'standard' as const }
  }),
  ...standaloneStations,
]

export const planetPois = systemPois.filter((poi) => poi.planet)
export const stationPois = systemPois.filter((poi) => poi.stationStyle)
export const primaryStarPoi = systemPois.find((poi) => poi.star)!