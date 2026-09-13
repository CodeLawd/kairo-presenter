import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
// App pulls in LoadingScreen, which statically imports a PNG that plain-node
// tsx cannot parse. Stub binary-asset imports to their paths before the lazy
// load() below pulls the component chain in.
for (const ext of ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff2']) {
  require.extensions[ext] = ((module: { exports: unknown }, filename: string): void => {
    module.exports = filename
  }) as never
}
// Some modules build JSX at module scope, so the classic runtime's global must
// exist before they are imported.
Object.assign(globalThis, { React })

type Modules = {
  App: React.ComponentType
  Scripture: React.ComponentType
  useBootstrapStore: typeof import('@/bootstrap/useBootstrapStore')['useBootstrapStore']
  DEFAULT_SETTINGS: typeof import('@/lib/defaultSettings')['DEFAULT_SETTINGS']
}

let modules: Promise<Modules> | null = null

function load(): Promise<Modules> {
  modules ??= (async () => ({
    // Imported through the same aliases the components use, so the test shares
    // one module instance of the store with them.
    App: (await import('@/App')).default,
    Scripture: (await import('@/components/scripture/Scripture')).default,
    useBootstrapStore: (await import('@/bootstrap/useBootstrapStore')).useBootstrapStore,
    DEFAULT_SETTINGS: (await import('@/lib/defaultSettings')).DEFAULT_SETTINGS,
  }))()
  return modules
}

function reset(m: Modules): void {
  m.useBootstrapStore.setState({
    phase: 'idle',
    errors: [],
    sermonPlans: [],
    lyrics: [],
    livePlan: null,
    translations: [],
    settings: m.DEFAULT_SETTINGS,
    apiBibleAuth: 'unchecked',
  })
}

test('the loading screen renders instead of the app shell until bootstrap is ready', async () => {
  const m = await load()
  reset(m)
  const markup = renderToStaticMarkup(React.createElement(m.App))

  assert.match(markup, /Kairo/)
  assert.match(markup, /aria-busy="true"/)
  assert.doesNotMatch(markup, /data-playlist-sidebar/, 'no route content may mount yet')
})

test('Scripture shows no API-key warning before authorization is known', async () => {
  const m = await load()
  reset(m)
  const markup = renderToStaticMarkup(React.createElement(m.Scripture))
  assert.doesNotMatch(markup, /NKJV is the default/)
})
