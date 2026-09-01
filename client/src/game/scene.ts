import {
  ArcRotateCamera,
  Color3,
  Engine,
  GlowLayer,
  HemisphericLight,
  Layer,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core'
import type { ArcRotateCameraPointersInput } from '@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput'

export interface SceneController {
  dispose(): void
}

export interface SceneOptions {
  onFlightUpdate: (position: Vector3, speed: number, flightAssistEnabled: boolean) => void
}

export function createSystemScene(canvas: HTMLCanvasElement, options: SceneOptions): SceneController {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  const scene = new Scene(engine)
  scene.clearColor.set(0.008, 0.016, 0.043, 1)
  const planetPosition = new Vector3(119_678, 0, 0)
  const stationPosition = planetPosition.add(new Vector3(3_400, 480, -3_400))
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
  star.position = Vector3.Zero()
  const starMaterial = new StandardMaterial('primary-star-material', scene)
  starMaterial.emissiveColor = new Color3(1, 0.45, 0.08)
  starMaterial.diffuseColor = new Color3(0.7, 0.16, 0.02)
  star.material = starMaterial
  const starVisualScaleDistance = 60_000
  const minimumStarVisualScale = 0.18

  const planet = MeshBuilder.CreateSphere('starter-world', { diameter: 6_000, segments: 32 }, scene)
  planet.position = planetPosition
  const planetMaterial = new StandardMaterial('starter-world-material', scene)
  planetMaterial.diffuseColor = new Color3(0.12, 0.34, 0.58)
  planetMaterial.specularColor = new Color3(0.08, 0.12, 0.2)
  planet.material = planetMaterial

  const stationMaterial = new StandardMaterial('station-marker-material', scene)
  stationMaterial.diffuseColor = new Color3(0.16, 0.4, 0.5)
  stationMaterial.emissiveColor = new Color3(0.02, 0.16, 0.22)
  const station = MeshBuilder.CreateTorus('station-marker', { diameter: 337.5, thickness: 24, tessellation: 32 }, scene)
  station.position = stationPosition
  station.material = stationMaterial

  const stationShield = MeshBuilder.CreateSphere('station-safe-zone', { diameter: 819, segments: 32 }, scene)
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

  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const spoke = MeshBuilder.CreateBox('station-spoke', { width: 10, height: 10, depth: 138.75 }, scene)
    spoke.position = stationPosition.add(new Vector3(Math.sin(angle) * 81.375, 0, Math.cos(angle) * 81.375))
    spoke.rotation.y = angle
    spoke.material = stationMaterial
  }

  const ship = new TransformNode('starter-ship', scene)
  ship.position = launchPosition.clone()
  const hull = MeshBuilder.CreateBox('starter-ship-hull', { width: 1.7, height: 0.6, depth: 3.2 }, scene)
  hull.parent = ship
  const shipMaterial = new StandardMaterial('starter-ship-material', scene)
  shipMaterial.emissiveColor = new Color3(0.04, 0.22, 0.32)
  shipMaterial.diffuseColor = new Color3(0.06, 0.2, 0.35)
  hull.material = shipMaterial

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
  let flightAssistEnabled = true
  const velocity = Vector3.Zero()
  const shipMassKg = 25_000
  const engineThrustNewtons = 550_000
  const brakingThrustNewtons = 200_000
  const maximumSpeed = 2_500
  let shipYaw = 0
  let shipPitch = 0
  let isSteering = false
  let pointerLockWasActive = false
  let steeringTargetYaw = 0
  let steeringTargetPitch = 0
  const turnSpeed = 2.8

  const handleMouseDown = (event: PointerEvent) => {
    if (event.button !== 2) return
    event.preventDefault()
    const rect = canvas.getBoundingClientRect()
    const ray = scene.createPickingRay(event.clientX - rect.left, event.clientY - rect.top, null, camera)
    const targetDirection = ray.direction.normalize()
    steeringTargetYaw = Math.atan2(targetDirection.x, targetDirection.z)
    steeringTargetPitch = Math.asin(targetDirection.y)
    canvas.setPointerCapture(event.pointerId)
    isSteering = true
    canvas.classList.add('is-steering')
    void Promise.resolve(canvas.requestPointerLock()).catch(() => undefined)
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
  canvas.addEventListener('pointerdown', handleMouseDown, true)
  window.addEventListener('pointerup', handleMouseUp, true)
  canvas.addEventListener('contextmenu', handleContextMenu)
  document.addEventListener('pointerlockchange', handlePointerLockChange)

  const handleKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase()
    if (key === 'f' && !event.repeat) {
      flightAssistEnabled = !flightAssistEnabled
    }
    if (['w', 'a', 's', 'd', ' ', 'c', 'f'].includes(key)) {
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
    if (isSteering) {
      const maxTurn = turnSpeed * deltaSeconds
      const yawDifference = Math.atan2(Math.sin(steeringTargetYaw - shipYaw), Math.cos(steeringTargetYaw - shipYaw))
      shipYaw += Math.max(-maxTurn, Math.min(maxTurn, yawDifference))
      const pitchDifference = steeringTargetPitch - shipPitch
      shipPitch += Math.max(-maxTurn, Math.min(maxTurn, pitchDifference))
    }
    if (movementIntent.lengthSquared() > 0) {
      movementIntent.normalize()
      const acceleration = shipRight.scale(movementIntent.x)
        .addInPlace(Vector3.Up().scale(movementIntent.y))
        .addInPlace(shipForward.scale(movementIntent.z))
        .scaleInPlace((engineThrustNewtons / shipMassKg) * deltaSeconds)
      velocity.addInPlace(acceleration)
    } else if (flightAssistEnabled && velocity.lengthSquared() > 0) {
      const speed = velocity.length()
      velocity.scaleInPlace(Math.max(0, 1 - ((brakingThrustNewtons / shipMassKg) * deltaSeconds) / speed))
    }
    if (velocity.length() > maximumSpeed) {
      velocity.normalize().scaleInPlace(maximumSpeed)
    }
    ship.position.addInPlace(velocity.scale(deltaSeconds))
    star.scaling.setAll(Math.max(minimumStarVisualScale, Math.min(1, starVisualScaleDistance / Vector3.Distance(ship.position, star.position))))
    ship.rotation.set(-shipPitch, shipYaw, 0)
    strafeThrusterMaterials[0].emissiveColor.copyFromFloats(0, 0.85 * Number(pressedKeys.has('a')), Number(pressedKeys.has('a')))
    strafeThrusterMaterials[1].emissiveColor.copyFromFloats(0, 0.85 * Number(pressedKeys.has('d')), Number(pressedKeys.has('d')))
    camera.target.copyFrom(ship.position)
    options.onFlightUpdate(ship.position, velocity.length(), flightAssistEnabled)
    scene.render()
  })

  const resizeObserver = new ResizeObserver(() => engine.resize())
  resizeObserver.observe(canvas)

  return {
    dispose() {
      resizeObserver.disconnect()
      if (document.pointerLockElement === canvas) document.exitPointerLock()
      canvas.removeEventListener('pointerdown', handleMouseDown, true)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('pointerup', handleMouseUp, true)
      canvas.removeEventListener('contextmenu', handleContextMenu)
      document.removeEventListener('pointerlockchange', handlePointerLockChange)
      scene.dispose()
      engine.dispose()
    },
  }
}
