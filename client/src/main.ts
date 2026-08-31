import './style.css'
import { createSystemScene } from './game/scene'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Application root was not found.')
}

app.innerHTML = `
  <main class="game-shell">
    <canvas id="game-canvas" aria-label="Spaceconomy game world"></canvas>
    <header class="topbar">
      <div class="brand"><span class="brand-mark">◈</span> SPACECONOMY</div>
      <div class="status"><span class="status-dot"></span> LOCAL SYSTEM · PROTOTYPE</div>
    </header>
    <section class="hud hud-left" aria-label="Ship status">
      <p class="eyebrow">STARTER CORVETTE</p>
      <p class="speed">0 <span>m/s</span></p>
      <p class="muted">Flight assist <strong>ON</strong></p>
    </section>
    <section class="hud hud-right" aria-label="Navigation status">
      <p class="eyebrow">KNOWN DESTINATIONS</p>
      <p>Kepler Station <span class="distance">12.4 AU</span></p>
      <button type="button" disabled>WARP UNAVAILABLE</button>
    </section>
    <footer class="controls">WASD <span>thrust</span> · QE <span>vertical</span> · MOUSE <span>rotate camera</span></footer>
  </main>
`

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
if (!canvas) {
  throw new Error('Game canvas was not found.')
}

const scene = createSystemScene(canvas)
window.addEventListener('beforeunload', () => scene.dispose(), { once: true })
