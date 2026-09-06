import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const read = (relative: string): string => fs.readFileSync(path.join(ROOT, relative), 'utf8')

test('resource IPC constants are registered in main and preload', () => {
  const ipc = read('src/lib/ipc.ts')
  const main = read('src/main/ipc/index.ts')
  const preload = read('src/preload/index.ts')

  for (const name of [
    'GET_RESOURCE_CATALOGUE',
    'GET_RESOURCE_DETAILS',
    'GET_RESOURCE_PREVIEW',
    'SET_RESOURCE_BINDINGS',
  ]) {
    assert.match(ipc, new RegExp(`${name}:`))
    assert.match(main, new RegExp(`IPC\\.PROPRESENTER\\.${name}`))
    assert.match(preload, new RegExp(`IPC\\.PROPRESENTER\\.${name}`))
  }
})

test('bindings IPC writes only durable resource bindings', () => {
  const main = read('src/main/ipc/index.ts')
  const start = main.indexOf('IPC.PROPRESENTER.SET_RESOURCE_BINDINGS')
  assert.ok(start >= 0, 'bindings handler is missing')
  const end = main.indexOf('// ─── Audio handlers', start)
  const handler = main.slice(start, end < 0 ? undefined : end)

  assert.match(handler, /store\.set\(['"]propresenterResources['"]\s*,\s*normalizeResourceBindings/)
  assert.doesNotMatch(handler, /store\.set\([^)]*(catalogue|preview)/i)
})

test('resource catalogue UI exposes accessible controls and fallback states', () => {
  const catalogue = read('src/renderer/src/components/propresenter/ResourceCatalogue.tsx')

  assert.match(catalogue, /aria-label=["']Search ProPresenter resources/)
  assert.match(catalogue, /Refresh/)
  assert.match(catalogue, /aria-pressed/)
  assert.match(catalogue, /Loading/)
  assert.match(catalogue, /No ProPresenter resources found/)
  assert.match(catalogue, /Could not load ProPresenter resources/)
  assert.match(catalogue, /Unavailable in ProPresenter/)
})

test('resource thumbnails use safe named alternatives and clickable rows are buttons', () => {
  const thumbnail = read('src/renderer/src/components/propresenter/ResourceThumbnail.tsx')
  const catalogue = read('src/renderer/src/components/propresenter/ResourceCatalogue.tsx')

  assert.match(thumbnail, /alt=\{[^}]*resource\.name/)
  assert.doesNotMatch(thumbnail, /dangerouslySetInnerHTML/)
  assert.match(thumbnail, /Preview unavailable/)
  assert.match(thumbnail, /Retry/)
  assert.match(catalogue, /<button[\s\S]*resource\.id/)
})

test('onboarding resource step keeps discovery optional and explicit', () => {
  const step = read('src/renderer/src/components/onboarding/StepProPresenterResources.tsx')
  const wizard = read('src/renderer/src/components/onboarding/OnboardingWizard.tsx')

  assert.match(step, /ResourceCatalogue mode=["']onboarding["']/)
  assert.match(step, /Nothing in ProPresenter was changed/)
  assert.match(wizard, /current === ['"]propresenterResources['"]/) 
})

test('preview and catalogue services stay read-only', () => {
  const resources = read('src/main/services/propresenter/resources.ts')
  const catalogue = read('src/renderer/src/components/propresenter/ResourceCatalogue.tsx')

  assert.doesNotMatch(resources, /trigger(Look|Macro|Prop|Media|VideoInput)/i)
  assert.doesNotMatch(catalogue, /fetch\(|axios|http\.(get|post|put|delete)/i)
})
