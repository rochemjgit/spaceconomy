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
} from '@babylonjs/core'
import type { ArcRotateCameraPointersInput } from '@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput'

export interface SceneController {
  dispose(): void
  warpTo(destination: Vector3): boolean
  setModuleActive(moduleName: string, isActive: boolean): void
  toggleTargetLock(): void
  updateRemotePilot?(pilot: RemotePilot): void
  removeRemotePilot?(pilotId: string): void
  setRemotePilotMining?(pilotId: string, active: boolean, target: Vector3): void
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

export interface SceneOptions {
  onFlightUpdate: (position: Vector3, speed: number, flightAssistEnabled: boolean, yaw: number, pitch: number, roll: number) => void
  onDockingAvailabilityChange?: (isAvailable: boolean) => void
  onWarpUpdate?: (isWarping: boolean, phase: WarpPhase, progress: number) => void
  onTargetSelectionChange?: (target?: { name: string; kind: 'asteroid' | 'pilot'; shipType?: string; position: Vector3; oreRemainingCubicMeters: number; initialOreCubicMeters: number; locked: boolean; locking: boolean; lockProgress: number }) => void
  onShipStatusChange?: (status: ShipStatus) => void
  onModuleActiveChange?: (moduleName: string, isActive: boolean) => void
  onMiningLaserUpdate?: (active: boolean, target?: Vector3) => void
  onPilotTargetLockChange?: (pilotId: string, active: boolean) => void
  hasShieldGenerator?: boolean
  initialPosition?: Vector3
  initialShields?: number
  initialHull?: number
  initialFuelLiters?: number
  initialPowerMegajoules?: number
  initialCargoCubicMeters?: number
  initialLaunchSpeed?: number
  initialFlightAssistEnabled?: boolean
}

export interface StationInteriorOptions {
  onTerminalInteract?: () => void
}

export type WarpPhase = 'aligning' | 'accelerating' | 'warping' | 'cruising' | 'decelerating'

export interface ShipStatus {
  shields: number
  hull: number
  fuelLiters: number
  maximumFuelLiters: number
  powerMegajoules: number
  maximumPowerMegajoules: number
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
  name: string
  initialOreCubicMeters: number
  oreRemainingCubicMeters: number
  baseScaling: Vector3
}

interface TargetDescriptor {
  name: string
  kind: 'asteroid' | 'pilot'
  pilotId?: string
  shipType?: string
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
  const targetDescriptors = new Map<number, TargetDescriptor>()
  const registerCollisionTarget = (mesh: AbstractMesh, name: string, massKg: number, radius: number, fatal = false) => {
    collisionTargets.push({ mesh, name, massKg, radius, fatal })
  }
  const registerAsteroid = (mesh: AbstractMesh, name: string, radius: number, oreVolumeCubicMeters: number) => {
    const oreVolume = Math.max(0.5, oreVolumeCubicMeters)
    asteroidTargets.set(mesh.uniqueId, {
      name,
      initialOreCubicMeters: oreVolume,
      oreRemainingCubicMeters: oreVolume,
      baseScaling: mesh.scaling.clone(),
    })
    targetDescriptors.set(mesh.uniqueId, { name, kind: 'asteroid' })
    registerCollisionTarget(mesh, name, 4_000_000_000, radius * 1.3)
  }
  const planetPosition = new Vector3(119_678, 0, 0)
  const stationPosition = planetPosition.add(new Vector3(3_400, 480, -3_400))
  const asteroidBeltPosition = planetPosition.add(new Vector3(240_000, 0, 30_000))
  const vesperBeltPosition = new Vector3(-210_000, 0, 145_000)
  const nadirBeltPosition = new Vector3(85_000, 0, -295_000)
  const launchPosition = stationPosition.add(new Vector3(0, 0, 709.5))
  const renderUnitsPerMeter = 3 / 10
  const astronomicalVisualCompression = 300_000
  const physicalStarDiameterUnits = 1_393_000_000 * renderUnitsPerMeter
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
  starMaterial.emissiveColor = new Color3(1, 0.45, 0.08)
  starMaterial.diffuseColor = new Color3(0.7, 0.16, 0.02)
  star.material = starMaterial
  registerCollisionTarget(star, 'PRIMARY STAR', 1.989e30, starVisualDiameter / 2, true)
  const starVisualScaleDistance = 60_000
  const minimumStarVisualScale = 0.18

  const planet = MeshBuilder.CreateSphere('starter-world', { diameter: 6_000, segments: 32 }, scene)
  planet.position = planetPosition
  const planetMaterial = new StandardMaterial('starter-world-material', scene)
  planetMaterial.diffuseColor = new Color3(0.12, 0.34, 0.58)
  planetMaterial.specularColor = new Color3(0.08, 0.12, 0.2)
  planet.material = planetMaterial
  registerCollisionTarget(planet, 'STARTER WORLD', 5.972e24, 3_000, true)

  const asteroidBeltMaterial = new StandardMaterial('asterion-belt-marker-material', scene)
  asteroidBeltMaterial.diffuseColor = new Color3(0.38, 0.28, 0.17)
  asteroidBeltMaterial.emissiveColor = new Color3(0.05, 0.025, 0.008)
  const vesperBeltMaterial = new StandardMaterial('vesper-belt-marker-material', scene)
  vesperBeltMaterial.diffuseColor = new Color3(0.25, 0.34, 0.31)
  vesperBeltMaterial.emissiveColor = new Color3(0.008, 0.035, 0.028)
  const nadirBeltMaterial = new StandardMaterial('nadir-belt-marker-material', scene)
  nadirBeltMaterial.diffuseColor = new Color3(0.34, 0.2, 0.2)
  nadirBeltMaterial.emissiveColor = new Color3(0.045, 0.008, 0.01)
  const randomAsteroidValue = (index: number, salt: number) => {
    const value = Math.sin(index * 12.9898 + salt * 78.233) * 43_758.5453
    return value - Math.floor(value)
  }
  for (let index = 0; index < 72; index += 1) {
    const angle = randomAsteroidValue(index, 1) * Math.PI * 2
    const radius = 2_100 + randomAsteroidValue(index, 2) * 13_900
    const asteroidRadius = 75 + randomAsteroidValue(index, 3) * 225
    const asteroid = MeshBuilder.CreateIcoSphere(`asterion-belt-rock-${index}`, {
      radius: asteroidRadius,
      subdivisions: 1,
    }, scene)
    asteroid.position.set(
      asteroidBeltPosition.x + Math.cos(angle) * radius,
      asteroidBeltPosition.y + (randomAsteroidValue(index, 4) - 0.5) * 1_500,
      asteroidBeltPosition.z + Math.sin(angle) * radius,
    )
    asteroid.scaling.set(
      0.7 + randomAsteroidValue(index, 5) * 0.65,
      0.55 + randomAsteroidValue(index, 6) * 0.75,
      0.7 + randomAsteroidValue(index, 7) * 0.65,
    )
    asteroid.rotation.set(
      randomAsteroidValue(index, 8) * Math.PI,
      randomAsteroidValue(index, 9) * Math.PI,
      randomAsteroidValue(index, 10) * Math.PI,
    )
    asteroid.material = asteroidBeltMaterial
    registerAsteroid(asteroid, `ASTERION ROCK ${(index + 1).toString().padStart(2, '0')}`, asteroidRadius, Math.round(asteroidRadius / 25))
  }
  for (const [beltName, beltPosition, beltMaterial, salt] of [
    ['vesper', vesperBeltPosition, vesperBeltMaterial, 11],
    ['nadir', nadirBeltPosition, nadirBeltMaterial, 21],
  ] as const) {
    for (let index = 0; index < 54; index += 1) {
      const angle = randomAsteroidValue(index, salt) * Math.PI * 2
      const radius = 1_700 + randomAsteroidValue(index, salt + 1) * 10_800
      const asteroidRadius = 60 + randomAsteroidValue(index, salt + 2) * 190
      const asteroid = MeshBuilder.CreateIcoSphere(`${beltName}-belt-rock-${index}`, {
        radius: asteroidRadius,
        subdivisions: 1,
      }, scene)
      asteroid.position.set(
        beltPosition.x + Math.cos(angle) * radius,
        beltPosition.y + (randomAsteroidValue(index, salt + 3) - 0.5) * 1_200,
        beltPosition.z + Math.sin(angle) * radius,
      )
      asteroid.scaling.setAll(0.7 + randomAsteroidValue(index, salt + 4) * 0.6)
      asteroid.rotation.set(randomAsteroidValue(index, salt + 5) * Math.PI, randomAsteroidValue(index, salt + 6) * Math.PI, randomAsteroidValue(index, salt + 7) * Math.PI)
      asteroid.material = beltMaterial
      registerAsteroid(asteroid, `${beltName.toUpperCase()} ROCK ${(index + 1).toString().padStart(2, '0')}`, asteroidRadius, Math.round(asteroidRadius / 25))
    }
  }

  // Temporary close-range asteroid for validating targeting and mining.
  const starterTestAsteroid = MeshBuilder.CreateIcoSphere('starter-test-asteroid', { radius: 12, subdivisions: 2 }, scene)
  starterTestAsteroid.position = launchPosition.add(new Vector3(0, 16, 40))
  starterTestAsteroid.rotation.set(0.4, 0.8, 0.2)
  const starterTestAsteroidMaterial = new StandardMaterial('starter-test-asteroid-material', scene)
  starterTestAsteroidMaterial.diffuseColor = new Color3(0.45, 0.22, 0.04)
  starterTestAsteroidMaterial.emissiveColor = new Color3(0.25, 0.08, 0.005)
  starterTestAsteroid.material = starterTestAsteroidMaterial
  registerAsteroid(starterTestAsteroid, 'STARTER TEST ASTEROID', 12, 8)

  const secondStarterTestAsteroid = MeshBuilder.CreateIcoSphere('starter-test-asteroid-2', { radius: 10, subdivisions: 2 }, scene)
  secondStarterTestAsteroid.position = launchPosition.add(new Vector3(-34, -8, 58))
  secondStarterTestAsteroid.rotation.set(0.9, 0.2, 0.6)
  secondStarterTestAsteroid.material = starterTestAsteroidMaterial
  registerAsteroid(secondStarterTestAsteroid, 'STARTER TEST ASTEROID 02', 10, 6)

  const stationMaterial = new StandardMaterial('station-marker-material', scene)
  stationMaterial.diffuseColor = new Color3(0.16, 0.4, 0.5)
  stationMaterial.emissiveColor = new Color3(0.02, 0.16, 0.22)
  const station = MeshBuilder.CreateTorus('station-marker', { diameter: 337.5, thickness: 24, tessellation: 32 }, scene)
  station.position = stationPosition
  station.material = stationMaterial
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

  const stationHub = MeshBuilder.CreateCylinder('station-hub', { height: 36, diameter: 24, tessellation: 16 }, scene)
  stationHub.position = stationPosition
  stationHub.material = stationMaterial
  registerCollisionTarget(stationHub, 'KEPLER STATION HUB', 8_000_000_000, 18)

  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const spoke = MeshBuilder.CreateBox('station-spoke', { width: 10, height: 10, depth: 138.75 }, scene)
    spoke.position = stationPosition.add(new Vector3(Math.sin(angle) * 81.375, 0, Math.cos(angle) * 81.375))
    spoke.rotation.y = angle
    spoke.material = stationMaterial
    registerCollisionTarget(spoke, 'KEPLER STATION', 8_000_000_000, 75)
  }

  const ship = new TransformNode('starter-ship', scene)
  ship.position = options.initialPosition?.clone() ?? launchPosition.clone()
  const hull = MeshBuilder.CreateBox('starter-ship-hull', { width: 1.7, height: 0.6, depth: 3.2 }, scene)
  hull.parent = ship
  const shipMaterial = new StandardMaterial('starter-ship-material', scene)
  shipMaterial.emissiveColor = new Color3(0.32, 0.04, 0.04)
  shipMaterial.diffuseColor = new Color3(0.45, 0.03, 0.03)
  hull.material = shipMaterial
  const remotePilots = new Map<string, { ship: TransformNode; targetMesh: Mesh; destination: Vector3; yaw: number; pitch: number; roll: number; miningBeam?: Mesh; miningTarget?: Vector3 }>()
  const updateRemotePilot = (pilot: RemotePilot) => {
    let remote = remotePilots.get(pilot.pilotId)
    if (!remote) {
      const remoteShip = new TransformNode(`remote-pilot-${pilot.pilotId}`, scene)
      remoteShip.position.copyFrom(pilot.position)
      const remoteMaterial = new StandardMaterial(`remote-pilot-material-${pilot.pilotId}`, scene)
      remoteMaterial.diffuseColor = new Color3(0.04, 0.35, 0.55)
      remoteMaterial.emissiveColor = new Color3(0.02, 0.15, 0.32)
      const remoteHull = MeshBuilder.CreateBox(`remote-pilot-hull-${pilot.pilotId}`, { width: 1.7, height: 0.6, depth: 3.2 }, scene)
      remoteHull.material = remoteMaterial
      remoteHull.parent = remoteShip
      remoteHull.isPickable = true
      targetDescriptors.set(remoteHull.uniqueId, { name: pilot.displayName, kind: 'pilot', pilotId: pilot.pilotId, shipType: pilot.shipType })
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
      const nameplate = MeshBuilder.CreatePlane(`remote-pilot-nameplate-${pilot.pilotId}`, { width: 5, height: 0.75 }, scene)
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
      nameplate.position.y = 3
      nameplate.billboardMode = Mesh.BILLBOARDMODE_ALL
      nameplate.isPickable = false
      remoteShip.rotation.set(-pilot.pitch, pilot.yaw, pilot.roll)
      remote = { ship: remoteShip, targetMesh: remoteHull, destination: pilot.position.clone(), yaw: pilot.yaw, pitch: pilot.pitch, roll: pilot.roll }
      remotePilots.set(pilot.pilotId, remote)
    }
    remote.destination.copyFrom(pilot.position)
    remote.yaw = pilot.yaw
    remote.pitch = pilot.pitch
    remote.roll = pilot.roll
  }
  const removeRemotePilot = (pilotId: string) => {
    const remote = remotePilots.get(pilotId)
    remote?.miningBeam?.dispose()
    if (remote) targetDescriptors.delete(remote.targetMesh.uniqueId)
    remote?.ship.dispose(false, true)
    remotePilots.delete(pilotId)
  }
  const remoteMiningMaterial = new StandardMaterial('remote-mining-laser-material', scene)
  remoteMiningMaterial.emissiveColor = new Color3(0.05, 0.8, 1)
  remoteMiningMaterial.diffuseColor = new Color3(0.02, 0.3, 0.5)
  const setRemotePilotMining = (pilotId: string, active: boolean, target: Vector3) => {
    const remote = remotePilots.get(pilotId)
    if (!remote) return
    if (!active) {
      remote.miningBeam?.setEnabled(false)
      remote.miningTarget = undefined
      return
    }
    if (!remote.miningBeam) {
      remote.miningBeam = MeshBuilder.CreateTube(`remote-mining-laser-${pilotId}`, { path: [remote.ship.position, target], radius: 0.2, tessellation: 8 }, scene)
      remote.miningBeam.material = remoteMiningMaterial
      remote.miningBeam.isPickable = false
      glow.addIncludedOnlyMesh(remote.miningBeam)
    }
    remote.miningBeam.setEnabled(true)
    remote.miningTarget = target.clone()
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
  const maximumCargoCubicMeters = 24
  let shields = options.initialShields ?? maximumShields
  let hullIntegrity = options.initialHull ?? maximumHull
  let fuelLiters = options.initialFuelLiters ?? maximumFuelLiters
  let powerMegajoules = options.initialPowerMegajoules ?? maximumPowerMegajoules
  let cargoCubicMeters = options.initialCargoCubicMeters ?? 0
  let miningLaserReportedActive = false
  const activeModules = new Set<string>()
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

  const nose = MeshBuilder.CreateCylinder('starter-ship-nose', {
    height: 1.9,
    diameterTop: 0.08,
    diameterBottom: 1.45,
    tessellation: 4,
  }, scene)
  nose.parent = ship
  nose.position.z = 2.35
  nose.rotation.x = Math.PI / 2
  nose.material = shipMaterial

  const engineMaterial = new StandardMaterial('starter-ship-engine-material', scene)
  engineMaterial.emissiveColor = new Color3(0.1, 0.9, 1)
  engineMaterial.diffuseColor = new Color3(0.02, 0.1, 0.16)
  for (const engineX of [-0.52, 0.52]) {
    const engine = MeshBuilder.CreateCylinder('starter-ship-engine', {
      height: 0.85,
      diameterTop: 0.42,
      diameterBottom: 0.55,
      tessellation: 8,
    }, scene)
    engine.parent = ship
    engine.position.set(engineX, 0, -1.8)
    engine.rotation.x = -Math.PI / 2
    engine.material = engineMaterial
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
  const engineThrustNewtons = 550_000
  const brakingThrustNewtons = 200_000
  const maximumSpeed = 2_500
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
  const baseWarpCruiseSpeed = 37_500
  let dockingAvailable = false
  let postWarpCollisionImmunitySeconds = 0
  let warp: {
    origin: Vector3
    destination: Vector3
    cruiseOrigin: Vector3
    direction: Vector3
    targetYaw: number
    targetPitch: number
    phase: WarpPhase
    phaseElapsedSeconds: number
    cruiseDurationSeconds: number
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
    activeWarp.phase = nextPhase
    activeWarp.phaseElapsedSeconds = 0
    if (nextPhase === 'cruising') activeWarp.cruiseOrigin = ship.position.clone()
    if (nextPhase === 'decelerating') activeWarp.cruiseOrigin = ship.position.clone()
  }

  const warpTo = (destination: Vector3): boolean => {
    if (warp || Vector3.Distance(ship.position, destination) <= 100_000) return false
    const distance = Vector3.Distance(ship.position, destination)
    const direction = destination.subtract(ship.position).normalize()
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
      cruiseDurationSeconds: Math.max(3, Math.min(14, distance / baseWarpCruiseSpeed)),
    }
    options.onWarpUpdate?.(true, 'aligning', 0)
    return true
  }

  const setModuleActive = (moduleName: string, isActive: boolean) => {
    if (isActive) activeModules.add(moduleName)
    else activeModules.delete(moduleName)
    options.onModuleActiveChange?.(moduleName, isActive)
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
  let lockedAsteroid: AbstractMesh | undefined
  let lockingTarget: { asteroid: AbstractMesh; elapsedSeconds: number } | undefined
  let targetBrackets: TransformNode | undefined
  let lockedTargetBrackets: TransformNode | undefined
  const hostileTargetBrackets = new Map<string, TransformNode>()
  const miningLaserRange = 2_500
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
  const targetLockDurationSeconds = 1.5
  const clearTarget = () => {
    targetBrackets?.dispose()
    targetBrackets = undefined
    targetedAsteroid = undefined
  }
  const reportTargetLock = () => {
    const targetMesh = lockedAsteroid ?? lockingTarget?.asteroid ?? targetedAsteroid
    if (!targetMesh) {
      options.onTargetSelectionChange?.()
      return
    }
    const descriptor = targetDescriptors.get(targetMesh.uniqueId)
    if (!descriptor) return
    const asteroid = asteroidTargets.get(targetMesh.uniqueId)
    options.onTargetSelectionChange?.({
      name: descriptor.name,
      kind: descriptor.kind,
      shipType: descriptor.shipType,
      position: targetMesh.getAbsolutePosition().clone(),
      oreRemainingCubicMeters: asteroid?.oreRemainingCubicMeters ?? 0,
      initialOreCubicMeters: asteroid?.initialOreCubicMeters ?? 0,
      locked: lockedAsteroid !== undefined,
      locking: lockingTarget !== undefined,
      lockProgress: lockingTarget ? Math.min(1, lockingTarget.elapsedSeconds / targetLockDurationSeconds) : 1,
    })
  }
  const unlockTarget = () => {
    const targetPilotId = targetDescriptors.get((lockedAsteroid ?? lockingTarget?.asteroid)?.uniqueId ?? -1)?.pilotId
    if (targetPilotId) options.onPilotTargetLockChange?.(targetPilotId, false)
    lockedTargetBrackets?.dispose()
    lockedTargetBrackets = undefined
    lockedAsteroid = undefined
    lockingTarget = undefined
    reportTargetLock()
  }
  const toggleTargetLock = () => {
    if (lockedAsteroid) {
      unlockTarget()
      return
    }
    if (!targetedAsteroid) {
      if (lockingTarget) {
        lockingTarget = undefined
        reportTargetLock()
      }
      return
    }
    if (lockedAsteroid) return
    if (lockingTarget?.asteroid === targetedAsteroid) {
      unlockTarget()
      return
    }
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
    if (lockingTarget && lockingTarget.asteroid !== asteroid) {
      unlockTarget()
    }
    targetBrackets?.dispose()
    targetedAsteroid = asteroid
    targetBrackets = createTargetBrackets(new Color3(1, 0.72, 0.2), 'active')
  }
  const handleClick = (event: MouseEvent) => {
    if (event.button !== 0 || warp) return
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
    if (event.detail === 2 && !lockedAsteroid) toggleTargetLock()
  }
  canvas.addEventListener('pointerdown', handleMouseDown, true)
  canvas.addEventListener('pointermove', handlePointerMove, true)
  window.addEventListener('pointerup', handleMouseUp, true)
  canvas.addEventListener('contextmenu', handleContextMenu)
  canvas.addEventListener('click', handleClick)
  document.addEventListener('pointerlockchange', handlePointerLockChange)

  const handleKeyDown = (event: KeyboardEvent) => {
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
    const now = performance.now()
    const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05)
    lastFrameTime = now
    postWarpCollisionImmunitySeconds = Math.max(0, postWarpCollisionImmunitySeconds - deltaSeconds)
    if (lockingTarget) {
      lockingTarget.elapsedSeconds += deltaSeconds
      if (lockingTarget.elapsedSeconds >= targetLockDurationSeconds) {
        lockedAsteroid = lockingTarget.asteroid
        lockingTarget = undefined
        lockedTargetBrackets = createTargetBrackets(new Color3(0.72, 0.78, 0.82), 'locked')
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
        ship.position.addInPlace(velocity.scale(deltaSeconds))
      } else if (warp.phase === 'cruising') {
        const easedProgress = progress * progress * (3 - 2 * progress)
        Vector3.LerpToRef(warp.cruiseOrigin, warp.destination, easedProgress * 0.92, ship.position)
        velocity.copyFrom(warp.direction).scaleInPlace(100)
      } else if (warp.phase === 'decelerating') {
        const easedProgress = 1 - (1 - progress) * (1 - progress)
        Vector3.LerpToRef(warp.cruiseOrigin, warp.destination, easedProgress, ship.position)
        velocity.copyFrom(warp.direction).scaleInPlace(100 * (1 - progress))
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
    const miningTarget = lockedAsteroid ?? lockingTarget?.asteroid
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
    if (miningLaserActive !== miningLaserReportedActive) {
      miningLaserReportedActive = miningLaserActive
      options.onMiningLaserUpdate?.(miningLaserActive, miningTarget?.getAbsolutePosition())
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
      if (nextOreChunkSeconds <= 0 && cargoCubicMeters < maximumCargoCubicMeters) {
        const oreVolume = Math.min(0.5, miningTargetDetails.oreRemainingCubicMeters, maximumCargoCubicMeters - cargoCubicMeters)
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
        miningTargetDetails.oreRemainingCubicMeters = Math.max(0, miningTargetDetails.oreRemainingCubicMeters - oreVolume)
        const remainingFraction = miningTargetDetails.oreRemainingCubicMeters / miningTargetDetails.initialOreCubicMeters
        miningTarget.scaling.copyFrom(miningTargetDetails.baseScaling.scale(Math.cbrt(remainingFraction)))
        nextOreChunkSeconds = 2 + Math.random() * 3
        if (miningTargetDetails.oreRemainingCubicMeters === 0) {
          setModuleActive('Mining Laser', false)
          asteroidTargets.delete(miningTarget.uniqueId)
          const collisionIndex = collisionTargets.findIndex((target) => target.mesh === miningTarget)
          if (collisionIndex >= 0) collisionTargets.splice(collisionIndex, 1)
          miningTarget.dispose()
          if (targetedAsteroid === miningTarget) clearTarget()
          unlockTarget()
        }
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
      cargoCubicMeters = Math.min(maximumCargoCubicMeters, cargoCubicMeters + oreChunk.volumeCubicMeters)
      oreChunk.mesh.dispose()
      oreChunks.splice(index, 1)
      updateShipStatus()
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
      targetBrackets.setEnabled(!lockingTarget || Math.floor(now / 130) % 2 === 0)
      targetBrackets.position.copyFrom(targetedAsteroid.getAbsolutePosition())
      targetBrackets.rotationQuaternion = camera.absoluteRotation.clone()
      targetBrackets.scaling.setAll(targetedAsteroid.getBoundingInfo().boundingSphere.radiusWorld * 1.35)
    }
    if (lockedAsteroid && lockedTargetBrackets) {
      lockedTargetBrackets.position.copyFrom(lockedAsteroid.getAbsolutePosition())
      lockedTargetBrackets.rotationQuaternion = camera.absoluteRotation.clone()
      lockedTargetBrackets.scaling.setAll(lockedAsteroid.getBoundingInfo().boundingSphere.radiusWorld * 1.35)
    }
    const actualSpeed = Vector3.Distance(ship.position, frameStartPosition) / deltaSeconds
    for (const [pilotId, remote] of remotePilots) {
      remote.ship.position = Vector3.Lerp(remote.ship.position, remote.destination, Math.min(1, deltaSeconds * 8))
      remote.ship.rotation.x += (-remote.pitch - remote.ship.rotation.x) * Math.min(1, deltaSeconds * 8)
      remote.ship.rotation.y += Math.atan2(Math.sin(remote.yaw - remote.ship.rotation.y), Math.cos(remote.yaw - remote.ship.rotation.y)) * Math.min(1, deltaSeconds * 8)
      remote.ship.rotation.z += (remote.roll - remote.ship.rotation.z) * Math.min(1, deltaSeconds * 8)
      const hostileBrackets = hostileTargetBrackets.get(pilotId)
      if (hostileBrackets) {
        hostileBrackets.position.copyFrom(remote.targetMesh.getAbsolutePosition())
        hostileBrackets.rotationQuaternion = camera.absoluteRotation.clone()
        hostileBrackets.scaling.setAll(remote.targetMesh.getBoundingInfo().boundingSphere.radiusWorld * 1.35)
        hostileBrackets.setEnabled(Math.floor(now / 260) % 2 === 0)
      }
      if (remote.miningBeam?.isEnabled() && remote.miningTarget) {
        const beamSource = remote.ship.position.add(remote.ship.getDirection(Vector3.Forward()).scale(2.5)).add(Vector3.Up().scale(0.35))
        MeshBuilder.CreateTube(remote.miningBeam.name, { path: [beamSource, remote.miningTarget], radius: 0.2, tessellation: 8, instance: remote.miningBeam }, scene)
      }
    }
    options.onFlightUpdate(ship.position, actualSpeed, flightAssistEnabled, shipYaw, shipPitch, shipRoll)
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
    setModuleActive,
    toggleTargetLock,
    updateRemotePilot,
    removeRemotePilot,
    setRemotePilotMining,
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

export function createStationInteriorScene(canvas: HTMLCanvasElement, options: StationInteriorOptions = {}): SceneController {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  const scene = new Scene(engine)
  scene.clearColor.set(0.008, 0.012, 0.018, 1)

  const camera = new ArcRotateCamera('station-interior-camera', -Math.PI / 2, Math.PI / 2.65, 29, new Vector3(0, 5, 2), scene)
  camera.lowerRadiusLimit = 13
  camera.upperRadiusLimit = 42
  camera.wheelDeltaPercentage = 0.015
  camera.attachControl(canvas, true)

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

  const deck = MeshBuilder.CreateBox('station-deck', { width: 30, height: 1, depth: 42 }, scene)
  deck.position.y = -0.5
  deck.material = hullMaterial
  const ceiling = MeshBuilder.CreateBox('station-ceiling', { width: 30, height: 1, depth: 42 }, scene)
  ceiling.position.y = 13
  ceiling.material = hullMaterial
  for (const side of [-1, 1]) {
    const wall = MeshBuilder.CreateBox('station-wall', { width: 1, height: 14, depth: 42 }, scene)
    wall.position.set(side * 15, 6.5, 0)
    wall.material = hullMaterial
  }

  for (const z of [-15, -5, 5, 15]) {
    const bayLight = MeshBuilder.CreateBox('station-guide-light', { width: 0.35, height: 0.08, depth: 5 }, scene)
    bayLight.position.set(-5.5, 0.05, z)
    bayLight.material = dockingLightMaterial
    const mirroredBayLight = bayLight.clone('station-guide-light-mirrored')
    mirroredBayLight.position.x = 5.5
  }
  const landingPad = MeshBuilder.CreateCylinder('station-landing-pad', { diameter: 12, height: 0.3, tessellation: 32 }, scene)
  landingPad.position.y = 0.16
  landingPad.material = accentMaterial
  const padCore = MeshBuilder.CreateCylinder('station-landing-pad-core', { diameter: 7, height: 0.34, tessellation: 32 }, scene)
  padCore.position.y = 0.33
  padCore.material = hullMaterial

  const dockedShip = new TransformNode('docked-starter-corvette', scene)
  dockedShip.position.set(0, 1.1, -1)
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

  const terminalBase = MeshBuilder.CreateBox('station-services-terminal-base', { width: 2.4, height: 3.5, depth: 1.5 }, scene)
  terminalBase.position.set(-9.5, 1.75, 5)
  terminalBase.material = hullMaterial
  const terminalDisplay = MeshBuilder.CreateBox('station-services-terminal-display', { width: 1.85, height: 1.25, depth: 0.12 }, scene)
  terminalDisplay.position.set(-9.5, 3.1, 4.2)
  terminalDisplay.rotation.x = Math.PI / 10
  terminalDisplay.material = dockingLightMaterial
  const terminalBeacon = MeshBuilder.CreateCylinder('station-services-terminal-beacon', { height: 0.25, diameter: 0.48, tessellation: 12 }, scene)
  terminalBeacon.position.set(-9.5, 3.65, 5)
  terminalBeacon.material = dockingLightMaterial

  const airlock = MeshBuilder.CreateBox('station-airlock', { width: 10, height: 10, depth: 1 }, scene)
  airlock.position.set(0, 5, 20)
  airlock.material = accentMaterial
  const airlockFrame = MeshBuilder.CreateTorus('station-airlock-frame', { diameter: 11, thickness: 0.45, tessellation: 32 }, scene)
  airlockFrame.position.set(0, 5, 19.4)
  airlockFrame.rotation.x = Math.PI / 2
  airlockFrame.material = dockingLightMaterial

  const handleTerminalClick = (event: MouseEvent) => {
    if (event.button !== 0) return
    const rect = canvas.getBoundingClientRect()
    const picked = scene.pick(event.clientX - rect.left, event.clientY - rect.top)
    if (picked?.hit && picked.pickedMesh?.name.startsWith('station-services-terminal')) options.onTerminalInteract?.()
  }
  canvas.addEventListener('click', handleTerminalClick)

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
      canvas.removeEventListener('click', handleTerminalClick)
      scene.dispose()
      engine.dispose()
    },
  }
}
