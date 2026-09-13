import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { IPC } from '../src/lib/ipc'

const ROOT = path.resolve(__dirname, '..')
const read = (relative: string): string => fs.readFileSync(path.join(ROOT, relative), 'utf8')

test('the bootstrap contract has an invoke channel and a push channel', () => {
  assert.equal(IPC.APP.BOOTSTRAP, 'app:bootstrap')
  assert.equal(IPC.APP.BOOTSTRAP_PROGRESS, 'app:bootstrapProgress')
})

test('the preload bridges bootstrap and its progress subscription', () => {
  const preload = read('src/preload/index.ts')
  assert.match(preload, /bootstrap\(\): Promise<AppBootstrapSnapshot>/)
  assert.match(preload, /subscribe<BootstrapProgress>\(IPC\.APP\.BOOTSTRAP_PROGRESS/)
  assert.match(preload, /app: appApi/)
})

test('main handles bootstrap and streams progress to the calling window', () => {
  const handlers = read('src/main/ipc/index.ts')
  assert.ok(handlers.includes('IPC.APP.BOOTSTRAP'))
  assert.match(handlers, /sender\.send\(IPC\.APP\.BOOTSTRAP_PROGRESS, progress\)/)
})

test('bootstrap loads local resources only', () => {
  const handlers = read('src/main/ipc/index.ts')
  const block = handlers.slice(handlers.indexOf('IPC.APP.BOOTSTRAP'), handlers.indexOf('// ─── Entry point'))
  for (const forbidden of [
    'getDevices',
    'ndiService.getStatus',
    'getPlaylists',
    'searchOnline',
    'startDownload',
    'connect(',
  ]) {
    assert.ok(!block.includes(forbidden), `bootstrap must not call ${forbidden}`)
  }
  // Translation availability is read without a key so it cannot hit the network.
  assert.match(block, /scriptureService\.getTranslationOptions\(\)/)
})

test('the app shell does not mount until bootstrap is ready', () => {
  const app = read('src/renderer/src/App.tsx')
  const guard = app.indexOf('if (!ready)')
  assert.ok(guard > 0, 'App must short-circuit on the loading screen')
  assert.ok(guard < app.indexOf('<AppShell'), 'AppShell renders only after the guard')
  assert.match(app, /const ready = bootstrapped && minDurationElapsed/)
})

test('every hook runs before the loading-screen return', () => {
  // A conditional return placed above a hook changes hook order the moment
  // bootstrap becomes ready, which React rejects outright.
  const app = read('src/renderer/src/App.tsx')
  const component = app.slice(app.indexOf('export default function App('))
  const guard = component.indexOf('if (!ready) {')
  assert.ok(guard > 0)

  const after = component.slice(guard)
  for (const hook of ['useEffect(', 'useState(', 'useCallback(', 'useMemo(', 'useRef(']) {
    assert.ok(!after.includes(hook), `${hook} must not run after the loading-screen return`)
  }
})

test('the loading screen honours reduced motion and shows progress', () => {
  const screen = read('src/renderer/src/bootstrap/LoadingScreen.tsx')
  // Transitions are disabled per-utility; the keyframe animations (sheen,
  // copy, step) are disabled centrally in CSS — either way reduced-motion
  // stays static.
  assert.match(screen, /motion-reduce:transition-none/)
  const css = read('src/renderer/src/index.css')
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.ok(reduced.length > 0, 'missing prefers-reduced-motion block')
  assert.ok(reduced.includes('animation: none'), 'reduced-motion must kill splash animations')
  for (const selector of ['.splash-mark-sheen::after', '.splash-copy', '.splash-step']) {
    assert.ok(reduced.includes(selector), `${selector} must be stilled under reduced-motion`)
  }
  // Staged booth-facing copy (see the splash-state tests), not the raw IPC step.
  assert.match(screen, /\{percent\}%/)
  assert.match(screen, /\{step\}/)
})

test('startup screens no longer issue their own first-mount reads', () => {
  const cases: Array<[string, string[]]> = [
    ['src/renderer/src/components/scripture/Scripture.tsx', ['scripture.listSermonPlans()', 'scripture.getTranslations()']],
    ['src/renderer/src/components/operator/OperatorToolbar.tsx', ['scripture.listSermonPlans()', 'scripture.getLivePlan()']],
    ['src/renderer/src/components/lyrics/Lyrics.tsx', ['lyrics.getLibrary()']],
    ['src/renderer/src/components/operator/Operator.tsx', ['transcription.getHistory()', 'orchestrator.getStatus()']],
    ['src/renderer/src/App.tsx', ['settings.getAll()']],
  ]
  for (const [file, calls] of cases) {
    const source = read(file)
    for (const call of calls) {
      assert.ok(!source.includes(call), `${file} still calls ${call} on mount`)
    }
    assert.ok(source.includes('useBootstrapStore'), `${file} does not read the shared snapshot`)
  }

  const settings = read('src/renderer/src/components/settings/Settings.tsx')
  assert.doesNotMatch(
    settings,
    /apply\(useBootstrapStore\.getState\(\)\.settings\)[\s\S]{0,160}settings\.getAll\(\)/,
    'Settings still repeats the bootstrap settings read in its mount effect',
  )
})

test('screens publish their mutations back to the shared snapshot', () => {
  assert.match(read('src/renderer/src/components/scripture/Scripture.tsx'), /setSermonPlans\(plans\)/)
  assert.match(read('src/renderer/src/components/lyrics/Lyrics.tsx'), /setLyrics\(songs\)/)
  assert.match(read('src/renderer/src/components/theme/ThemeEditor.tsx'), /patchSettings\('themeLibrary', next\)/)
  assert.match(read('src/renderer/src/components/settings/Settings.tsx'), /publish\('scripture', settings\.scripture\)/)
})

test('integration hydration runs after the interface opens, never before', () => {
  const store = read('src/renderer/src/bootstrap/useBootstrapStore.ts')
  assert.match(store, /export async function hydrateIntegrations/)
  // Devices are enumerated in the renderer now: getUserMedia needs a real
  // MediaDeviceInfo.deviceId, which the main process cannot supply.
  for (const call of ['listAudioInputDevices', 'ndi.getStatus', 'scripture.getTranslations']) {
    assert.ok(store.slice(store.indexOf('hydrateIntegrations')).includes(call), `${call} must hydrate in the background`)
  }
  const app = read('src/renderer/src/App.tsx')
  // Gated on ready AND the account gate: hydration will not pull secrets for
  // a ticketed service when the signed-in operator has not been admitted yet.
  assert.match(app, /hydrateIntegrations/)
  // \r? tolerates CRLF checkouts on Windows, where every line ends with \r\n.
  assert.match(app, /if \(!ready.*\) return\r?\n\s*void hydrateIntegrations\(\)/)
})
