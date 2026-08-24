import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('the interface bundles Source Sans 3 with a calibrated application type scale', async () => {
  const config = await readFile(new URL('../tailwind.config.js', import.meta.url), 'utf8')
  const entry = await readFile(new URL('../src/renderer/src/main.tsx', import.meta.url), 'utf8')

  assert.match(config, /sans: \['Source Sans 3'/)
  assert.match(config, /narrow: \['Source Sans 3'/)
  assert.match(entry, /@fontsource-variable\/source-sans-3/)
  assert.match(config, /sm: \['0\.8125rem'/)
  assert.match(config, /base: \['0\.9375rem'/)
  assert.doesNotMatch(config, /SF Pro Display/)
  assert.doesNotMatch(config, /Avenir Next/)
})

test('shared page typography is compact and operator-oriented', async () => {
  const css = await readFile(new URL('../src/renderer/src/index.css', import.meta.url), 'utf8')

  assert.match(css, /\.page-header[\s\S]*?text-xl/)
  assert.match(css, /\.page-subtitle[\s\S]*?text-xs/)
  assert.match(css, /font-family: 'Source Sans 3'/)
  assert.match(css, /font-feature-settings: 'kern' 1, 'liga' 1/)
})
