// Drive and capture the running Kairo dev app over the DevTools protocol.
// Start the app with `npm run dev -- --remoteDebuggingPort 9222` first.
//
//   node scripts/cdp.mjs shot <name> [width height]   2× PNG to captures/raw/<name>.png
//   node scripts/cdp.mjs eval '<js>'                   evaluate in the renderer, print the result
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = process.env.CDP_PORT ?? 9222

export async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http://localhost:5173'))
  if (!page) throw new Error('No Kairo renderer on the debug port')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id
      pending.set(n, { resolve, reject })
      ws.send(JSON.stringify({ id: n, method, params }))
    })
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }
  /** Capture the page at 2× device pixels, at a fixed layout size so every capture frames the same. */
  const shot = async (name, width = 1600, height = 960) => {
    // A window behind other windows stops painting; keep it live for the capture.
    await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
    await send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {})
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false })
    await new Promise((r) => setTimeout(r, 600))
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await send('Emulation.clearDeviceMetricsOverride')
    const file = path.join(root, 'captures', 'raw', `${name}.png`)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, Buffer.from(data, 'base64'))
    return file
  }
  return { send, evaluate, shot, close: () => ws.close() }
}

// Renderer stores, reached through Vite's dev module URLs (the same instances the app uses).
// Everything set here lives in memory and is gone on reload.
const store = (file, name) => `(await import('/src/${file}'))['${name}']`

/** An open, in-memory service so Operator shows the live transcript. Never written to disk. */
const DEMO_SERVICE = `(async () => {
  const services = ${store('components/operator/ServicePanel.tsx', 'useServiceRecords')};
  const now = Date.now()
  services.setState({
    loaded: true,
    activeId: 'demo-service',
    services: [{ id: 'demo-service', title: 'Living Water', speaker: 'Guest speaker', createdAt: now - 14 * 60e3, endedAt: null, status: 'live', pausedMs: 0, pausedAt: null, transcript: [], scriptures: [], notes: [], nuggets: [], analysisError: null, upload: { status: 'idle' } }],
  });
  const app = ${store('stores/useAppStore.ts', 'useAppStore')};
  app.getState().setIsTranscribing(true);
  window.__kairoDemo = { app, services };
  return 'demo service open'
})()`

const levelExpr = (rms) =>
  `window.__kairoDemo.app.getState().setAudioLevel({ rms: ${rms}, peak: ${Math.min(1, rms * 1.3)}, clipping: false, timestamp: Date.now() }); ${rms}`

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...args] = process.argv.slice(2)
  const app = await connect()
  try {
    if (cmd === 'shot') console.log(await app.shot(args[0], Number(args[1] ?? 1600), Number(args[2] ?? 960)))
    else if (cmd === 'eval') console.log(JSON.stringify(await app.evaluate(args[0]), null, 2))
    else if (cmd === 'demo-service') console.log(await app.evaluate(DEMO_SERVICE))
    else if (cmd === 'level') console.log(await app.evaluate(levelExpr(Number(args[0] ?? 0.5))))
    else throw new Error(`Unknown command ${cmd}`)
  } finally {
    app.close()
  }
}
