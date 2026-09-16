import {
  AbstractMesh,
  ArcRotateCamera,
  Color3,
  DynamicTexture,
  Engine,
  GlowLayer,
  HemisphericLight,
  Layer,
  Mesh,
  MeshBuilder,
  Ray,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core'
import type { ArcRotateCameraPointersInput } from '@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput'
import { isEditingText } from './input'
import { planetPois, primaryStarPoi, stationPois } from '../system-pois'

export interface SceneController {
  dispose(): void
  warpTo(destination: Vector3): boolean
  toggleWarp?(): boolean
  emitSensorPing?(): void
  replaceAsteroids?(asteroids: ServerAsteroid[]): void
  replaceJettisonedItems?(items: ServerJettisonedItem[]): void
  pickupJettisonedItem?(): Promise<boolean>
  setCargoCubicMeters?(cargoCubicMeters: number, maximumCargoCubicMeters?: number): void
  setPowerMegajoules?(powerMegajoules: number): void
  setMaximumSublightSpeedMetersPerSecond?(speed: number): void
  setModuleActive(moduleName: string, isActive: boolean): void
  toggleTargetLock(): void
  approachTarget?(): boolean
  clearTargetSelection?(): void
  getTargetables?(): TargetableObject[]
  selectTarget?(targetId: string): void
  updateRemotePilot?(pilot: RemotePilot): void
  removeRemotePilot?(pilotId: string): void
  setRemotePilotMining?(pilotId: string, active: boolean, source: Vector3, target: Vector3): void
  setRemotePilotActivity?(pilotId: string, activity: RemotePilotActivity): void
  setHostileTargeting?(pilotId: string, active: boolean): void
}

export interface RemotePilot {
  pilotId: string
  displayName: string
  shipType: string
  position: Vector3
  yaw: number
  pitch: number
  roll: number
}

export interface RemotePilotActivity {
  behaviorState: string
  warpPhase?: WarpPhase
  docked: boolean
  target: Vector3
}

export interface MiningExtractionResult {
  asteroidId: string
  extractedOreCubicMeters: number
  remainingOreCubicMeters: number
  cargoCubicMeters: number
}

export interface ServerAsteroid {
  id: string
  position: Vector3
  radius: number
  composition: string
  initialOreCubicMeters: number
  remainingOreCubicMeters: number
}

export interface ServerJettisonedItem {
  id: string
  definitionId: string
  quantity: number
  position: Vector3
}

export interface TargetableObject {
  id: string
  name: string
  kind: 'player' | 'asteroid' | 'warpable' | 'station' | 'planet'
  position: Vector3
  locked: boolean
  locking: boolean
}

export interface SceneOptions {
  isInputBlocked?: () => boolean
  isSimulationPaused?: () => boolean
  onFlightUpdate: (position: Vector3, speed: number, flightAssistEnabled: boolean, yaw: number, pitch: number, roll: number, miningSource?: Vector3, miningTarget?: Vector3) => void
  onDockingAvailabilityChange?: (isAvailable: boolean) => void
  onWarpUpdate?: (isWarping: boolean, phase: WarpPhase, progress: number) => void
  onTargetSelectionChange?: (target?: { id?: string; name: string; kind: 'asteroid' | 'pilot' | 'cargo' | 'warpable' | 'station' | 'planet'; shipType?: string; jettisonedItemId?: string; position: Vector3; oreRemainingCubicMeters: number; initialOreCubicMeters: number; locked: boolean; locking: boolean; lockProgress: number }) => void
  onShipStatusChange?: (status: ShipStatus) => void
  onModuleActiveChange?: (moduleName: string, isActive: boolean, targetId?: string) => void
  onMiningLaserUpdate?: (active: boolean, source?: Vector3, target?: Vector3) => void
  onAsteroidExtraction?: (asteroidId: string, position: Vector3) => Promise<MiningExtractionResult | undefined>
  onInventoryChanged?: () => void
  onJettisonedItemPickup?: (jettisonedItemId: string, position: Vector3) => Promise<boolean>
  onPilotTargetLockChange?: (pilotId: string, active: boolean) => void
  hasShieldGenerator?: boolean
  initialPosition?: Vector3
  initialShields?: number
  initialHull?: number
  initialFuelLiters?: number
  initialPowerMegajoules?: number
  initialCargoCubicMeters?: number
  initialMaximumCargoCubicMeters?: number
  initialLaunchSpeed?: number
  initialFlightAssistEnabled?: boolean
  maximumSublightSpeedMetersPerSecond?: number
  maximumTargetLocks?: number
  systemRadiusMeters?: number
  warpCruiseSpeedMetersPerSecond?: number
}

export type WarpPhase = 'aligning' | 'accelerating' | 'warping' | 'cruising' | 'decelerating'

export interface ShipStatus {
  shields: number
  hull: number
  fuelLiters: number
  maximumFuelLiters: number
  powerMegajoules: number
  maximumPowerMegajoules: number
  warpCapacity: number
  maximumWarpCapacity: number
  maximumWarpRangeKilometers: number
  cargoCubicMeters: number
  maximumCargoCubicMeters: number
  destroyed: boolean
  collisionName?: string
}

interface CollisionTarget {
  mesh: AbstractMesh
  name: string
  massKg: number
  radius: number
  fatal?: boolean
}

interface AsteroidInteractionTarget {
  asteroidId?: string
  name: string
  initialOreCubicMeters: number
  oreRemainingCubicMeters: number
  baseScaling: Vector3
}

interface TargetDescriptor {
  targetId?: string
  name: string
  kind: 'asteroid' | 'pilot' | 'cargo' | 'warpable' | 'station' | 'planet'
  pilotId?: string
  shipType?: string
  jettisonedItemId?: string
}

interface OreChunk {
  mesh: AbstractMesh
  origin: Vector3
  destination: Vector3
  wobbleSide: Vector3
  wobbleAmplitude: number
  wobblePhase: number
  elapsedSeconds: number
  travelSeconds: number
  volumeCubicMeters: number
}

interface MiningImpactSpark {
  mesh: Mesh
  velocity: Vector3
  ageSeconds: number
}

export function createSystemScene(canvas: HTMLCanvasElement, options: SceneOptions): SceneController {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  const scene = new Scene(engine)
  scene.clearColor.set(0.008, 0.016, 0.043, 1)
  const collisionTargets: CollisionTarget[] = []
  const asteroidTargets = new Map<number, AsteroidInteractionTarget>()
  const asteroidMeshes = new Map<string, AbstractMesh>()
  const jettisonedItemMeshes = new Map<string, AbstractMesh>()
  const targetDescriptors = new Map<number, TargetDescriptor>()
  const targetableMeshes = new Map<string, AbstractMesh>()
  const renderableObjects: { mesh: AbstractMesh; rangeMeters: number }[] = []
  const registerRenderableObject = (mesh: AbstractMesh, rangeMeters: number) => {
    renderableObjects.push({ mesh, rangeMeters })
  }
  const registerCollisionTarget = (mesh: AbstractMesh, name: string, massKg: number, radius: number, fatal = false) => {
    collisionTargets.push({ mesh, name, massKg, radius, fatal })
  }
  const registerAsteroid = (mesh: AbstractMesh, name: string, radius: number, oreVolumeCubicMeters: number, asteroidId?: string) => {
    const oreVolume = Math.max(0.5, oreVolumeCubicMeters)
    asteroidTargets.set(mesh.uniqueId, {
      asteroidId,
      name,
      initialOreCubicMeters: oreVolume,
      oreRemainingCubicMeters: oreVolume,
      baseScaling: mesh.scaling.clone(),
    })
    targetDescriptors.set(mesh.uniqueId, { targetId: asteroidId ? `asteroid:${asteroidId}` : undefined, name, kind: 'asteroid' })
    if (asteroidId) targetableMeshes.set(`asteroid:${asteroidId}`, mesh)
    registerCollisionTarget(mesh, name, 4_000_000_000, radius * 1.3)
    registerRenderableObject(mesh, 30_000)
  }
  const registerJettisonedItem = (mesh: AbstractMesh, item: ServerJettisonedItem) => {
    targetDescriptors.set(mesh.uniqueId, {
      name: `${item.definitionId.toUpperCase()} x${item.quantity}`,
      kind: 'cargo',
      jettisonedItemId: item.id,
    })
    registerRenderableObject(mesh, 15_000)
  }
  const stationWorldPosition = new Vector3(-2_600_000_000, 480, -4_510_180_000)
  const launchWorldPosition = stationWorldPosition.add(new Vector3(0, 0, 709.5))
  const renderingOrigin = stationWorldPosition.clone()
  const toRenderPosition = (position: Vector3) => position.subtract(renderingOrigin)
  const toWorldPosition = (position: Vector3) => position.add(renderingOrigin)
  const stationPosition = toRenderPosition(stationWorldPosition)
  const launchPosition = toRenderPosition(launchWorldPosition)
  const renderUnitsPerMeter = 3 / 10
  const astronomicalVisualCompression = 300_000
  const physicalStarDiameterUnits = primaryStarPoi.star!.diameterKilometers * 1_000 * renderUnitsPerMeter
  const starVisualDiameter = physicalStarDiameterUnits / astronomicalVisualCompression

  const camera = new ArcRotateCamera(
    'isometric-camera',
    -Math.PI / 4,
    Math.PI / 3,
    20,
    launchPosition.clone(),
    scene,
  )
  camera.lowerRadiusLimit = 12
  camera.upperRadiusLimit = 5_000
  camera.wheelDeltaPercentage = 0.015
  camera.maxZ = 1_000_000
  camera.attachControl(canvas, true)
  const pointerInput = camera.inputs.attached.pointers as ArcRotateCameraPointersInput
  pointerInput.buttons = [0]

  new Layer('milky-way-backdrop', '/8k_stars_milky_way.jpg', scene, true)

  const light = new HemisphericLight('star-light', new Vector3(-0.4, 1, -0.2), scene)
  light.intensity = 1.15

  const glow = new GlowLayer('star-glow', scene)
  glow.intensity = 0.75

  const star = MeshBuilder.CreateSphere('primary-star', { diameter: starVisualDiameter, segments: 24 }, scene)
  const starMaterial = new StandardMaterial('primary-star-material', scene)
  starMaterial.emissiveColor = Color3.FromHexString(primaryStarPoi.star!.color)
  starMaterial.diffuseColor = new Color3(0.7, 0.16, 0.02)
  star.material = starMaterial
  targetDescriptors.set(star.uniqueId, { targetId: 'warpable:primary-star', name: 'PRIMARY STAR', kind: 'warpable' })
  targetableMeshes.set('warpable:primary-star', star)
  star.setEnabled(false)
  const starVisualScaleDistance = 60_000
  const minimumStarVisualScale = 0.18

  for (const poi of planetPois) {
    const planetDiameterMeters = poi.planet!.diameterKilometers * 1_000
    const planet = MeshBuilder.CreateSphere(poi.id, { diameter: planetDiameterMeters, segments: 32 }, scene)
    planet.position = toRenderPosition(new Vector3(poi.position.x, poi.position.y, poi.position.z))
    const planetMaterial = new StandardMaterial(`${poi.id}-material`, scene)
    planetMaterial.diffuseColor = Color3.FromHexString(poi.planet!.color)
    planetMaterial.specularColor = planetMaterial.diffuseColor.scale(0.35)
    planet.material = planetMaterial
    targetDescriptors.set(planet.uniqueId, { targetId: `planet:${poi.id}`, name: poi.name, kind: 'planet' })
    targetableMeshes.set(`planet:${poi.id}`, planet)
    registerRenderableObject(planet, planetDiameterMeters / 2 + 500_000)
    registerCollisionTarget(planet, poi.name, poi.planet!.massKg, planetDiameterMeters / 2, true)
  }

  const asteroidMaterial = new StandardMaterial('server-asteroid-material', scene)
  asteroidMaterial.diffuseColor = new Color3(0.38, 0.28, 0.17)
  asteroidMaterial.emissiveColor = new Color3(0.05, 0.025, 0.008)
  asteroidMaterial.specularColor = new Color3(0.08, 0.06, 0.04)
  const asteroidMaterials = new Map<string, StandardMaterial>()
  const hashString = (value: string) => {
    let hash = 2_166_136_261
    for (const character of value) {
      hash ^= character.charCodeAt(0)
      hash = Math.imul(hash, 16_777_619)
    }
    return hash >>> 0
  }
  const createSeededRandom = (seed: number) => () => {
    seed += 0x6D2B79F5
    let value = seed
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
  const asteroidMaterialFor = (composition: string) => {
    const key = composition.toLowerCase()
    const existingMaterial = asteroidMaterials.get(key)
    if (existingMaterial) return existingMaterial
    const material = asteroidMaterial.clone(`asteroid-material-${key}`)
    if (!material) return asteroidMaterial
    if (key.includes('iron') || key.includes('metal')) {
      material.diffuseColor = new Color3(0.23, 0.25, 0.27)
      material.emissiveColor = new Color3(0.012, 0.016, 0.018)
      material.specularColor = new Color3(0.28, 0.3, 0.32)
    } else if (key.includes('ice')) {
      material.diffuseColor = new Color3(0.3, 0.43, 0.48)
      material.emissiveColor = new Color3(0.018, 0.04, 0.055)
      material.specularColor = new Color3(0.32, 0.42, 0.48)
    } else if (key.includes('silicate') || key.includes('quartz')) {
      material.diffuseColor = new Color3(0.4, 0.31, 0.21)
      material.emissiveColor = new Color3(0.045, 0.025, 0.01)
    }
    asteroidMaterials.set(key, material)
    return material
  }
  const createAsteroidMesh = (asteroid: ServerAsteroid) => {
    const mesh = MeshBuilder.CreateIcoSphere(`asteroid-${asteroid.id}`, { radius: asteroid.radius, subdivisions: 2, flat: true }, scene)
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind)
    const indices = mesh.getIndices()
    if (positions && indices) {
      const random = createSeededRandom(hashString(asteroid.id))
      for (let index = 0; index < positions.length; index += 3) {
        const direction = new Vector3(positions[index], positions[index + 1], positions[index + 2]).normalize()
        const ridge = Math.sin(direction.x * 7.1 + direction.z * 4.3) * 0.055
        const crater = Math.max(0, Math.sin(direction.y * 11.7 - direction.x * 5.4)) * -0.08
        const variation = 0.78 + random() * 0.27 + ridge + crater
        positions[index] *= variation
        positions[index + 1] *= variation
        positions[index + 2] *= variation
      }
      const normals: number[] = []
      VertexData.ComputeNormals(positions, indices, normals)
      mesh.updateVerticesData(VertexBuffer.PositionKind, positions)
      mesh.updateVerticesData(VertexBuffer.NormalKind, normals)
    }
    mesh.material = asteroidMaterialFor(asteroid.composition)
    return mesh
  }

  const stationMaterial = new StandardMaterial('station-marker-material', scene)
  stationMaterial.diffuseColor = new Color3(0.16, 0.4, 0.5)
  stationMaterial.emissiveColor = new Color3(0.02, 0.16, 0.22)
  const station = MeshBuilder.CreateTorus('station-marker', { diameter: 337.5, thickness: 24, tessellation: 32 }, scene)
  station.position = stationPosition
  station.material = stationMaterial
  targetDescriptors.set(station.uniqueId, { targetId: 'station:kepler-station', name: 'KEPLER STATION', kind: 'station' })
  targetableMeshes.set('station:kepler-station', station)
  registerRenderableObject(station, 60_000)
  registerCollisionTarget(station, 'KEPLER STATION', 8_000_000_000, 170)

  const stationShield = MeshBuilder.CreateSphere('station-safe-zone', { diameter: 819, segments: 32 }, scene)
  const stationShieldRadius = 819 / 2
  stationShield.position = stationPosition
  const stationShieldMaterial = new StandardMaterial('station-safe-zone-material', scene)
  stationShieldMaterial.diffuseColor = new Color3(0.12, 0.7, 0.95)
  stationShieldMaterial.emissiveColor = new Color3(0.01, 0.08, 0.14)
  stationShieldMaterial.alpha = 0.16
  stationShieldMaterial.backFaceCulling = false
  stationShield.material = stationShieldMaterial
  registerRenderableObject(stationShield, 60_000)

  const stationHub = MeshBuilder.CreateCylinder('station-hub', { height: 36, diameter: 24, tessellation: 16 }, scene)
  stationHub.position = stationPosition
  stationHub.material = stationMaterial
  registerRenderableObject(stationHub, 60_000)
  registerCollisionTarget(stationHub, 'KEPLER STATION HUB', 8_000_000_000, 18)

  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const spoke = MeshBuilder.CreateBox('station-spoke', { width: 10, height: 10, depth: 138.75 }, scene)
    spoke.position = stationPosition.add(new Vector3(Math.sin(angle) * 81.375, 0, Math.cos(angle) * 81.375))
    spoke.rotation.y = angle
    spoke.material = stationMaterial
    registerRenderableObject(spoke, 60_000)
    registerCollisionTarget(spoke, 'KEPLER STATION', 8_000_000_000, 75)
  }

  const createStandardStation = (poi: typeof stationPois[number]) => {
    const position = toRenderPosition(new Vector3(poi.position.x, poi.position.y, poi.position.z))
    const marker = MeshBuilder.CreateTorus(`station-${poi.id}`, { diameter: 337.5, thickness: 24, tessellation: 32 }, scene)
    marker.position = position
    marker.material = stationMaterial
    targetDescriptors.set(marker.uniqueId, { targetId: `station:${poi.id}`, name: poi.name, kind: 'station' })
    targetableMeshes.set(`station:${poi.id}`, marker)
    registerRenderableObject(marker, 60_000)
    registerCollisionTarget(marker, poi.name, 8_000_000_000, 170)
    const hub = MeshBuilder.CreateCylinder(`station-hub-${poi.id}`, { height: 36, diameter: 24, tessellation: 16 }, scene)
    hub.position = position
    hub.material = stationMaterial
    registerRenderableObject(hub, 60_000)
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const spoke = MeshBuilder.CreateBox(`station-spoke-${poi.id}`, { width: 10, height: 10, depth: 138.75 }, scene)
      spoke.position = position.add(new Vector3(Math.sin(angle) * 81.375, 0, Math.cos(angle) * 81.375))
      spoke.rotation.y = angle
      spoke.material = stationMaterial
      registerRenderableObject(spoke, 60_000)
    }
  }
  stationPois.filter((poi) => poi.id !== 'kepler-station').forEach(createStandardStation)

  const ship = new TransformNode('starter-ship', scene)
  ship.position = options.initialPosition ? toRenderPosition(options.initialPosition) : launchPosition.clone()
  const shipMaterial = new StandardMaterial('starter-ship-material', scene)
  shipMaterial.diffuseColor = new Color3(0.34, 0.06, 0.05)
  shipMaterial.emissiveColor = new Color3(0.09, 0.008, 0.006)
  shipMaterial.specularColor = new Color3(0.55, 0.38, 0.32)
  const shipTrimMaterial = new StandardMaterial('starter-ship-trim-material', scene)
  shipTrimMaterial.diffuseColor = new Color3(0.12, 0.13, 0.16)
  shipTrimMaterial.specularColor = new Color3(0.45, 0.48, 0.52)
  const canopyMaterial = new StandardMaterial('starter-ship-canopy-material', scene)
  canopyMaterial.diffuseColor = new Color3(0.03, 0.22, 0.3)
  canopyMaterial.emissiveColor = new Color3(0.01, 0.08, 0.12)
  canopyMaterial.specularColor = new Color3(0.7, 0.9, 1)
  const engineMaterial = new StandardMaterial('starter-ship-engine-material', scene)
  engineMaterial.diffuseColor = new Color3(0.03, 0.18, 0.24)
  engineMaterial.emissiveColor = new Color3(0.04, 0.72, 1)
  engineMaterial.disableLighting = true
  const attachShipPart = (part: Mesh, material: StandardMaterial, x: number, y: number, z: number) => {
    part.parent = ship
    part.position.set(x, y, z)
    part.material = material
    part.isPickable = false
    return part
  }
  attachShipPart(MeshBuilder.CreateBox('starter-ship-fuselage', { width: 1.65, height: 0.72, depth: 3.35 }, scene), shipMaterial, 0, 0, 0)
  const nose = attachShipPart(MeshBuilder.CreateCylinder('starter-ship-nose', {
    height: 2.15,
    diameterTop: 0.12,
    diameterBottom: 1.62,
    tessellation: 4,
  }, scene), shipMaterial, 0, 0, 2.55)
  nose.rotation.x = Math.PI / 2
  attachShipPart(MeshBuilder.CreateSphere('starter-ship-canopy', { diameterX: 1.12, diameterY: 0.56, diameterZ: 1.2, segments: 12 }, scene), canopyMaterial, 0, 0.52, 0.48)
  attachShipPart(MeshBuilder.CreateBox('starter-ship-cargo-hold', { width: 1.38, height: 0.82, depth: 1.25 }, scene), shipTrimMaterial, 0, -0.12, -1.92)
  for (const side of [-1, 1]) {
    const wing = attachShipPart(MeshBuilder.CreateBox(`starter-ship-wing-${side}`, { width: 2.2, height: 0.13, depth: 1.35 }, scene), shipMaterial, side * 1.48, -0.08, 0.1)
    wing.rotation.z = side * 0.12
    attachShipPart(MeshBuilder.CreateCylinder(`starter-ship-engine-${side}`, { height: 0.95, diameterTop: 0.38, diameterBottom: 0.58, tessellation: 8 }, scene), shipTrimMaterial, side * 0.6, 0, -2.18).rotation.x = -Math.PI / 2
    attachShipPart(MeshBuilder.CreateSphere(`starter-ship-exhaust-${side}`, { diameter: 0.38, segments: 8 }, scene), engineMaterial, side * 0.6, 0, -2.67)
  }
  const hardpoint = attachShipPart(MeshBuilder.CreateCylinder('starter-ship-hardpoint-01', { height: 1.35, diameter: 0.3, tessellation: 8 }, scene), shipTrimMaterial, 1.18, -0.12, 1.1)
  hardpoint.rotation.z = Math.PI / 2
  attachShipPart(MeshBuilder.CreateCylinder('starter-ship-hardpoint-emitter', { height: 0.52, diameter: 0.36, tessellation: 8 }, scene), engineMaterial, 1.82, -0.12, 1.1).rotation.z = Math.PI / 2
  const remotePilots = new Map<string, { ship: TransformNode; targetMesh: Mesh; contact: Mesh; nameplate: Mesh; destination: Vector3; snapshotPosition: Vector3; velocity: Vector3; lastSnapshotAt: number; yaw: number; pitch: number; roll: number; miningBeam?: Mesh; miningSource?: Vector3; miningTarget?: Vector3; activityMarker?: Mesh; docked?: boolean; inWarpTransit?: boolean }>()
  const updateRemotePilot = (pilot: RemotePilot) => {
    const snapshotAt = performance.now()
    const renderPosition = toRenderPosition(pilot.position)
    let remote = remotePilots.get(pilot.pilotId)
    if (!remote) {
      const remoteShip = new TransformNode(`remote-pilot-${pilot.pilotId}`, scene)
      remoteShip.position.copyFrom(renderPosition)
      const remoteMaterial = new StandardMaterial(`remote-pilot-material-${pilot.pilotId}`, scene)
      remoteMaterial.diffuseColor = new Color3(0.04, 0.35, 0.55)
      remoteMaterial.emissiveColor = new Color3(0.02, 0.15, 0.32)
      const remoteHull = MeshBuilder.CreateBox(`remote-pilot-hull-${pilot.pilotId}`, { width: 1.7, height: 0.6, depth: 3.2 }, scene)
      remoteHull.material = remoteMaterial
      remoteHull.parent = remoteShip
      remoteHull.isPickable = true
      targetDescriptors.set(remoteHull.uniqueId, { targetId: `player:${pilot.pilotId}`, name: pilot.displayName, kind: 'pilot', pilotId: pilot.pilotId, shipType: pilot.shipType })
      targetableMeshes.set(`player:${pilot.pilotId}`, remoteHull)
      const contactMaterial = new StandardMaterial(`remote-pilot-contact-material-${pilot.pilotId}`, scene)
      contactMaterial.emissiveColor = new Color3(0.08, 0.9, 0.75)
      contactMaterial.diffuseColor = new Color3(0.02, 0.2, 0.18)
      const contact = MeshBuilder.CreateTorus(`remote-pilot-contact-${pilot.pilotId}`, { diameter: 9, thickness: 0.32, tessellation: 20 }, scene)
      contact.material = contactMaterial
      contact.parent = remoteShip
      contact.position.y = 1.8
      contact.billboardMode = Mesh.BILLBOARDMODE_ALL
      contact.isPickable = false
      glow.addIncludedOnlyMesh(contact)
      const remoteNose = MeshBuilder.CreateCylinder(`remote-pilot-nose-${pilot.pilotId}`, {
        height: 1.9,
        diameterTop: 0.08,
        diameterBottom: 1.45,
        tessellation: 4,
      }, scene)
      remoteNose.parent = remoteShip
      remoteNose.position.z = 2.35
      remoteNose.rotation.x = Math.PI / 2
      remoteNose.material = remoteMaterial
      const remoteEngineMaterial = new StandardMaterial(`remote-pilot-engine-material-${pilot.pilotId}`, scene)
      remoteEngineMaterial.emissiveColor = new Color3(0.1, 0.9, 1)
      remoteEngineMaterial.diffuseColor = new Color3(0.02, 0.1, 0.16)
      for (const engineX of [-0.52, 0.52]) {
        const remoteEngine = MeshBuilder.CreateCylinder(`remote-pilot-engine-${pilot.pilotId}-${engineX}`, {
          height: 0.85,
          diameterTop: 0.42,
          diameterBottom: 0.55,
          tessellation: 8,
        }, scene)
        remoteEngine.parent = remoteShip
        remoteEngine.position.set(engineX, 0, -1.8)
        remoteEngine.rotation.x = -Math.PI / 2
        remoteEngine.material = remoteEngineMaterial
      }
      for (const side of [-1, 1]) {
        const remoteThruster = MeshBuilder.CreateCylinder(`remote-pilot-strafe-${pilot.pilotId}-${side}`, {
          height: 0.7,
          diameterTop: 0.2,
          diameterBottom: 0.46,
          tessellation: 8,
        }, scene)
        remoteThruster.parent = remoteShip
        remoteThruster.position.set(side * 1.15, 0, -0.65)
        remoteThruster.rotation.z = side * Math.PI / 2
        remoteThruster.material = remoteEngineMaterial
      }
      const nameplate = MeshBuilder.CreatePlane(`remote-pilot-nameplate-${pilot.pilotId}`, { width: 8, height: 1.2 }, scene)
      const nameplateTexture = new DynamicTexture(`remote-pilot-nameplate-texture-${pilot.pilotId}`, { width: 512, height: 80 }, scene, true)
      nameplateTexture.hasAlpha = true
      nameplateTexture.drawText(pilot.displayName, null, 54, 'bold 44px sans-serif', '#d9f4ff', 'transparent', true)
      const nameplateMaterial = new StandardMaterial(`remote-pilot-nameplate-material-${pilot.pilotId}`, scene)
      nameplateMaterial.diffuseTexture = nameplateTexture
      nameplateMaterial.emissiveTexture = nameplateTexture
      nameplateMaterial.opacityTexture = nameplateTexture
      nameplateMaterial.disableLighting = true
      nameplate.material = nameplateMaterial
      nameplate.parent = remoteShip
      nameplate.position.y = 5.4
      nameplate.billboardMode = Mesh.BILLBOARDMODE_ALL
      nameplate.isPickable = false
      remoteShip.rotation.set(-pilot.pitch, pilot.yaw, pilot.roll)
      remote = { ship: remoteShip, targetMesh: remoteHull, contact, nameplate, destination: renderPosition.clone(), snapshotPosition: renderPosition.clone(), velocity: Vector3.Zero(), lastSnapshotAt: snapshotAt, yaw: pilot.yaw, pitch: pilot.pitch, roll: pilot.roll }
      remotePilots.set(pilot.pilotId, remote)
    }
    const elapsedSeconds = Math.max(0.1, (snapshotAt - remote.lastSnapshotAt) / 1_000)
    remote.velocity = renderPosition.subtract(remote.snapshotPosition).scale(1 / elapsedSeconds)
    remote.snapshotPosition.copyFrom(renderPosition)
    remote.destination.copyFrom(renderPosition)
    remote.lastSnapshotAt = snapshotAt
    remote.yaw = pilot.yaw
    remote.pitch = pilot.pitch
    remote.roll = pilot.roll
  }
  const removeRemotePilot = (pilotId: string) => {
    const remote = remotePilots.get(pilotId)
    if (remote && targetedAsteroid === remote.targetMesh) clearTarget()
    if (remote) unlockTarget(remote.targetMesh)
    remote?.miningBeam?.dispose()
    hostileTargetBrackets.get(pilotId)?.dispose()
    hostileTargetBrackets.delete(pilotId)
    if (remote) {
      targetDescriptors.delete(remote.targetMesh.uniqueId)
      targetableMeshes.delete(`player:${pilotId}`)
    }
    remote?.ship.dispose(false, true)
    remotePilots.delete(pilotId)
  }
  const remoteMiningMaterial = new StandardMaterial('remote-mining-laser-material', scene)
  remoteMiningMaterial.emissiveColor = new Color3(0.05, 0.8, 1)
  remoteMiningMaterial.diffuseColor = new Color3(0.02, 0.3, 0.5)
  const remoteLockMaterial = new StandardMaterial('remote-target-lock-material', scene)
  remoteLockMaterial.emissiveColor = new Color3(0.95, 0.7, 0.12)
  remoteLockMaterial.diffuseColor = new Color3(0.45, 0.25, 0.02)
  const setRemotePilotActivity = (pilotId: string, activity: RemotePilotActivity) => {
    const remote = remotePilots.get(pilotId)
    if (!remote) return
    const inWarpTransit = activity.warpPhase === 'warping' || activity.warpPhase === 'cruising'
    remote.docked = activity.docked
    remote.inWarpTransit = inWarpTransit
    remote.ship.setEnabled(!remote.docked)
    const showLock = ['locking_asteroid', 'target_locked', 'mining'].includes(activity.behaviorState)
    if (showLock && !remote.activityMarker) {
      remote.activityMarker = MeshBuilder.CreateTorus(`remote-target-lock-${pilotId}`, { diameter: 7, thickness: 0.16, tessellation: 24 }, scene)
      remote.activityMarker.material = remoteLockMaterial
      remote.activityMarker.isPickable = false
      glow.addIncludedOnlyMesh(remote.activityMarker)
    }
    if (remote.activityMarker) {
      remote.activityMarker.position.copyFrom(toRenderPosition(activity.target))
      remote.activityMarker.setEnabled(showLock)
    }
    if (activity.docked || inWarpTransit) setRemotePilotMining(pilotId, false, activity.target, activity.target)
  }
  const setRemotePilotMining = (pilotId: string, active: boolean, source: Vector3, target: Vector3) => {
    const remote = remotePilots.get(pilotId)
    if (!remote) return
    if (!active) {
      remote.miningBeam?.setEnabled(false)
      remote.miningSource = undefined
      remote.miningTarget = undefined
      return
    }
    if (!remote.miningBeam) {
      remote.miningBeam = MeshBuilder.CreateTube(`remote-mining-laser-${pilotId}`, { path: [toRenderPosition(source), toRenderPosition(target)], radius: 0.2, tessellation: 8, updatable: true }, scene)
      remote.miningBeam.material = remoteMiningMaterial
      remote.miningBeam.isPickable = false
      glow.addIncludedOnlyMesh(remote.miningBeam)
    }
    remote.miningBeam.setEnabled(true)
    remote.miningSource = toRenderPosition(source)
    remote.miningTarget = toRenderPosition(target)
    remote.miningBeam = MeshBuilder.CreateTube(remote.miningBeam.name, { path: [remote.miningSource, remote.miningTarget], radius: 0.2, tessellation: 8, instance: remote.miningBeam }, scene)
  }
  const shipMassKg = 25_000
  const shipCollisionRadius = 3
  const hasShieldGenerator = options.hasShieldGenerator ?? true
  const maximumShields = hasShieldGenerator ? 100 : 0
  const maximumHull = 100
  const maximumFuelLiters = 80
  const maximumPowerMegajoules = 100
  const powerRegenerationMegawatts = 8
  const miningLaserPowerDrawMegawatts = 12
  const remotePilotVisibilityRangeMeters = 500_000
  const warpDriveStats = {
    maximumCapacity: 100,
    rechargeCapacityPerSecond: 2,
    capacityDrainPerSecond: 2,
    maximumSpeedMetersPerSecond: options.warpCruiseSpeedMetersPerSecond ?? 10_000,
    manualCooldownSeconds: 30,
  }
  const warpEntryCapacityCost = warpDriveStats.maximumCapacity * 0.1
  const maximumWarpRangeKilometers = (
    (warpDriveStats.maximumCapacity - warpEntryCapacityCost)
    / warpDriveStats.capacityDrainPerSecond
  ) * warpDriveStats.maximumSpeedMetersPerSecond / 1_000
  let maximumCargoCubicMeters = options.initialMaximumCargoCubicMeters ?? 24
  let shields = options.initialShields ?? maximumShields
  let hullIntegrity = options.initialHull ?? maximumHull
  let fuelLiters = options.initialFuelLiters ?? maximumFuelLiters
  let powerMegajoules = options.initialPowerMegajoules ?? maximumPowerMegajoules
  let warpCapacity = warpDriveStats.maximumCapacity
  let cargoCubicMeters = options.initialCargoCubicMeters ?? 0
  let miningLaserReportedActive = false
  let miningLaserReportedTarget: AbstractMesh | undefined
  let miningExtractionPending = false
  const activeModules = new Set<string>()
  const activeModuleTargets = new Map<string, AbstractMesh>()
  const shieldBubbleMaterial = new StandardMaterial('starter-ship-shield-bubble-material', scene)
  shieldBubbleMaterial.diffuseColor = new Color3(0.08, 0.58, 1)
  shieldBubbleMaterial.emissiveColor = new Color3(0.02, 0.25, 0.62)
  shieldBubbleMaterial.alpha = 0.3
  shieldBubbleMaterial.backFaceCulling = false
  const shieldBubble = MeshBuilder.CreateSphere('starter-ship-shield-bubble', { diameter: 11, segments: 24 }, scene)
  shieldBubble.parent = ship
  shieldBubble.isPickable = false
  shieldBubble.material = shieldBubbleMaterial
  shieldBubble.setEnabled(false)
  let shieldImpactSeconds = 0
  let isDestroyed = false
  let explosionAge = 0
  const explosionMaterial = new StandardMaterial('ship-explosion-material', scene)
  explosionMaterial.emissiveColor = new Color3(1, 0.28, 0.03)
  const explosion = MeshBuilder.CreateSphere('ship-explosion', { diameter: 1, segments: 16 }, scene)
  explosion.material = explosionMaterial
  explosion.setEnabled(false)
  const activeCollisionIds = new Set<number>()
  const updateShipStatus = (collisionName?: string) => options.onShipStatusChange?.({
    shields,
    hull: hullIntegrity,
    fuelLiters,
    maximumFuelLiters,
    powerMegajoules,
    maximumPowerMegajoules,
    warpCapacity,
    maximumWarpCapacity: warpDriveStats.maximumCapacity,
    maximumWarpRangeKilometers,
    cargoCubicMeters,
    maximumCargoCubicMeters,
    destroyed: isDestroyed,
    collisionName,
  })
  const destroyShip = (collisionName: string) => {
    if (isDestroyed) return
    isDestroyed = true
    hullIntegrity = 0
    shields = 0
    velocity.setAll(0)
    ship.setEnabled(false)
    explosion.position.copyFrom(ship.position)
    explosion.scaling.setAll(1)
    explosion.setEnabled(true)
    updateShipStatus(collisionName)
  }
  const respawnShip = () => {
    isDestroyed = false
    explosionAge = 0
    explosionMaterial.alpha = 1
    explosion.setEnabled(false)
    ship.position.copyFrom(launchPosition)
    shipYaw = 0
    shipPitch = 0
    shipRoll = 0
    velocity.setAll(0)
    shields = maximumShields
    hullIntegrity = maximumHull
    fuelLiters = maximumFuelLiters
    powerMegajoules = maximumPowerMegajoules
    warpCapacity = warpDriveStats.maximumCapacity
    cargoCubicMeters = 0
    activeModules.clear()
    ship.setEnabled(true)
    activeCollisionIds.clear()
    postWarpCollisionImmunitySeconds = 2
    updateShipStatus()
  }
  const resolveWorldCollisions = () => {
    const isInWarpTransit = warp?.phase === 'warping' || warp?.phase === 'cruising' || warp?.phase === 'decelerating'
    if (isDestroyed || isInWarpTransit || postWarpCollisionImmunitySeconds > 0) return
    for (const target of collisionTargets) {
      const targetRadius = target.radius
      const offset = ship.position.subtract(target.mesh.getAbsolutePosition())
      const separation = offset.length()
      const collisionDistance = shipCollisionRadius + targetRadius
      if (separation > collisionDistance) {
        activeCollisionIds.delete(target.mesh.uniqueId)
        continue
      }
      if (activeCollisionIds.has(target.mesh.uniqueId)) continue
      activeCollisionIds.add(target.mesh.uniqueId)
      if (target.fatal) {
        destroyShip(target.name)
        return
      }
      const reducedMass = (shipMassKg * target.massKg) / (shipMassKg + target.massKg)
      const impactDamage = Math.min(200, (0.5 * reducedMass * velocity.lengthSquared()) / 500_000_000)
      const shieldDamage = Math.min(shields, impactDamage)
      shields -= shieldDamage
      if (shieldDamage > 0) shieldImpactSeconds = 0.35
      hullIntegrity = Math.max(0, hullIntegrity - (impactDamage - shieldDamage))
      const normal = separation > 0 ? offset.scale(1 / separation) : Vector3.Up()
      ship.position.copyFrom(target.mesh.getAbsolutePosition().add(normal.scale(collisionDistance + 0.1)))
      velocity.scaleInPlace(-0.15)
      if (hullIntegrity === 0) destroyShip(target.name)
      else updateShipStatus(target.name)
    }
  }

  const strafeThrusterMaterials = [-1, 1].map((side) => {
    const material = new StandardMaterial(`starter-ship-strafe-${side}-material`, scene)
    material.emissiveColor = Color3.Black()
    const thruster = MeshBuilder.CreateCylinder(`starter-ship-strafe-${side}`, {
      height: 0.7,
      diameterTop: 0.2,
      diameterBottom: 0.46,
      tessellation: 8,
    }, scene)
    thruster.parent = ship
    thruster.position.set(side * 1.15, 0, -0.65)
    thruster.rotation.z = side * Math.PI / 2
    thruster.material = material
    return material
  })

  const pressedKeys = new Set<string>()
  let flightAssistEnabled = options.initialFlightAssistEnabled ?? true
  const velocity = new Vector3(0, 0, options.initialLaunchSpeed ?? 0)
  let approachTarget: AbstractMesh | undefined
  const approachDistanceMeters = 250
  const engineThrustNewtons = 550_000
  const brakingThrustNewtons = 200_000
  const maximumSublightSpeedCapMetersPerSecond = 2_500
  let maximumSpeed = Math.min(
    options.maximumSublightSpeedMetersPerSecond ?? maximumSublightSpeedCapMetersPerSecond,
    maximumSublightSpeedCapMetersPerSecond,
  )
  let shipYaw = 0
  let shipPitch = 0
  let shipRoll = 0
  let isSteering = false
  let pointerLockWasActive = false
  let steeringTargetYaw = 0
  let steeringTargetPitch = 0
  const turnSpeed = 2.8
  const pointerSteeringSensitivity = 0.003
  const maximumSteeringPitch = Math.PI / 2 - 0.01
  let dockingAvailable = false
  let postWarpCollisionImmunitySeconds = 0
  let manualWarpCooldownSeconds = 0
  let warp: {
    origin: Vector3
    destination: Vector3
    cruiseOrigin: Vector3
    direction: Vector3
    targetYaw: number
    targetPitch: number
    phase: WarpPhase
    phaseElapsedSeconds: number
    entrySpeedMetersPerSecond: number
    cruiseDurationSeconds: number
    cruiseCapacityDrainPerSecond: number
  } | undefined

  const warpPhaseDuration = (activeWarp: NonNullable<typeof warp>): number => {
    switch (activeWarp.phase) {
      case 'aligning': return 1.2
      case 'accelerating': return 4
      case 'warping': return 0.9
      case 'cruising': return activeWarp.cruiseDurationSeconds
      case 'decelerating': return 1.6
    }
  }

  const advanceWarpPhase = (activeWarp: NonNullable<typeof warp>) => {
    const phases: WarpPhase[] = ['aligning', 'accelerating', 'warping', 'cruising', 'decelerating']
    const phaseIndex = phases.indexOf(activeWarp.phase)
    const nextPhase = phases[phaseIndex + 1]
    if (!nextPhase) {
      velocity.setAll(0)
      const egressDirection = activeWarp.direction.clone()
      for (let pass = 0; pass < 2; pass += 1) {
        for (const target of collisionTargets) {
          const offset = ship.position.subtract(target.mesh.getAbsolutePosition())
          const collisionDistance = shipCollisionRadius + target.radius
          if (offset.length() >= collisionDistance) continue
          const normal = offset.lengthSquared() > 0 ? offset.normalize() : egressDirection
          ship.position.copyFrom(target.mesh.getAbsolutePosition().add(normal.scale(collisionDistance + 200)))
        }
      }
      activeCollisionIds.clear()
      postWarpCollisionImmunitySeconds = 2
      warp = undefined
      options.onWarpUpdate?.(false, 'decelerating', 1)
      return
    }
    if (nextPhase === 'accelerating') {
      activeWarp.entrySpeedMetersPerSecond = Math.max(
        100,
        Vector3.Dot(velocity, activeWarp.direction),
      )
    }
    activeWarp.phase = nextPhase
    activeWarp.phaseElapsedSeconds = 0
    if (nextPhase === 'cruising') activeWarp.cruiseOrigin = ship.position.clone()
    if (nextPhase === 'decelerating') activeWarp.cruiseOrigin = ship.position.clone()
  }

  const beginWarpEgress = (activeWarp: NonNullable<typeof warp>) => {
    const decelerationDurationSeconds = 1.6
    const decelerationDistance = warpDriveStats.maximumSpeedMetersPerSecond * decelerationDurationSeconds / 2
    activeWarp.destination = ship.position.add(activeWarp.direction.scale(decelerationDistance))
    activeWarp.cruiseOrigin = ship.position.clone()
    activeWarp.phase = 'decelerating'
    activeWarp.phaseElapsedSeconds = 0
  }

  const warpTo = (destination: Vector3): boolean => {
    destination = toRenderPosition(destination)
    if (warp || Vector3.Distance(ship.position, destination) <= 100_000) return false
    const distance = Vector3.Distance(ship.position, destination)
    if (warpCapacity <= warpEntryCapacityCost) return false
    const direction = destination.subtract(ship.position).normalize()
    const cruiseDurationSeconds = Math.max(3, distance / warpDriveStats.maximumSpeedMetersPerSecond)
    isSteering = false
    canvas.classList.remove('is-steering')
    if (document.pointerLockElement === canvas) {
      pointerLockWasActive = false
      document.exitPointerLock()
    }
    warp = {
      origin: ship.position.clone(),
      destination: destination.clone(),
      cruiseOrigin: ship.position.clone(),
      direction,
      targetYaw: Math.atan2(direction.x, direction.z),
      targetPitch: Math.asin(direction.y),
      phase: 'aligning',
      phaseElapsedSeconds: 0,
      entrySpeedMetersPerSecond: 0,
      cruiseDurationSeconds,
      cruiseCapacityDrainPerSecond: warpDriveStats.capacityDrainPerSecond,
    }
    warpCapacity -= warpEntryCapacityCost
    updateShipStatus()
    options.onWarpUpdate?.(true, 'aligning', 0)
    return true
  }

  const toggleWarp = (): boolean => {
    if (warp) {
      if (warp.phase !== 'decelerating') beginWarpEgress(warp)
      return true
    }
    if (manualWarpCooldownSeconds > 0) return false
    const direction = new Vector3(
      Math.sin(shipYaw) * Math.cos(shipPitch),
      Math.sin(shipPitch),
      Math.cos(shipYaw) * Math.cos(shipPitch),
    )
    const started = warpTo(
      toWorldPosition(ship.position.add(direction.scale(options.systemRadiusMeters ?? 18_000_000))),
    )
    if (started) manualWarpCooldownSeconds = warpDriveStats.manualCooldownSeconds
    return started
  }

  const setModuleActive = (moduleName: string, isActive: boolean) => {
    const activeTarget = activeModuleTargets.get(moduleName)
    if (isActive) {
      activeModules.add(moduleName)
      if (targetedAsteroid && (lockedTargets.has(targetedAsteroid) || lockingTarget?.asteroid === targetedAsteroid)) {
        activeModuleTargets.set(moduleName, targetedAsteroid)
      }
    } else {
      activeModules.delete(moduleName)
      activeModuleTargets.delete(moduleName)
    }
    const target = isActive ? activeModuleTargets.get(moduleName) : activeTarget
    options.onModuleActiveChange?.(moduleName, isActive, target ? targetDescriptors.get(target.uniqueId)?.targetId : undefined)
    updateShipStatus()
  }

  const setSteeringTargetFromPointer = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect()
    const ray = scene.createPickingRay(clientX - rect.left, clientY - rect.top, null, camera)
    const targetDirection = ray.direction.normalize()
    steeringTargetYaw = Math.atan2(targetDirection.x, targetDirection.z)
    steeringTargetPitch = Math.asin(targetDirection.y)
  }
  const handleMouseDown = (event: PointerEvent) => {
    if (options.isInputBlocked?.()) return
    if (event.button !== 2) return
    event.preventDefault()
    if (warp) return
    setSteeringTargetFromPointer(event.clientX, event.clientY)
    canvas.setPointerCapture(event.pointerId)
    isSteering = true
    canvas.classList.add('is-steering')
    void Promise.resolve(canvas.requestPointerLock()).catch(() => undefined)
  }
  const handlePointerMove = (event: PointerEvent) => {
    if (options.isInputBlocked?.()) return
    if (warp || !isSteering || !(event.buttons & 2)) return
    if (document.pointerLockElement === canvas) {
      steeringTargetYaw += event.movementX * pointerSteeringSensitivity
      steeringTargetPitch = Math.max(
        -maximumSteeringPitch,
        Math.min(maximumSteeringPitch, steeringTargetPitch - event.movementY * pointerSteeringSensitivity),
      )
      return
    }
    setSteeringTargetFromPointer(event.clientX, event.clientY)
  }
  const handleMouseUp = (event: PointerEvent) => {
    if (event.button !== 2) return
    isSteering = false
    canvas.classList.remove('is-steering')
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    if (document.pointerLockElement === canvas) {
      pointerLockWasActive = false
      document.exitPointerLock()
    }
  }
  const handlePointerLockChange = () => {
    if (document.pointerLockElement === canvas) {
      pointerLockWasActive = true
      canvas.classList.add('is-steering')
    } else if (pointerLockWasActive) {
      pointerLockWasActive = false
      isSteering = false
      canvas.classList.remove('is-steering')
    }
  }
  const handleContextMenu = (event: MouseEvent) => event.preventDefault()
  let targetedAsteroid: AbstractMesh | undefined
  const lockedTargets = new Map<AbstractMesh, TransformNode>()
  let lockingTarget: { asteroid: AbstractMesh; elapsedSeconds: number } | undefined
  let targetBrackets: TransformNode | undefined
  const hostileTargetBrackets = new Map<string, TransformNode>()
  const maximumTargetLocks = options.maximumTargetLocks ?? 3
  const miningLaserRange = 500
  const miningLaserMaterial = new StandardMaterial('mining-laser-beam-material', scene)
  miningLaserMaterial.diffuseColor = new Color3(0.1, 0.8, 0.45)
  miningLaserMaterial.emissiveColor = new Color3(0.25, 1, 0.65)
  const miningLaserBeam = MeshBuilder.CreateTube('mining-laser-beam', {
    path: [
      ship.position.clone(),
      ship.position.add(new Vector3(0, 0, 0.33)),
      ship.position.add(new Vector3(0, 0, 0.66)),
      ship.position.add(new Vector3(0, 0, 1)),
    ],
    radius: 0.25,
    tessellation: 8,
    updatable: true,
  }, scene)
  miningLaserBeam.material = miningLaserMaterial
  miningLaserBeam.isPickable = false
  miningLaserBeam.renderingGroupId = 1
  glow.addIncludedOnlyMesh(miningLaserBeam)
  miningLaserBeam.setEnabled(false)
  const oreChunks: OreChunk[] = []
  const miningImpactSparks: MiningImpactSpark[] = []
  const miningImpactMaterial = new StandardMaterial('mining-impact-spark-material', scene)
  miningImpactMaterial.emissiveColor = new Color3(1, 0.5, 0.08)
  miningImpactMaterial.disableLighting = true
  let nextMiningImpactSeconds = 0
  let nextOreChunkSeconds = 0.3
  const sensorPingMaterial = new StandardMaterial('sensor-ping-material', scene)
  sensorPingMaterial.emissiveColor = new Color3(0.1, 0.85, 1)
  sensorPingMaterial.alpha = 0.7
  sensorPingMaterial.wireframe = true
  const sensorPings: { mesh: Mesh; ageSeconds: number }[] = []
  const emitSensorPing = () => {
    const ping = MeshBuilder.CreateSphere('sensor-ping', { diameter: 2, segments: 24 }, scene)
    ping.position.copyFrom(ship.position)
    ping.material = sensorPingMaterial
    ping.isPickable = false
    glow.addIncludedOnlyMesh(ping)
    sensorPings.push({ mesh: ping, ageSeconds: 0 })
  }
  const targetLockDurationSeconds = 1.5
  const clearTarget = () => {
    targetBrackets?.dispose()
    targetBrackets = undefined
    targetedAsteroid = undefined
  }
  const reportTargetLock = () => {
    const targetMesh = targetedAsteroid ?? lockingTarget?.asteroid
    if (!targetMesh) {
      options.onTargetSelectionChange?.()
      return
    }
    const descriptor = targetDescriptors.get(targetMesh.uniqueId)
    if (!descriptor) return
    const asteroid = asteroidTargets.get(targetMesh.uniqueId)
    options.onTargetSelectionChange?.({
      id: descriptor.targetId,
      name: descriptor.name,
      kind: descriptor.kind,
      shipType: descriptor.shipType,
      jettisonedItemId: descriptor.jettisonedItemId,
      position: toWorldPosition(targetMesh.getAbsolutePosition()),
      oreRemainingCubicMeters: asteroid?.oreRemainingCubicMeters ?? 0,
      initialOreCubicMeters: asteroid?.initialOreCubicMeters ?? 0,
      locked: lockedTargets.has(targetMesh),
      locking: lockingTarget?.asteroid === targetMesh,
      lockProgress: lockingTarget?.asteroid === targetMesh ? Math.min(1, lockingTarget.elapsedSeconds / targetLockDurationSeconds) : 1,
    })
  }
  const unlockTarget = (targetMesh?: AbstractMesh) => {
    const target = targetMesh ?? targetedAsteroid ?? lockingTarget?.asteroid
    if (!target) return
    for (const [moduleName, moduleTarget] of activeModuleTargets) {
      if (moduleTarget === target) setModuleActive(moduleName, false)
    }
    const targetPilotId = targetDescriptors.get(target.uniqueId)?.pilotId
    if (targetPilotId) options.onPilotTargetLockChange?.(targetPilotId, false)
    lockedTargets.get(target)?.dispose()
    lockedTargets.delete(target)
    if (lockingTarget?.asteroid === target) lockingTarget = undefined
    reportTargetLock()
  }
  const clearTargetSelection = () => {
    if (targetedAsteroid && lockingTarget?.asteroid === targetedAsteroid) unlockTarget(targetedAsteroid)
    clearTarget()
    reportTargetLock()
  }
  const beginApproach = () => {
    if (!targetedAsteroid || !lockedTargets.has(targetedAsteroid)) return false
    approachTarget = targetedAsteroid
    return true
  }
  const replaceAsteroids = (asteroids: ServerAsteroid[]) => {
    const incomingIds = new Set(asteroids.map((asteroid) => asteroid.id))
    for (const [asteroidId, mesh] of asteroidMeshes) {
      if (incomingIds.has(asteroidId)) continue
      if (targetedAsteroid === mesh) clearTarget()
      unlockTarget(mesh)
      asteroidTargets.delete(mesh.uniqueId)
      targetDescriptors.delete(mesh.uniqueId)
      targetableMeshes.delete(`asteroid:${asteroidId}`)
      const collisionIndex = collisionTargets.findIndex((target) => target.mesh === mesh)
      if (collisionIndex >= 0) collisionTargets.splice(collisionIndex, 1)
      mesh.dispose()
      asteroidMeshes.delete(asteroidId)
    }
    for (const asteroid of asteroids) {
      let mesh = asteroidMeshes.get(asteroid.id)
      if (!mesh) {
        mesh = createAsteroidMesh(asteroid)
        mesh.position.copyFrom(toRenderPosition(asteroid.position))
        mesh.rotation.set(asteroid.position.x % Math.PI, asteroid.position.y % Math.PI, asteroid.position.z % Math.PI)
        registerAsteroid(mesh, `${asteroid.composition.toUpperCase()} ASTEROID`, asteroid.radius, asteroid.initialOreCubicMeters, asteroid.id)
        asteroidMeshes.set(asteroid.id, mesh)
      }
      const target = asteroidTargets.get(mesh.uniqueId)
      if (!target) continue
      target.initialOreCubicMeters = asteroid.initialOreCubicMeters
      target.oreRemainingCubicMeters = asteroid.remainingOreCubicMeters
      mesh.scaling.copyFrom(target.baseScaling.scale(Math.cbrt(asteroid.remainingOreCubicMeters / asteroid.initialOreCubicMeters)))
    }
  }
  const replaceJettisonedItems = (items: ServerJettisonedItem[]) => {
    const incomingIds = new Set(items.map((item) => item.id))
    for (const [itemId, mesh] of jettisonedItemMeshes) {
      if (incomingIds.has(itemId)) continue
      if (targetedAsteroid === mesh) clearTarget()
      unlockTarget(mesh)
      targetDescriptors.delete(mesh.uniqueId)
      mesh.dispose()
      jettisonedItemMeshes.delete(itemId)
    }
    for (const item of items) {
      let mesh = jettisonedItemMeshes.get(item.id)
      if (!mesh) {
        mesh = MeshBuilder.CreateBox(`jettisoned-${item.id}`, { size: 4 }, scene)
        mesh.material = asteroidMaterial
        registerJettisonedItem(mesh, item)
        jettisonedItemMeshes.set(item.id, mesh)
      }
      mesh.position.copyFrom(toRenderPosition(item.position))
      mesh.rotation.y += 0.02
    }
  }
  let pickupPending = false
  const pickupJettisonedItem = async () => {
    const mesh = targetedAsteroid && lockedTargets.has(targetedAsteroid) ? targetedAsteroid : undefined
    const itemId = mesh ? targetDescriptors.get(mesh.uniqueId)?.jettisonedItemId : undefined
    if (pickupPending || !mesh || !itemId || !options.onJettisonedItemPickup) return false
    pickupPending = true
    try {
      return await options.onJettisonedItemPickup(itemId, toWorldPosition(ship.position))
    } catch {
      return false
    } finally {
      pickupPending = false
    }
  }
  const setCargoCubicMeters = (
    nextCargoCubicMeters: number,
    nextMaximumCargoCubicMeters?: number,
  ) => {
    if (nextMaximumCargoCubicMeters !== undefined) {
      maximumCargoCubicMeters = Math.max(0, nextMaximumCargoCubicMeters)
    }
    cargoCubicMeters = Math.max(0, Math.min(maximumCargoCubicMeters, nextCargoCubicMeters))
    updateShipStatus()
  }
  const toggleTargetLock = () => {
    if (!targetedAsteroid) {
      if (lockingTarget) {
        unlockTarget(lockingTarget.asteroid)
      }
      return
    }
    if (lockingTarget?.asteroid === targetedAsteroid) {
      unlockTarget(targetedAsteroid)
      return
    }
    if (lockedTargets.has(targetedAsteroid)) {
      unlockTarget(targetedAsteroid)
      return
    }
    if (lockingTarget) unlockTarget(lockingTarget.asteroid)
    if (lockedTargets.size >= maximumTargetLocks) return
    lockingTarget = { asteroid: targetedAsteroid, elapsedSeconds: 0 }
    const targetPilotId = targetDescriptors.get(targetedAsteroid.uniqueId)?.pilotId
    if (targetPilotId) options.onPilotTargetLockChange?.(targetPilotId, true)
    reportTargetLock()
  }
  const createTargetBrackets = (bracketColor: Color3, kind: string) => {
    const brackets = new TransformNode(`${kind}-asteroid-target-brackets`, scene)
    const corners = [
      [new Vector3(-1, 0.7, 0), new Vector3(-1, 1, 0), new Vector3(-0.7, 1, 0)],
      [new Vector3(0.7, 1, 0), new Vector3(1, 1, 0), new Vector3(1, 0.7, 0)],
      [new Vector3(-1, -0.7, 0), new Vector3(-1, -1, 0), new Vector3(-0.7, -1, 0)],
      [new Vector3(0.7, -1, 0), new Vector3(1, -1, 0), new Vector3(1, -0.7, 0)],
    ]
    corners.forEach((points, index) => {
      const corner = MeshBuilder.CreateLines(`asteroid-target-bracket-${index}`, { points }, scene)
      corner.color = bracketColor
      corner.parent = brackets
    })
    return brackets
  }
  const setHostileTargeting = (pilotId: string, active: boolean) => {
    if (active && !hostileTargetBrackets.has(pilotId)) {
      hostileTargetBrackets.set(pilotId, createTargetBrackets(new Color3(1, 0.08, 0.08), 'hostile'))
    }
    if (!active) {
      hostileTargetBrackets.get(pilotId)?.dispose()
      hostileTargetBrackets.delete(pilotId)
    }
  }
  const showTargetBrackets = (asteroid: AbstractMesh) => {
    targetBrackets?.dispose()
    targetedAsteroid = asteroid
    targetBrackets = createTargetBrackets(new Color3(1, 0.72, 0.2), 'active')
  }
  const getTargetables = (): TargetableObject[] => {
    const targets: TargetableObject[] = []
    for (const [id, mesh] of targetableMeshes) {
      const descriptor = targetDescriptors.get(mesh.uniqueId)
      if (!descriptor || descriptor.kind === 'cargo' || descriptor.kind === 'pilot') continue
      targets.push({ id, name: descriptor.name, kind: descriptor.kind, position: toWorldPosition(mesh.getAbsolutePosition()), locked: lockedTargets.has(mesh), locking: lockingTarget?.asteroid === mesh })
    }
    for (const [pilotId, remote] of remotePilots) {
      const descriptor = targetDescriptors.get(remote.targetMesh.uniqueId)
      if (descriptor) targets.push({ id: `player:${pilotId}`, name: descriptor.name, kind: 'player', position: toWorldPosition(remote.targetMesh.getAbsolutePosition()), locked: lockedTargets.has(remote.targetMesh), locking: lockingTarget?.asteroid === remote.targetMesh })
    }
    return targets
  }
  const selectTarget = (targetId: string) => {
    const targetMesh = targetableMeshes.get(targetId)
    if (!targetMesh) return
    showTargetBrackets(targetMesh)
    reportTargetLock()
  }
  const handleClick = (event: MouseEvent) => {
    if (event.button !== 0 || warp || options.isInputBlocked?.()) return
    const rect = canvas.getBoundingClientRect()
    const picked = scene.pick(
      event.clientX - rect.left,
      event.clientY - rect.top,
      (mesh) => targetDescriptors.has(mesh.uniqueId),
    )
    if (!picked?.hit || !picked.pickedMesh) {
      clearTarget()
      return
    }
    showTargetBrackets(picked.pickedMesh)
    reportTargetLock()
    if (event.detail === 2) toggleTargetLock()
  }
  canvas.addEventListener('pointerdown', handleMouseDown, true)
  canvas.addEventListener('pointermove', handlePointerMove, true)
  window.addEventListener('pointerup', handleMouseUp, true)
  canvas.addEventListener('contextmenu', handleContextMenu)
  canvas.addEventListener('click', handleClick)
  document.addEventListener('pointerlockchange', handlePointerLockChange)

  const handleKeyDown = (event: KeyboardEvent) => {
    if (options.isInputBlocked?.() || isEditingText(event.target)) return
    const key = event.key.toLowerCase()
    if (key === 't' && !event.repeat) {
      event.preventDefault()
      toggleTargetLock()
      return
    }
    if (key === 'f' && !event.repeat) {
      flightAssistEnabled = !flightAssistEnabled
    }
    if (['w', 'a', 's', 'd', 'q', 'e', ' ', 'c', 'f', 'shift'].includes(key)) {
      event.preventDefault()
      pressedKeys.add(key)
    }
  }
  const handleKeyUp = (event: KeyboardEvent) => pressedKeys.delete(event.key.toLowerCase())
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)

  let lastFrameTime = performance.now()
  engine.runRenderLoop(() => {
    if (options.isInputBlocked?.() || isEditingText(document.activeElement)) {
      pressedKeys.clear()
      isSteering = false
      steeringTargetYaw = shipYaw
      steeringTargetPitch = shipPitch
      canvas.classList.remove('is-steering')
      if (document.pointerLockElement === canvas) document.exitPointerLock()
    }
    const now = performance.now()
    const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05)
    lastFrameTime = now
    if (options.isSimulationPaused?.()) {
      scene.render()
      return
    }
    postWarpCollisionImmunitySeconds = Math.max(0, postWarpCollisionImmunitySeconds - deltaSeconds)
    manualWarpCooldownSeconds = Math.max(0, manualWarpCooldownSeconds - deltaSeconds)
    if (lockingTarget) {
      lockingTarget.elapsedSeconds += deltaSeconds
      if (lockingTarget.elapsedSeconds >= targetLockDurationSeconds) {
        lockedTargets.set(lockingTarget.asteroid, createTargetBrackets(new Color3(0.72, 0.78, 0.82), 'locked'))
        lockingTarget = undefined
      }
      reportTargetLock()
    }

    const movementIntent = new Vector3(
      Number(pressedKeys.has('d')) - Number(pressedKeys.has('a')),
      Number(pressedKeys.has(' ')) - Number(pressedKeys.has('c')),
      Number(pressedKeys.has('w')) - Number(pressedKeys.has('s')),
    )
    const shipForward = new Vector3(
      Math.sin(shipYaw) * Math.cos(shipPitch),
      Math.sin(shipPitch),
      Math.cos(shipYaw) * Math.cos(shipPitch),
    )
    const shipRight = new Vector3(Math.cos(shipYaw), 0, -Math.sin(shipYaw))
    const frameStartPosition = ship.position.clone()
    if (!isDestroyed) {
      const powerDrawMegawatts = activeModules.has('Mining Laser') ? miningLaserPowerDrawMegawatts : 0
      const nextPowerMegajoules = Math.max(0, Math.min(
        maximumPowerMegajoules,
        powerMegajoules + (powerRegenerationMegawatts - powerDrawMegawatts) * deltaSeconds,
      ))
      if (nextPowerMegajoules !== powerMegajoules) {
        powerMegajoules = nextPowerMegajoules
        updateShipStatus()
      }
      if (powerMegajoules === 0 && activeModules.has('Mining Laser')) {
        setModuleActive('Mining Laser', false)
      }
      if (!warp && warpCapacity < warpDriveStats.maximumCapacity) {
        warpCapacity = Math.min(
          warpDriveStats.maximumCapacity,
          warpCapacity + warpDriveStats.rechargeCapacityPerSecond * deltaSeconds,
        )
        updateShipStatus()
      }
    }
    if (warp) {
      warp.phaseElapsedSeconds += deltaSeconds
      const phaseDuration = warpPhaseDuration(warp)
      const progress = Math.min(1, warp.phaseElapsedSeconds / phaseDuration)
      let warpReadyForTransit = warp.phase !== 'aligning'
      if (warp.phase === 'aligning') {
        const yawDifference = Math.atan2(Math.sin(warp.targetYaw - shipYaw), Math.cos(warp.targetYaw - shipYaw))
        shipYaw += yawDifference * Math.min(1, deltaSeconds * 3.5)
        shipPitch += (warp.targetPitch - shipPitch) * Math.min(1, deltaSeconds * 3.5)
        const forwardSpeed = Vector3.Dot(velocity, warp.direction)
        const forwardVelocity = warp.direction.scale(Math.max(0, forwardSpeed))
        const misalignedVelocity = velocity.subtract(forwardVelocity)
        if (misalignedVelocity.lengthSquared() > 0.01) {
          const brakingDistance = Math.min(misalignedVelocity.length(), (brakingThrustNewtons / shipMassKg) * deltaSeconds)
          velocity.addInPlace(misalignedVelocity.normalize().scale(-brakingDistance))
        } else if (forwardSpeed < 100) {
          const accelerationDistance = Math.min(100 - forwardSpeed, (engineThrustNewtons / shipMassKg) * deltaSeconds)
          velocity.addInPlace(warp.direction.scale(accelerationDistance))
        }
        ship.position.addInPlace(velocity.scale(deltaSeconds))
        if (progress === 1) {
          shipYaw = warp.targetYaw
          shipPitch = warp.targetPitch
          const currentSpeed = velocity.length()
          warpReadyForTransit = currentSpeed >= 99.9 && Vector3.Dot(velocity, warp.direction) / currentSpeed >= 0.999
        }
      } else if (warp.phase === 'accelerating') {
        const warpSpeed = warp.entrySpeedMetersPerSecond + (
          warpDriveStats.maximumSpeedMetersPerSecond - warp.entrySpeedMetersPerSecond
        ) * progress
        velocity.copyFrom(warp.direction).scaleInPlace(warpSpeed)
        ship.position.addInPlace(velocity.scale(deltaSeconds))
      } else if (warp.phase === 'warping') {
        velocity.copyFrom(warp.direction).scaleInPlace(warpDriveStats.maximumSpeedMetersPerSecond)
        ship.position.addInPlace(velocity.scale(deltaSeconds))
      } else if (warp.phase === 'cruising') {
        velocity.copyFrom(warp.direction).scaleInPlace(warpDriveStats.maximumSpeedMetersPerSecond)
        ship.position.addInPlace(velocity.scale(deltaSeconds))
        warpCapacity = Math.max(warpEntryCapacityCost, warpCapacity - warp.cruiseCapacityDrainPerSecond * deltaSeconds)
        updateShipStatus()
        if (warpCapacity <= warpEntryCapacityCost && progress < 1) {
          beginWarpEgress(warp)
        }
      } else if (warp.phase === 'decelerating') {
        const easedProgress = 1 - (1 - progress) * (1 - progress)
        Vector3.LerpToRef(warp.cruiseOrigin, warp.destination, easedProgress, ship.position)
        velocity.copyFrom(warp.direction).scaleInPlace(warpDriveStats.maximumSpeedMetersPerSecond * (1 - progress))
        warpCapacity = Math.max(0, warpCapacity - (warpEntryCapacityCost / phaseDuration) * deltaSeconds)
        updateShipStatus()
      }
      options.onWarpUpdate?.(true, warp.phase, progress)
      if (progress === 1 && warpReadyForTransit) {
        advanceWarpPhase(warp)
      }
    } else {
      const rollIntent = Number(pressedKeys.has('q')) - Number(pressedKeys.has('e'))
      let fuelBurnRate = 0
      shipRoll += rollIntent * 1.8 * deltaSeconds
      if (isSteering) {
        const maxTurn = turnSpeed * deltaSeconds
        const yawDifference = Math.atan2(Math.sin(steeringTargetYaw - shipYaw), Math.cos(steeringTargetYaw - shipYaw))
        shipYaw += Math.max(-maxTurn, Math.min(maxTurn, yawDifference))
        const pitchDifference = steeringTargetPitch - shipPitch
        shipPitch += Math.max(-maxTurn, Math.min(maxTurn, pitchDifference))
      }
      if (movementIntent.lengthSquared() > 0 || isSteering) approachTarget = undefined
      if (approachTarget) {
        const offset = approachTarget.getAbsolutePosition().subtract(ship.position)
        const distance = offset.length()
        if (!lockedTargets.has(approachTarget) || distance <= approachDistanceMeters) {
          approachTarget = undefined
          velocity.scaleInPlace(0.4)
        } else {
          const targetDirection = offset.scale(1 / distance)
          const targetYaw = Math.atan2(targetDirection.x, targetDirection.z)
          const targetPitch = Math.asin(targetDirection.y)
          const maxTurn = turnSpeed * deltaSeconds
          const yawDifference = Math.atan2(Math.sin(targetYaw - shipYaw), Math.cos(targetYaw - shipYaw))
          shipYaw += Math.max(-maxTurn, Math.min(maxTurn, yawDifference))
          shipPitch += Math.max(-maxTurn, Math.min(maxTurn, targetPitch - shipPitch))
          velocity.addInPlace(
            targetDirection.scale((engineThrustNewtons / shipMassKg) * deltaSeconds),
          )
        }
      }
      if (movementIntent.lengthSquared() > 0) {
        const boostActive = pressedKeys.has('shift')
        const thrustMultiplier = boostActive ? 3 : 1
        fuelBurnRate += 0.012 * (boostActive ? 5 : 1)
        movementIntent.normalize()
        const acceleration = shipRight.scale(movementIntent.x)
          .addInPlace(Vector3.Up().scale(movementIntent.y))
          .addInPlace(shipForward.scale(movementIntent.z))
          .scaleInPlace((engineThrustNewtons / shipMassKg) * thrustMultiplier * deltaSeconds)
        velocity.addInPlace(acceleration)
      } else if (flightAssistEnabled && velocity.lengthSquared() > 0) {
        fuelBurnRate += 0.008
        const speed = velocity.length()
        velocity.scaleInPlace(Math.max(0, 1 - ((brakingThrustNewtons / shipMassKg) * deltaSeconds) / speed))
      }
      if (fuelBurnRate > 0 && fuelLiters > 0) {
        fuelLiters = Math.max(0, fuelLiters - fuelBurnRate * deltaSeconds)
        updateShipStatus()
      }
      if (velocity.length() > maximumSpeed) {
        velocity.normalize().scaleInPlace(maximumSpeed)
      }
      ship.position.addInPlace(velocity.scale(deltaSeconds))
    }
    resolveWorldCollisions()
    const miningTarget = activeModuleTargets.get('Mining Laser')
    const miningTargetDetails = miningTarget ? asteroidTargets.get(miningTarget.uniqueId) : undefined
    const miningLaserActive = Boolean(
      miningTarget
      && miningTargetDetails
      && activeModules.has('Mining Laser')
      && !isDestroyed
      && !warp
      && miningTargetDetails.oreRemainingCubicMeters > 0
      && Vector3.Distance(ship.position, miningTarget.getAbsolutePosition()) <= miningLaserRange,
    )
    miningLaserBeam.setEnabled(miningLaserActive)
    for (const renderable of renderableObjects) {
      renderable.mesh.isVisible = Vector3.Distance(ship.position, renderable.mesh.getAbsolutePosition()) <= renderable.rangeMeters
    }
    if (miningLaserActive !== miningLaserReportedActive || (miningLaserActive && miningTarget !== miningLaserReportedTarget)) {
      miningLaserReportedActive = miningLaserActive
      miningLaserReportedTarget = miningLaserActive ? miningTarget : undefined
      const miningBeamSource = miningLaserActive
        ? ship.position.add(shipForward.scale(2.5)).add(Vector3.Up().scale(0.35))
        : undefined
      options.onMiningLaserUpdate?.(
        miningLaserActive,
        miningBeamSource ? toWorldPosition(miningBeamSource) : undefined,
        miningTarget ? toWorldPosition(miningTarget.getAbsolutePosition()) : undefined,
      )
    }
    if (miningLaserActive && miningTarget && miningTargetDetails) {
      const targetPosition = miningTarget.getAbsolutePosition()
      const beamSource = ship.position.add(shipForward.scale(2.5)).add(Vector3.Up().scale(0.35))
      const beamDirection = targetPosition.subtract(beamSource).normalize()
      const impactNormal = beamDirection.scale(-1)
      const asteroidIntersection = scene.pickWithRay(new Ray(beamSource, beamDirection), (mesh) => mesh === miningTarget)
      const beamImpactPosition = asteroidIntersection?.pickedPoint
        ?? targetPosition.add(impactNormal.scale(miningTarget.getBoundingInfo().boundingSphere.radiusWorld))
      const beamSide = Vector3.Cross(beamDirection, Vector3.Up())
      if (beamSide.lengthSquared() < 0.001) beamSide.copyFrom(shipRight)
      else beamSide.normalize()
      const beamWobble = Math.min(0.35, Vector3.Distance(beamSource, beamImpactPosition) * 0.0015)
      const beamTime = now / 1000
      MeshBuilder.CreateTube('mining-laser-beam', {
        path: [
          beamSource,
          Vector3.Lerp(beamSource, beamImpactPosition, 0.33).addInPlace(beamSide.scale(Math.sin(beamTime * 13) * beamWobble)),
          Vector3.Lerp(beamSource, beamImpactPosition, 0.66).addInPlace(beamSide.scale(Math.sin(beamTime * 13 + Math.PI) * beamWobble)),
          beamImpactPosition,
        ],
        radius: 0.25,
        tessellation: 8,
        instance: miningLaserBeam,
      }, scene)
      nextMiningImpactSeconds -= deltaSeconds
      if (nextMiningImpactSeconds <= 0) {
        for (let index = 0; index < 3; index += 1) {
          const spark = MeshBuilder.CreateIcoSphere('mining-impact-spark', { radius: 0.18, subdivisions: 1 }, scene)
          spark.position.copyFrom(beamImpactPosition.add(impactNormal.scale(0.2)))
          spark.material = miningImpactMaterial
          glow.addIncludedOnlyMesh(spark)
          miningImpactSparks.push({
            mesh: spark,
            velocity: impactNormal.scale(1.5 + Math.random() * 2.5).addInPlace(new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)),
            ageSeconds: 0,
          })
        }
        nextMiningImpactSeconds = 0.12
      }
      nextOreChunkSeconds -= deltaSeconds
      if (nextOreChunkSeconds <= 0 && !miningExtractionPending && miningTargetDetails.asteroidId && options.onAsteroidExtraction) {
        miningExtractionPending = true
        void options.onAsteroidExtraction(miningTargetDetails.asteroidId, toWorldPosition(ship.position)).then((result) => {
          miningExtractionPending = false
          if (!result || result.asteroidId !== miningTargetDetails.asteroidId || miningTarget.isDisposed()) return
          const oreVolume = result.extractedOreCubicMeters
          miningTargetDetails.oreRemainingCubicMeters = result.remainingOreCubicMeters
          cargoCubicMeters = result.cargoCubicMeters
          miningTarget.scaling.copyFrom(miningTargetDetails.baseScaling.scale(Math.cbrt(result.remainingOreCubicMeters / miningTargetDetails.initialOreCubicMeters)))
          updateShipStatus()
          options.onInventoryChanged?.()
          if (oreVolume <= 0) return
        const oreChunk = MeshBuilder.CreateIcoSphere('mining-ore-chunk', { radius: 0.35, subdivisions: 2 }, scene)
        const oreMaterial = new StandardMaterial('mining-ore-chunk-material', scene)
        oreMaterial.diffuseColor = new Color3(0.54, 0.38, 0.14)
        oreMaterial.emissiveColor = new Color3(0.16, 0.09, 0.01)
        oreChunk.material = oreMaterial
        oreChunks.push({
          mesh: oreChunk,
          origin: beamImpactPosition,
          destination: beamSource,
          wobbleSide: beamSide,
          wobbleAmplitude: beamWobble,
          wobblePhase: Math.random() * Math.PI * 2,
          elapsedSeconds: 0,
          travelSeconds: 1.1,
          volumeCubicMeters: oreVolume,
        })
        nextOreChunkSeconds = 2 + Math.random() * 3
        if (miningTargetDetails.oreRemainingCubicMeters === 0) {
          setModuleActive('Mining Laser', false)
          asteroidTargets.delete(miningTarget.uniqueId)
          const collisionIndex = collisionTargets.findIndex((target) => target.mesh === miningTarget)
          if (collisionIndex >= 0) collisionTargets.splice(collisionIndex, 1)
          miningTarget.dispose()
          if (targetedAsteroid === miningTarget) clearTarget()
          unlockTarget(miningTarget)
        }
        }).catch(() => {
          miningExtractionPending = false
          nextOreChunkSeconds = 2
        })
      }
    }
    for (let index = oreChunks.length - 1; index >= 0; index -= 1) {
      const oreChunk = oreChunks[index]
      oreChunk.elapsedSeconds += deltaSeconds
      const progress = Math.min(1, oreChunk.elapsedSeconds / oreChunk.travelSeconds)
      Vector3.LerpToRef(oreChunk.origin, oreChunk.destination, progress, oreChunk.mesh.position)
      const wobble = Math.sin(progress * Math.PI * 3 + oreChunk.wobblePhase + now / 95) * oreChunk.wobbleAmplitude * Math.sin(progress * Math.PI)
      oreChunk.mesh.position.addInPlace(oreChunk.wobbleSide.scale(wobble))
      if (oreChunk.elapsedSeconds < oreChunk.travelSeconds) continue
      oreChunk.mesh.dispose()
      oreChunks.splice(index, 1)
    }
    for (let index = miningImpactSparks.length - 1; index >= 0; index -= 1) {
      const spark = miningImpactSparks[index]
      spark.ageSeconds += deltaSeconds
      spark.mesh.position.addInPlace(spark.velocity.scale(deltaSeconds))
      spark.mesh.scaling.setAll(Math.max(0, 1 - spark.ageSeconds / 0.35))
      if (spark.ageSeconds < 0.35) continue
      glow.removeIncludedOnlyMesh(spark.mesh)
      spark.mesh.dispose()
      miningImpactSparks.splice(index, 1)
    }
    for (let index = sensorPings.length - 1; index >= 0; index -= 1) {
      const ping = sensorPings[index]
      ping.ageSeconds += deltaSeconds
      const progress = Math.min(1, ping.ageSeconds / 1.4)
      ping.mesh.scaling.setAll(1 + progress * 3_000)
      ping.mesh.visibility = 1 - progress
      if (progress < 1) continue
      glow.removeIncludedOnlyMesh(ping.mesh)
      ping.mesh.dispose()
      sensorPings.splice(index, 1)
    }
    if (isDestroyed) {
      explosionAge += deltaSeconds
      explosion.scaling.setAll(1 + explosionAge * 18)
      explosionMaterial.alpha = Math.max(0, 1 - explosionAge / 1.2)
      if (explosionAge >= 2.5) respawnShip()
    }
    shieldImpactSeconds = Math.max(0, shieldImpactSeconds - deltaSeconds)
    shieldBubble.setEnabled(hasShieldGenerator && shieldImpactSeconds > 0 && !isDestroyed)
    if (shieldBubble.isEnabled()) {
      const impactVisibility = shieldImpactSeconds / 0.35
      shieldBubbleMaterial.alpha = 0.55 * impactVisibility
      shieldBubbleMaterial.emissiveColor.copyFromFloats(0.08 * impactVisibility, 0.65 * impactVisibility, impactVisibility)
      shieldBubble.scaling.setAll(1 + (1 - impactVisibility) * 0.18)
    }
    star.scaling.setAll(Math.max(minimumStarVisualScale, Math.min(1, starVisualScaleDistance / Vector3.Distance(ship.position, star.position))))
    ship.rotation.set(-shipPitch, shipYaw, shipRoll)
    strafeThrusterMaterials[0].emissiveColor.copyFromFloats(0, 0.85 * Number(pressedKeys.has('a')), Number(pressedKeys.has('a')))
    strafeThrusterMaterials[1].emissiveColor.copyFromFloats(0, 0.85 * Number(pressedKeys.has('d')), Number(pressedKeys.has('d')))
    camera.target.copyFrom(ship.position)
    if (targetedAsteroid && targetBrackets) {
      targetBrackets.setEnabled(lockingTarget?.asteroid !== targetedAsteroid || Math.floor(now / 130) % 2 === 0)
      targetBrackets.position.copyFrom(targetedAsteroid.getAbsolutePosition())
      targetBrackets.rotationQuaternion = camera.absoluteRotation.clone()
      targetBrackets.scaling.setAll(targetedAsteroid.getBoundingInfo().boundingSphere.radiusWorld * 1.35)
    }
    for (const [lockedTarget, brackets] of lockedTargets) {
      brackets.position.copyFrom(lockedTarget.getAbsolutePosition())
      brackets.rotationQuaternion = camera.absoluteRotation.clone()
      brackets.scaling.setAll(lockedTarget.getBoundingInfo().boundingSphere.radiusWorld * 1.35)
    }
    const actualSpeed = Vector3.Distance(ship.position, frameStartPosition) / deltaSeconds
    for (const [pilotId, remote] of remotePilots) {
      remote.destination.addInPlace(remote.velocity.scale(deltaSeconds))
      remote.ship.position = Vector3.Lerp(remote.ship.position, remote.destination, Math.min(1, deltaSeconds * 8))
      const distanceToRemote = Vector3.Distance(ship.position, remote.ship.position)
      remote.ship.setEnabled(
        !remote.docked
        && distanceToRemote <= remotePilotVisibilityRangeMeters,
      )
      const contactScale = Math.max(1, Math.min(1_000, distanceToRemote / 250))
      remote.contact.scaling.setAll(contactScale)
      remote.nameplate.scaling.setAll(contactScale)
      remote.ship.rotation.x += (-remote.pitch - remote.ship.rotation.x) * Math.min(1, deltaSeconds * 8)
      remote.ship.rotation.y += Math.atan2(Math.sin(remote.yaw - remote.ship.rotation.y), Math.cos(remote.yaw - remote.ship.rotation.y)) * Math.min(1, deltaSeconds * 8)
      remote.ship.rotation.z += (remote.roll - remote.ship.rotation.z) * Math.min(1, deltaSeconds * 8)
      remote.ship.computeWorldMatrix(true)
      remote.targetMesh.computeWorldMatrix(true)
      const hostileBrackets = hostileTargetBrackets.get(pilotId)
      if (hostileBrackets) {
        hostileBrackets.position.copyFrom(remote.targetMesh.getAbsolutePosition())
        hostileBrackets.rotationQuaternion = camera.absoluteRotation.clone()
        hostileBrackets.scaling.setAll(remote.targetMesh.getBoundingInfo().boundingSphere.radiusWorld * 1.35)
        hostileBrackets.setEnabled(Math.floor(now / 260) % 2 === 0)
      }
      if (remote.miningBeam?.isEnabled() && remote.miningTarget) {
        const beamSource = remote.targetMesh
          .getAbsolutePosition()
          .add(remote.targetMesh.getDirection(Vector3.Forward()).scale(2.5))
          .add(Vector3.Up().scale(0.35))
        remote.miningBeam = MeshBuilder.CreateTube(remote.miningBeam.name, { path: [beamSource, remote.miningTarget], radius: 0.2, tessellation: 8, instance: remote.miningBeam }, scene)
      }
    }
    const miningBeamSource = miningLaserActive ? ship.position.add(shipForward.scale(2.5)).add(Vector3.Up().scale(0.35)) : undefined
    options.onFlightUpdate(
      toWorldPosition(ship.position),
      actualSpeed,
      flightAssistEnabled,
      shipYaw,
      shipPitch,
      shipRoll,
      miningBeamSource ? toWorldPosition(miningBeamSource) : undefined,
      miningLaserActive && miningTarget ? toWorldPosition(miningTarget.getAbsolutePosition()) : undefined,
    )
    const isDockingAvailable = Vector3.Distance(ship.position, stationPosition) <= stationShieldRadius
    if (isDockingAvailable !== dockingAvailable) {
      dockingAvailable = isDockingAvailable
      options.onDockingAvailabilityChange?.(dockingAvailable)
    }
    scene.render()
  })

  const resizeObserver = new ResizeObserver(() => engine.resize())
  resizeObserver.observe(canvas)

  return {
    warpTo,
    toggleWarp,
    emitSensorPing,
    approachTarget: beginApproach,
    replaceAsteroids,
    replaceJettisonedItems,
    pickupJettisonedItem,
    setCargoCubicMeters,
    setPowerMegajoules(nextPowerMegajoules: number) {
      if (!Number.isFinite(nextPowerMegajoules)) return
      powerMegajoules = Math.max(0, Math.min(maximumPowerMegajoules, nextPowerMegajoules))
      updateShipStatus()
    },
    setMaximumSublightSpeedMetersPerSecond(speed: number) {
      maximumSpeed = Math.max(0, Math.min(speed, maximumSublightSpeedCapMetersPerSecond))
      if (velocity.length() > maximumSpeed) velocity.normalize().scaleInPlace(maximumSpeed)
    },
    setModuleActive,
    toggleTargetLock,
    clearTargetSelection,
    getTargetables,
    selectTarget,
    updateRemotePilot,
    removeRemotePilot,
    setRemotePilotMining,
    setRemotePilotActivity,
    setHostileTargeting,
    dispose() {
      resizeObserver.disconnect()
      if (document.pointerLockElement === canvas) document.exitPointerLock()
      canvas.removeEventListener('pointerdown', handleMouseDown, true)
      canvas.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('pointerup', handleMouseUp, true)
      canvas.removeEventListener('contextmenu', handleContextMenu)
      canvas.removeEventListener('click', handleClick)
      document.removeEventListener('pointerlockchange', handlePointerLockChange)
      scene.dispose()
      engine.dispose()
    },
  }
}

export function createStationInteriorScene(canvas: HTMLCanvasElement): SceneController {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, premultipliedAlpha: false })
  const scene = new Scene(engine)
  scene.clearColor.set(0, 0, 0, 0)

  const camera = new ArcRotateCamera('station-interior-camera', -Math.PI / 2, Math.PI / 2.35, 17, new Vector3(0, 1.2, -1), scene)
  camera.lowerRadiusLimit = 17
  camera.upperRadiusLimit = 17

  const light = new HemisphericLight('station-ambient-light', new Vector3(0, 1, 0), scene)
  light.intensity = 0.55
  const glow = new GlowLayer('station-glow', scene)
  glow.intensity = 0.65

  const hullMaterial = new StandardMaterial('station-hull-material', scene)
  hullMaterial.diffuseColor = new Color3(0.045, 0.075, 0.09)
  hullMaterial.specularColor = new Color3(0.08, 0.16, 0.2)
  const accentMaterial = new StandardMaterial('station-accent-material', scene)
  accentMaterial.diffuseColor = new Color3(0.04, 0.35, 0.42)
  accentMaterial.emissiveColor = new Color3(0, 0.17, 0.25)
  const dockingLightMaterial = new StandardMaterial('station-docking-light-material', scene)
  dockingLightMaterial.emissiveColor = new Color3(0.08, 0.95, 0.82)

  const dockedShip = new TransformNode('docked-starter-corvette', scene)
  dockedShip.position.set(0, 1.2, -1)
  const dockedHull = MeshBuilder.CreateBox('docked-starter-corvette-hull', { width: 2.8, height: 0.9, depth: 5.2 }, scene)
  dockedHull.parent = dockedShip
  const dockedShipMaterial = new StandardMaterial('docked-starter-corvette-material', scene)
  dockedShipMaterial.diffuseColor = new Color3(0.32, 0.045, 0.035)
  dockedShipMaterial.emissiveColor = new Color3(0.08, 0.006, 0.004)
  dockedHull.material = dockedShipMaterial
  const dockedNose = MeshBuilder.CreateCylinder('docked-starter-corvette-nose', {
    height: 2.8,
    diameterTop: 0.08,
    diameterBottom: 2.3,
    tessellation: 4,
  }, scene)
  dockedNose.parent = dockedShip
  dockedNose.position.z = 4
  dockedNose.rotation.x = Math.PI / 2
  dockedNose.material = dockedShipMaterial
  const dockedEngineMaterial = new StandardMaterial('docked-starter-corvette-engine-material', scene)
  dockedEngineMaterial.emissiveColor = new Color3(0.03, 0.28, 0.33)
  for (const engineX of [-0.8, 0.8]) {
    const dockedEngine = MeshBuilder.CreateCylinder('docked-starter-corvette-engine', {
      height: 1.05,
      diameterTop: 0.55,
      diameterBottom: 0.7,
      tessellation: 8,
    }, scene)
    dockedEngine.parent = dockedShip
    dockedEngine.position.set(engineX, 0, -3)
    dockedEngine.rotation.x = -Math.PI / 2
    dockedEngine.material = dockedEngineMaterial
  }

  engine.runRenderLoop(() => scene.render())
  const resizeObserver = new ResizeObserver(() => engine.resize())
  resizeObserver.observe(canvas)
  return {
    warpTo() {
      return false
    },
    setModuleActive() {},
    toggleTargetLock() {},
    dispose() {
      resizeObserver.disconnect()
      scene.dispose()
      engine.dispose()
    },
  }
}
