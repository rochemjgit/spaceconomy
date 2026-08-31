import {
  ArcRotateCamera,
  Color3,
  Engine,
  GlowLayer,
  HemisphericLight,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core'

export interface SceneController {
  dispose(): void
}

export function createSystemScene(canvas: HTMLCanvasElement): SceneController {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  const scene = new Scene(engine)
  scene.clearColor.set(0.008, 0.016, 0.043, 1)

  const camera = new ArcRotateCamera(
    'isometric-camera',
    -Math.PI / 4,
    Math.PI / 3,
    44,
    Vector3.Zero(),
    scene,
  )
  camera.lowerRadiusLimit = 18
  camera.upperRadiusLimit = 90
  camera.wheelDeltaPercentage = 0.015
  camera.attachControl(canvas, true)

  const light = new HemisphericLight('star-light', new Vector3(-0.4, 1, -0.2), scene)
  light.intensity = 1.15

  const glow = new GlowLayer('star-glow', scene)
  glow.intensity = 0.75

  const star = MeshBuilder.CreateSphere('primary-star', { diameter: 7, segments: 24 }, scene)
  const starMaterial = new StandardMaterial('primary-star-material', scene)
  starMaterial.emissiveColor = new Color3(1, 0.45, 0.08)
  starMaterial.diffuseColor = new Color3(0.7, 0.16, 0.02)
  star.material = starMaterial

  const planet = MeshBuilder.CreateSphere('starter-world', { diameter: 3.4, segments: 16 }, scene)
  planet.position = new Vector3(18, 2, -12)
  const planetMaterial = new StandardMaterial('starter-world-material', scene)
  planetMaterial.diffuseColor = new Color3(0.12, 0.34, 0.58)
  planetMaterial.specularColor = new Color3(0.08, 0.12, 0.2)
  planet.material = planetMaterial

  const station = MeshBuilder.CreateBox('station-marker', { size: 1.4 }, scene)
  station.position = new Vector3(13.5, 2.4, -8.8)
  const stationMaterial = new StandardMaterial('station-marker-material', scene)
  stationMaterial.emissiveColor = new Color3(0.08, 0.75, 0.92)
  station.material = stationMaterial

  const ship = MeshBuilder.CreatePolyhedron('starter-ship', { type: 1, size: 1.4 }, scene)
  ship.position = new Vector3(0, 0, 8)
  ship.rotation.z = Math.PI / 4
  const shipMaterial = new StandardMaterial('starter-ship-material', scene)
  shipMaterial.emissiveColor = new Color3(0.2, 0.85, 1)
  shipMaterial.diffuseColor = new Color3(0.06, 0.2, 0.35)
  ship.material = shipMaterial

  engine.runRenderLoop(() => scene.render())
  const resizeObserver = new ResizeObserver(() => engine.resize())
  resizeObserver.observe(canvas)

  return {
    dispose() {
      resizeObserver.disconnect()
      scene.dispose()
      engine.dispose()
    },
  }
}
