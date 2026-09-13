/*
import './admin.css'

const apiBaseUrl = 'http://127.0.0.1:8000/api/v1'
const form = document.querySelector<HTMLFormElement>('#foundry-test-form')
const submit = document.querySelector<HTMLButtonElement>('#foundry-test-submit')
const output = document.querySelector<HTMLOutputElement>('#foundry-test-output')
const feedback = document.querySelector<HTMLElement>('#foundry-test-feedback')
const model = document.querySelector<HTMLElement>('#foundry-model')
const streamStatus = document.querySelector<HTMLElement>('#stream-status')

async function loadConfiguration() {
  if (!model) return
  try {
    const response = await fetch(`${apiBaseUrl}/admin/configuration`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const configuration = await response.json() as { llm_model?: string }
    model.textContent = configuration.llm_model ?? 'Configured model unavailable'
  } catch {
    model.textContent = 'Configuration unavailable'
  }
}

async function streamFoundryTest() {
  if (!form || !submit || !output || !feedback || !streamStatus) return
  const values = new FormData(form)
  const prompt = String(values.get('prompt') ?? '').trim()
  if (!prompt) return
  submit.disabled = true
  output.value = ''
  output.textContent = ''
  feedback.textContent = 'Connecting to Azure Foundry...'
  streamStatus.textContent = 'Streaming'
  try {
    const response = await fetch(`${apiBaseUrl}/admin/llm/foundry/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        system_instruction: String(values.get('system_instruction') ?? ''),
        temperature: Number(values.get('temperature')),
        max_tokens: Number(values.get('max_tokens')),
      }),
    })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    feedback.textContent = 'Receiving response...'
    while (true) {
      const { done, value } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        const event = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
        const content = event.choices?.[0]?.delta?.content
        if (content) output.value += content
      }
      output.textContent = output.value
      if (done) break
    }
    feedback.textContent = 'Foundry response complete.'
    streamStatus.textContent = 'Complete'
  } catch (error) {
    feedback.textContent = `Foundry test failed: ${error instanceof Error ? error.message : 'Network error'}.`
    streamStatus.textContent = 'Failed'
  } finally {
    submit.disabled = false
  }
}

form?.addEventListener('submit', (event) => {
  event.preventDefault()
  void streamFoundryTest()
})

void loadConfiguration()
*/
/*
import './admin.css'

/*
type AdminConfiguration = {
  simulation_tick_hz: number
  snapshot_tick_hz: number
  asteroid_spawn_interval_seconds: number
  asteroid_field_maximum_active_asteroids: number
  refinery_tick_seconds: number
  llm_provider: 'ollama' | 'azure_foundry'
  llm_model: string
  ollama_model: string
  ollama_timeout_seconds: number
}

const apiBaseUrl = 'http://127.0.0.1:8000/api/v1'
const app = document.querySelector<HTMLDivElement>('#app')

if (!app) throw new Error('Application root was not found.')

const fields: { key: keyof AdminConfiguration; label: string; step?: string; type?: 'number' | 'text' }[] = [
  { key: 'simulation_tick_hz', label: 'Simulation tick rate', step: '1' },
  { key: 'snapshot_tick_hz', label: 'Snapshot tick rate', step: '1' },
  { key: 'asteroid_spawn_interval_seconds', label: 'Asteroid spawn interval', step: '1' },
  { key: 'asteroid_field_maximum_active_asteroids', label: 'Maximum active asteroids', step: '1' },
  { key: 'refinery_tick_seconds', label: 'Refinery worker interval', step: '0.1' },
  { key: 'ollama_model', label: 'Ollama model', type: 'text' },
  { key: 'ollama_timeout_seconds', label: 'Ollama timeout', step: '0.1' },
]

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!)
}

function render(configuration: AdminConfiguration) {
  app.innerHTML = `
    <main class="admin-page">
      <header class="admin-header"><a class="brand" href="/">SPACECONOMY</a><p>System administration</p></header>
      <section class="admin-intro"><p class="eyebrow">Operations console</p><h1>System Settings</h1><p>Runtime controls for world simulation, production cadence, and language-model services.</p></section>
      <form id="admin-settings-form" class="settings-panel">
        <section><p class="eyebrow">World simulation</p><div class="settings-grid">${fields.slice(0, 5).map(renderField).join('')}</div></section>
        <section><p class="eyebrow">Language model</p><div class="settings-grid"><label>Provider<select name="llm_provider"><option value="ollama"${configuration.llm_provider === 'ollama' ? ' selected' : ''}>Ollama</option><option value="azure_foundry"${configuration.llm_provider === 'azure_foundry' ? ' selected' : ''}>Azure Foundry</option></select></label><label>Active model<input name="llm_model" type="text" value="${escapeHtml(configuration.llm_model)}" required></label>${fields.slice(5).map(renderField).join('')}</div></section>
        <footer class="settings-actions"><p id="admin-settings-feedback" role="status"></p><button id="admin-settings-reload" type="button">Reload</button><button id="admin-settings-save" class="primary" type="submit">Save settings</button></footer>
      </form>
      <section class="foundry-panel" aria-labelledby="foundry-title"><div><p class="eyebrow">Inference check</p><h2 id="foundry-title">Azure Foundry</h2></div><form id="foundry-test-form"><label>System instruction<textarea name="system_instruction" maxlength="4000" placeholder="You are a cautious independent prospector."></textarea></label><label>Prompt<textarea name="prompt" required maxlength="8000" placeholder="Assess the risk of mining this asteroid field."></textarea></label><div class="test-options"><label>Temperature<input name="temperature" type="number" min="0" max="2" step="0.1" value="0.7" required></label><label>Max tokens<input name="max_tokens" type="number" min="1" max="1024" step="1" value="256" required></label></div><footer><p id="foundry-test-feedback" role="status"></p><button id="foundry-test-submit" class="primary" type="submit">Run test</button></footer><output id="foundry-test-output" aria-live="polite"></output></form></section>
    </main>`

  function renderField({ key, label, step, type = 'number' }: typeof fields[number]) {
    const value = configuration[key]
    return `<label>${label}<input name="${key}" type="${type}" value="${escapeHtml(String(value))}"${step ? ` step="${step}" min="0"` : ''} required></label>`
  }

  document.querySelector<HTMLButtonElement>('#admin-settings-reload')?.addEventListener('click', () => void loadConfiguration())
  document.querySelector<HTMLFormElement>('#admin-settings-form')?.addEventListener('submit', (event) => { event.preventDefault(); void saveConfiguration(configuration) })
  document.querySelector<HTMLFormElement>('#foundry-test-form')?.addEventListener('submit', (event) => { event.preventDefault(); void streamFoundryTest() })
}

async function loadConfiguration() {
  app.innerHTML = '<main class="admin-page"><p class="loading">Loading system configuration...</p></main>'
  try {
    const response = await fetch(`${apiBaseUrl}/admin/configuration`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    render(await response.json() as AdminConfiguration)
  } catch (error) {
    app.innerHTML = `<main class="admin-page"><p class="error">Unable to load system settings: ${error instanceof Error ? error.message : 'Network error'}.</p><button id="admin-settings-retry" type="button">Retry</button></main>`
    document.querySelector<HTMLButtonElement>('#admin-settings-retry')?.addEventListener('click', () => void loadConfiguration())
  }
}

async function saveConfiguration(configuration: AdminConfiguration) {
  const form = document.querySelector<HTMLFormElement>('#admin-settings-form')
  const feedback = document.querySelector<HTMLElement>('#admin-settings-feedback')
  const save = document.querySelector<HTMLButtonElement>('#admin-settings-save')
  if (!form || !feedback || !save) return
  const values = new FormData(form)
  const payload = Object.fromEntries(Object.entries(configuration).map(([key, value]) => [key, typeof value === 'number' ? Number(values.get(key)) : values.get(key)]))
  save.disabled = true
  feedback.textContent = 'Saving settings...'
  try {
    const response = await fetch(`${apiBaseUrl}/admin/configuration`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    feedback.textContent = 'Settings saved.'
  } catch (error) {
    feedback.textContent = `Unable to save settings: ${error instanceof Error ? error.message : 'Network error'}.`
  } finally {
    save.disabled = false
  }
}

async function streamFoundryTest() {
  const form = document.querySelector<HTMLFormElement>('#foundry-test-form')
  const submit = document.querySelector<HTMLButtonElement>('#foundry-test-submit')
  const output = document.querySelector<HTMLOutputElement>('#foundry-test-output')
  const feedback = document.querySelector<HTMLElement>('#foundry-test-feedback')
  if (!form || !submit || !output || !feedback) return
  const values = new FormData(form)
  submit.disabled = true
  output.value = ''
  feedback.textContent = 'Connecting to Azure Foundry...'
  try {
    const response = await fetch(`${apiBaseUrl}/admin/llm/foundry/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: values.get('prompt'), system_instruction: values.get('system_instruction'), temperature: Number(values.get('temperature')), max_tokens: Number(values.get('max_tokens')) }) })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    while (true) {
      const { done, value } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ') || line.slice(6).trim() === '[DONE]') continue
        const event = JSON.parse(line.slice(6)) as { choices?: { delta?: { content?: string } }[] }
        output.value += event.choices?.[0]?.delta?.content ?? ''
      }
      output.textContent = output.value
      if (done) break
    }
    feedback.textContent = 'Foundry response complete.'
  } catch (error) {
    feedback.textContent = `Foundry test failed: ${error instanceof Error ? error.message : 'Network error'}.`
  } finally {
    submit.disabled = false
  }
}

void loadConfiguration()
*/
import './admin.css'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Application root was not found.')
}
const appRoot = app

const apiBaseUrl = 'http://127.0.0.1:8000/api/v1/admin'

type RuntimeConfiguration = {
  simulation_tick_hz: number
  snapshot_tick_hz: number
  asteroid_spawn_interval_seconds: number
  asteroid_field_maximum_active_asteroids: number
  refinery_tick_seconds: number
  ollama_model: string
  ollama_timeout_seconds: number
}

type Npc = {
  pilot_id: string
  display_name: string
  archetype_key: string
  backstory: string
  motivations: string[]
  capabilities: string[]
  lifecycle_state: 'active' | 'paused' | 'retired'
  behavior_state: string
}

let configuration: RuntimeConfiguration | null = null
let npcs: Npc[] = []
let selectedNpcId: string | null = null
let foundryTestResult = ''
type MarketAdmin = { orders: { id: string; side: string; owner: string; station: string; system: string; definition_id: string; quantity: number; unit_price_credits: number; state: string; expires_at: string }[]; ledger: { created_at: string; pilot: string; transaction_kind: string; amount_credits: number }[] }
let marketAdmin: MarketAdmin = { orders: [], ledger: [] }
type RefineryAdmin = { jobs: { id: string; pilot: string; refinery_name: string; stage: string; state: string; queue_sequence: number; quoted_duration_seconds: number; quoted_efficiency: number; quoted_fee_credits: number; started_at: string | null; completes_at: string | null; completed_at: string | null; failure_reason: string | null }[] }
let refineryAdmin: RefineryAdmin = { jobs: [] }
type DashboardView = 'settings' | 'npc' | 'market' | 'refining'
let activeDashboardView: DashboardView = location.hash === '#market' ? 'market' : location.hash === '#refining' ? 'refining' : location.hash === '#npc' ? 'npc' : 'settings'

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character] ?? character)
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string }
    throw new Error(body.detail ?? `Request failed with ${response.status}`)
  }
  return response.json() as Promise<T>
}

function setStatus(message: string, tone: 'success' | 'error' | 'neutral' = 'neutral') {
  const status = document.querySelector<HTMLElement>('#admin-status')
  if (!status) return
  status.textContent = message
  status.dataset.tone = tone
}

function selectedNpc(): Npc | undefined {
  return npcs.find((npc) => npc.pilot_id === selectedNpcId)
}

function configurationMarkup(): string {
  if (!configuration) return '<p class="loading">Loading runtime controls...</p>'
  return `
    <form id="configuration-form" class="configuration-grid">
      <label>SIMULATION TICK <input name="simulation_tick_hz" type="number" min="1" max="60" value="${configuration.simulation_tick_hz}"></label>
      <label>SNAPSHOT TICK <input name="snapshot_tick_hz" type="number" min="1" max="60" value="${configuration.snapshot_tick_hz}"></label>
      <label>ASTEROID RESPAWN <input name="asteroid_spawn_interval_seconds" type="number" min="10" max="3600" value="${configuration.asteroid_spawn_interval_seconds}"></label>
      <label>FIELD ASTEROID LIMIT <input name="asteroid_field_maximum_active_asteroids" type="number" min="1" max="500" value="${configuration.asteroid_field_maximum_active_asteroids}"></label>
      <label>REFINERY INTERVAL <input name="refinery_tick_seconds" type="number" min="0.1" max="60" step="0.1" value="${configuration.refinery_tick_seconds}"></label>
      <label>OLLAMA MODEL <input name="ollama_model" maxlength="128" value="${escapeHtml(configuration.ollama_model)}"></label>
      <label>OLLAMA TIMEOUT <input name="ollama_timeout_seconds" type="number" min="1" max="300" value="${configuration.ollama_timeout_seconds}"></label>
      <div class="form-actions"><button type="submit">SAVE RUNTIME CONFIGURATION</button></div>
    </form>
  `
}

function foundryTestMarkup(): string {
  return `
    <form id="foundry-test-form" class="npc-form foundry-test-form">
      <label>SYSTEM INSTRUCTION <textarea name="system_instruction" maxlength="4000">you are a helpful ai</textarea></label>
      <label>PROMPT <textarea name="prompt" maxlength="8000" required placeholder="Assess the risk of mining this asteroid field."></textarea></label>
      <div class="test-options"><label>TEMPERATURE <input name="temperature" type="number" min="0" max="2" step="0.1" value="0.7" required></label><label>MAX TOKENS <input name="max_tokens" type="number" min="1" max="1024" value="256" required></label></div>
      <div class="form-actions"><button id="run-foundry-test" type="submit">RUN FOUNDRY TEST</button></div>
    </form>
    <pre id="foundry-test-output" class="llm-test-output" aria-live="polite">${escapeHtml(foundryTestResult)}</pre>
  `
}

function marketMarkup(): string {
  const orders = marketAdmin.orders.map((order) => `<tr><td>${escapeHtml(order.side)}</td><td>${escapeHtml(order.definition_id)}</td><td>${escapeHtml(order.owner)}</td><td>${order.quantity}</td><td>${order.unit_price_credits.toLocaleString()} CR</td><td>${escapeHtml(order.station)}</td><td>${escapeHtml(order.system)}</td><td>${escapeHtml(order.state)}</td><td>${new Date(order.expires_at).toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="9">No matching orders.</td></tr>'
  const ledger = marketAdmin.ledger.map((entry) => `<tr><td>${new Date(entry.created_at).toLocaleString()}</td><td>${escapeHtml(entry.pilot)}</td><td>${escapeHtml(entry.transaction_kind)}</td><td>${entry.amount_credits.toLocaleString()} CR</td></tr>`).join('') || '<tr><td colspan="4">No market ledger activity.</td></tr>'
  return `<form id="market-filter-form" class="market-admin-filters"><label>ITEM <input name="item" placeholder="iron, laser"></label><label>STATION <select name="station"><option value="">ALL</option><option value="kepler">KEPLER</option></select></label><label>SYSTEM <select name="system"><option value="">ALL</option><option value="kepler">KEPLER</option></select></label><label>SIDE <select name="side"><option value="">ALL</option><option value="buy">BUY</option><option value="sell">SELL</option></select></label><label>STATE <input name="state" placeholder="active, sold"></label><button type="submit">APPLY FILTERS</button></form><div class="market-admin-table"><h3>Current Orders</h3><table><thead><tr><th>Side</th><th>Item</th><th>Owner</th><th>Qty</th><th>Price</th><th>Station</th><th>System</th><th>State</th><th>Expires</th></tr></thead><tbody>${orders}</tbody></table></div><div class="market-admin-table"><h3>Market Ledger</h3><table><thead><tr><th>Time</th><th>Pilot</th><th>Event</th><th>Credits</th></tr></thead><tbody>${ledger}</tbody></table></div>`
}

function refineryMarkup(): string {
  const jobs = refineryAdmin.jobs.map((job) => `<tr><td>${escapeHtml(job.pilot)}</td><td>${escapeHtml(job.refinery_name)}</td><td>${escapeHtml(job.stage)}</td><td>${escapeHtml(job.state)}</td><td>${job.queue_sequence + 1}</td><td>${job.quoted_duration_seconds.toFixed(0)} s</td><td>${(job.quoted_efficiency * 100).toFixed(0)}%</td><td>${job.quoted_fee_credits.toLocaleString()} CR</td><td>${job.completes_at ? new Date(job.completes_at).toLocaleString() : job.completed_at ? new Date(job.completed_at).toLocaleString() : 'Waiting'}</td><td>${escapeHtml(job.failure_reason ?? '-')}</td></tr>`).join('') || '<tr><td colspan="10">No matching refinery jobs.</td></tr>'
  return `<form id="refinery-filter-form" class="market-admin-filters"><label>PILOT <input name="pilot" placeholder="Pilot name"></label><label>REFINERY <input name="refinery" placeholder="Refinery name"></label><label>STAGE <select name="stage"><option value="">ALL</option><option value="crush">CRUSH</option><option value="purify">PURIFY</option></select></label><label>STATE <select name="state"><option value="">ALL</option><option value="queued">QUEUED</option><option value="processing">PROCESSING</option><option value="completed">COMPLETED</option><option value="cancelled">CANCELLED</option><option value="failed">FAILED</option></select></label><button type="submit">APPLY FILTERS</button></form><div class="market-admin-table"><h3>Refinery Jobs</h3><table><thead><tr><th>Pilot</th><th>Refinery</th><th>Stage</th><th>State</th><th>Queue</th><th>Duration</th><th>Efficiency</th><th>Fee</th><th>Completed / Due</th><th>Failure</th></tr></thead><tbody>${jobs}</tbody></table></div>`
}

function render() {
  const viewMarkup = activeDashboardView === 'settings'
    ? `<section class="section"><div class="section-heading"><div><p class="eyebrow">RUNTIME</p><h2>Simulation Configuration</h2></div></div>${configurationMarkup()}</section>
       <section class="section"><div class="section-heading"><div><p class="eyebrow">DIAGNOSTICS</p><h2>Azure Foundry Test</h2></div><span id="foundry-stream-status" class="population-count">IDLE</span></div>${foundryTestMarkup()}</section>`
    : activeDashboardView === 'npc'
      ? `<section class="section npc-section"><div class="section-heading"><div><p class="eyebrow">POPULATION</p><h2>Game State Overview</h2></div><span class="population-count">LIVE SYSTEM MAP</span></div><iframe class="npc-population-frame" src="/npc.html" title="NPC population and game state overview"></iframe></section>
         <section class="section create-section"><div class="section-heading"><div><p class="eyebrow">NEW LIFE</p><h2>Create NPC</h2></div><button id="generate-profile" class="secondary" type="button">DRAFT WITH FOUNDRY</button></div><form id="create-npc-form" class="npc-form create-form"><label>DISPLAY NAME <input name="display_name" maxlength="32" required></label><label>ROLE <select name="archetype_key" required><option value="economic_miner">Mining</option></select></label><label>CREATIVE DIRECTION <input name="prompt" maxlength="1000" placeholder="Independent prospector with a taste for rare deposits"></label><label>BACKGROUND STORY <textarea name="backstory" maxlength="4000" required></textarea></label><label>MOTIVATIONS <textarea name="motivations" maxlength="1200" required placeholder="Build a stable business&#10;Map profitable deposits"></textarea></label><div class="form-actions"><button type="submit">CREATE NPC</button></div></form></section>`
      : activeDashboardView === 'market'
        ? `<section class="section"><div class="section-heading"><div><p class="eyebrow">ECONOMY</p><h2>Market Operations</h2></div></div>${marketMarkup()}</section>`
        : `<section class="section"><div class="section-heading"><div><p class="eyebrow">INDUSTRY</p><h2>Refining Operations</h2></div><span class="population-count">${refineryAdmin.jobs.length} JOBS</span></div>${refineryMarkup()}</section>`
  appRoot.innerHTML = `
    <main class="admin-shell">
      <aside class="sidebar"><a class="brand" href="/">SPACECONOMY<span>CONTROL</span></a><div class="local-access"><span></span>LOCAL ADMIN ACCESS</div></aside>
      <section class="workspace">
        <header class="topbar"><div><p class="eyebrow">KEPLER SYSTEM</p><h1>World Control</h1></div><p id="admin-status" data-tone="neutral">Connecting to local control plane...</p><nav class="dashboard-menu" aria-label="Administration functions"><button type="button" data-dashboard-view="settings" class="${activeDashboardView === 'settings' ? 'is-active' : ''}">Settings</button><button type="button" data-dashboard-view="npc" class="${activeDashboardView === 'npc' ? 'is-active' : ''}">NPC</button><button type="button" data-dashboard-view="market" class="${activeDashboardView === 'market' ? 'is-active' : ''}">Market</button><button type="button" data-dashboard-view="refining" class="${activeDashboardView === 'refining' ? 'is-active' : ''}">Refining</button></nav></header>
        ${viewMarkup}
      </section>
    </main>
  `
  bindEvents()
}

function commaSeparated(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function lineSeparated(value: string): string[] {
  return value.split('\n').map((item) => item.trim()).filter(Boolean)
}

function bindEvents() {
  document.querySelectorAll<HTMLButtonElement>('[data-dashboard-view]').forEach((button) => button.addEventListener('click', () => {
    activeDashboardView = button.dataset.dashboardView as DashboardView
    location.hash = activeDashboardView === 'settings' ? '' : activeDashboardView
    render()
  }))
  document.querySelector<HTMLFormElement>('#market-filter-form')?.addEventListener('submit', (event) => { event.preventDefault(); const values = new FormData(event.currentTarget as HTMLFormElement); const query = new URLSearchParams(); for (const [key, value] of values) if (String(value).trim()) query.set(key, String(value)); void (async () => { try { marketAdmin = await request<MarketAdmin>(`/market/orders?${query}`); render(); setStatus('Market view refreshed.', 'success') } catch (error) { setStatus(error instanceof Error ? error.message : 'Unable to load market orders.', 'error') } })() })
  document.querySelector<HTMLFormElement>('#refinery-filter-form')?.addEventListener('submit', (event) => { event.preventDefault(); const values = new FormData(event.currentTarget as HTMLFormElement); const query = new URLSearchParams(); for (const [key, value] of values) if (String(value).trim()) query.set(key, String(value)); void (async () => { try { refineryAdmin = await request<RefineryAdmin>(`/refinery/jobs?${query}`); render(); setStatus('Refinery jobs refreshed.', 'success') } catch (error) { setStatus(error instanceof Error ? error.message : 'Unable to load refinery jobs.', 'error') } })() })
  document.querySelector<HTMLFormElement>('#configuration-form')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget as HTMLFormElement)
    void (async () => {
      try {
        configuration = await request<RuntimeConfiguration>('/configuration', { method: 'PATCH', body: JSON.stringify({ simulation_tick_hz: Number(form.get('simulation_tick_hz')), snapshot_tick_hz: Number(form.get('snapshot_tick_hz')), asteroid_spawn_interval_seconds: Number(form.get('asteroid_spawn_interval_seconds')), asteroid_field_maximum_active_asteroids: Number(form.get('asteroid_field_maximum_active_asteroids')), refinery_tick_seconds: Number(form.get('refinery_tick_seconds')), ollama_model: String(form.get('ollama_model')), ollama_timeout_seconds: Number(form.get('ollama_timeout_seconds')) }) })
        render(); setStatus('Runtime configuration saved.', 'success')
      } catch (error) { setStatus(error instanceof Error ? error.message : 'Unable to save configuration.', 'error') }
    })()
  })
  document.querySelectorAll<HTMLButtonElement>('[data-npc-id]').forEach((button) => button.addEventListener('click', () => { selectedNpcId = button.dataset.npcId ?? null; render() }))
  document.querySelector<HTMLFormElement>('#npc-editor-form')?.addEventListener('submit', (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); const npc = selectedNpc(); if (!npc) return
    void (async () => { try { const updated = await request<Npc>(`/npcs/${npc.pilot_id}`, { method: 'PATCH', body: JSON.stringify({ backstory: String(form.get('backstory')), motivations: lineSeparated(String(form.get('motivations'))), capabilities: commaSeparated(String(form.get('capabilities'))), lifecycle_state: form.get('lifecycle_state') }) }); npcs = npcs.map((entry) => entry.pilot_id === updated.pilot_id ? updated : entry); render(); setStatus(`${updated.display_name} updated.`, 'success') } catch (error) { setStatus(error instanceof Error ? error.message : 'Unable to update NPC.', 'error') } })()
  })
  document.querySelector<HTMLButtonElement>('#generate-profile')?.addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement
    const form = document.querySelector<HTMLFormElement>('#create-npc-form'); if (!form) return; const values = new FormData(form)
    button.disabled = true; button.textContent = 'DRAFTING...'
    void (async () => { try { setStatus('Azure Foundry is drafting a concise NPC profile.', 'neutral'); const generated = await request<{ display_name: string; creative_direction: string; backstory: string; motivations: string[] }>('/llm/generate-profile', { method: 'POST', body: JSON.stringify({ display_name: String(values.get('display_name') ?? '').trim(), archetype_key: String(values.get('archetype_key')), prompt: String(values.get('prompt') ?? '').trim() }) }); (form.elements.namedItem('display_name') as HTMLInputElement).value = generated.display_name; (form.elements.namedItem('prompt') as HTMLInputElement).value = generated.creative_direction; (form.elements.namedItem('backstory') as HTMLTextAreaElement).value = generated.backstory; (form.elements.namedItem('motivations') as HTMLTextAreaElement).value = generated.motivations.join('\n'); setStatus('Profile draft ready.', 'success') } catch (error) { setStatus(error instanceof Error ? error.message : 'Azure Foundry is unavailable.', 'error') } finally { button.disabled = false; button.textContent = 'DRAFT WITH FOUNDRY' } })()
  })
  document.querySelector<HTMLFormElement>('#create-npc-form')?.addEventListener('submit', (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement)
    void (async () => { try { const created = await request<Npc>('/npcs', { method: 'POST', body: JSON.stringify({ display_name: String(form.get('display_name')), archetype_key: String(form.get('archetype_key')), backstory: String(form.get('backstory')), motivations: lineSeparated(String(form.get('motivations'))) }) }); npcs = [...npcs, created].sort((left, right) => left.display_name.localeCompare(right.display_name)); selectedNpcId = created.pilot_id; render(); setStatus(`${created.display_name} entered the registry.`, 'success') } catch (error) { setStatus(error instanceof Error ? error.message : 'Unable to create NPC.', 'error') } })()
  })
  document.querySelector<HTMLFormElement>('#foundry-test-form')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget as HTMLFormElement)
    const button = document.querySelector<HTMLButtonElement>('#run-foundry-test')
    const output = document.querySelector<HTMLPreElement>('#foundry-test-output')
    const streamStatus = document.querySelector<HTMLElement>('#foundry-stream-status')
    if (!button || !output || !streamStatus) return
    button.disabled = true; button.textContent = 'STREAMING...'
    foundryTestResult = ''
    output.textContent = ''
    streamStatus.textContent = 'CONNECTING'
    void (async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/llm/foundry/stream`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: String(form.get('prompt')), system_instruction: String(form.get('system_instruction')), temperature: Number(form.get('temperature')), max_tokens: Number(form.get('max_tokens')) }) })
        if (!response.ok || !response.body) throw new Error(`Request failed with ${response.status}`)
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let pending = ''
        streamStatus.textContent = 'STREAMING'
        while (true) {
          const { done, value } = await reader.read()
          pending += decoder.decode(value, { stream: !done })
          const lines = pending.split('\n')
          pending = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') continue
            const event = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
            foundryTestResult += event.choices?.[0]?.delta?.content ?? ''
          }
          output.textContent = foundryTestResult
          output.scrollTop = output.scrollHeight
          if (done) break
        }
        streamStatus.textContent = 'COMPLETE'
        setStatus('Foundry response complete.', 'success')
      } catch (error) { streamStatus.textContent = 'FAILED'; setStatus(error instanceof Error ? error.message : 'Azure Foundry is unavailable.', 'error') } finally { button.disabled = false; button.textContent = 'RUN FOUNDRY TEST' }
    })()
  })
}

async function load() {
  try {
    [configuration, npcs, marketAdmin, refineryAdmin] = await Promise.all([request<RuntimeConfiguration>('/configuration'), request<Npc[]>('/npcs'), request<MarketAdmin>('/market/orders'), request<RefineryAdmin>('/refinery/jobs')])
    selectedNpcId = npcs[0]?.pilot_id ?? null
    render()
    setStatus('Local control plane connected.', 'success')
  } catch (error) {
    render()
    setStatus(error instanceof Error ? error.message : 'Unable to reach local control plane.', 'error')
  }
}

void load()