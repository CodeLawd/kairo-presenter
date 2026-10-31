// Feed a demo sermon through the app's real transcript pipeline, so the real
// detector stages real verses. Only the audio is skipped: each line enters
// where Deepgram's final results do. Needs the dev app started with
//   npm run dev -- --remoteDebuggingPort 9222 --inspect 9229
//
//   node scripts/demo-sermon.mjs attach          expose the services (in memory only)
//   node scripts/demo-sermon.mjs say "<line>"    one final transcript line
//   node scripts/demo-sermon.mjs interim "<text>"
//   node scripts/demo-sermon.mjs clear           clear transcript history
//   node scripts/demo-sermon.mjs start           run the detector (no mic, no Deepgram)
//   node scripts/demo-sermon.mjs reset           fresh detector, no pending suggestions
//   node scripts/demo-sermon.mjs stop
//
// `attach` also turns off service-record logging for this run, so demo lines
// never land in the church's saved service records. A restart undoes both.
import { connect as connectRenderer } from './cdp.mjs'

async function connectMain() {
  const [target] = await (await fetch('http://127.0.0.1:9229/json/list')).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let id = 0
  const pending = new Map()
  const listeners = new Set()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    } else if (msg.method) listeners.forEach((fn) => fn(msg))
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
  return { send, evaluate, on: (fn) => listeners.add(fn), close: () => ws.close() }
}

/** Pause once inside the transcript-history IPC handler, where the services are in scope, and keep a handle on them. */
async function attach(main) {
  if (await main.evaluate('Boolean(globalThis.__kairoDemo?.orchestrator)')) return 'already attached'
  await main.send('Debugger.enable')
  const { breakpointId } = await main.send('Debugger.setBreakpointByUrl', {
    urlRegex: 'out/main/index\\.js$',
    lineNumber: 42202, // `return sttService.getHistory()` (0-based)
  })
  const paused = new Promise((resolve) => main.on((msg) => msg.method === 'Debugger.paused' && resolve(msg.params)))
  const renderer = await connectRenderer()
  void renderer.evaluate('window.api.transcription.getHistory()')
  const { callFrames } = await paused
  try {
    const { exceptionDetails } = await main.send('Debugger.evaluateOnCallFrame', {
      callFrameId: callFrames[0].callFrameId,
      expression: `globalThis.__kairoDemo = { sttService, serviceRecords, orchestrator }; serviceRecords.transcript = () => {}; serviceRecords.scripture = () => {}; 'ok'`,
    })
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  } finally {
    await main.send('Debugger.removeBreakpoint', { breakpointId })
    await main.send('Debugger.resume')
    await main.send('Debugger.disable')
    renderer.close()
  }
  return 'attached'
}

let n = 0
const say = (main, text) =>
  main.evaluate(`(() => {
    const words = ${JSON.stringify(text)}.split(/\\s+/).map((word, i) => ({ word, start: i * 0.3, end: i * 0.3 + 0.28, confidence: 0.97 }))
    const result = { id: 'demo-' + Date.now() + '-' + ${n++}, text: ${JSON.stringify(text)}, words, isFinal: true, timestamp: Date.now() }
    globalThis.__kairoDemo.sttService.deepgram.emit('final', result)
    return result.id
  })()`)

const [cmd, ...args] = process.argv.slice(2)
const main = await connectMain()
try {
  if (cmd === 'attach') console.log(await attach(main))
  else if (cmd === 'say') console.log(await say(main, args.join(' ')))
  else if (cmd === 'interim')
    console.log(await main.evaluate(`globalThis.__kairoDemo.sttService.deepgram.emit('interim', { text: ${JSON.stringify(args.join(' '))}, isFinal: false, timestamp: Date.now() })`))
  else if (cmd === 'start') {
    // The real orchestrator and detector, with the two audio ends cut off:
    // Deepgram never connects and the microphone stream is never attached.
    const renderer = await connectRenderer()
    const all = await renderer.evaluate('window.api.settings.getAll()')
    renderer.close()
    const config = {
      audioDeviceId: '',
      sttProvider: 'deepgram',
      sttApiKey: 'kairo-managed',
      llmApiKey: 'kairo-managed',
      sttLanguage: 'en',
      llmProvider: all.stt.llmProvider ?? 'anthropic',
      scriptureTranslation: 'KJV',
      autoMode: false,
      confidenceThreshold: all.scripture.confidenceThreshold,
      autoPresentDelaySec: all.scripture.autoPresentDelaySec ?? 1,
    }
    console.log(
      await main.evaluate(`(async () => {
        const { sttService, orchestrator } = globalThis.__kairoDemo
        sttService.start = async function () { this.active = true }
        orchestrator.attachAudioStream = () => {}
        await orchestrator.start(${JSON.stringify(config)})
        return orchestrator.getStatus()
      })()`),
    )
  } else if (cmd === 'reset')
    // A fresh detector (no remembered chapter) and no pending suggestions, without
    // stopping: stop() waits on a Deepgram socket this demo never opens.
    console.log(
      await main.evaluate(`(() => {
        const { orchestrator, sttService } = globalThis.__kairoDemo
        orchestrator.pendingSuggestions.clear()
        orchestrator.createDetector(orchestrator.cfg)
        sttService.clearHistory()
        return 'reset'
      })()`),
    )
  else if (cmd === 'stop') console.log(await main.evaluate("void globalThis.__kairoDemo.orchestrator.stop(); 'stopping'"))
  else if (cmd === 'clear') console.log(await main.evaluate('globalThis.__kairoDemo.sttService.clearHistory()'))
  else throw new Error(`Unknown command ${cmd}`)
} finally {
  main.close()
}
