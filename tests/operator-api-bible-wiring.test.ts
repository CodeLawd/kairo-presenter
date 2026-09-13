import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/main/orchestrator.ts'),
  'utf8',
)

const lookupSource = fs.readFileSync(
  path.join(process.cwd(), 'src/main/services/scripture/detection-lookup.ts'),
  'utf8',
)

test('Operator detections resolve verse text through the shared Scripture service', () => {
  const detectionHandler = source.slice(
    source.indexOf('private async handleDetection'),
    source.indexOf('// ─── Auto-present countdown'),
  )

  // handleDetection delegates to the shared lookup helper with the shared
  // Scripture service and the operator's API.Bible key — it must never
  // bypass them (e.g. with a private fetch or a hardcoded translation).
  assert.match(detectionHandler, /lookupDetectedScripture\(/)
  assert.match(detectionHandler, /lookupDetectedScripture\(\s*scriptureService/)
  assert.match(detectionHandler, /store\.get\(["']stt["']\)\.bibleApiKey/)
})

test('Shared detection lookup fans out through service.search with translation + key', () => {
  // The helper behind handleDetection must resolve through the injected
  // service's search (local → API.Bible fallback), honoring the requested
  // translation and key — never substituting wording silently.
  assert.match(lookupSource, /service\.search\(/)
  assert.match(lookupSource, /translation/)
  assert.match(lookupSource, /apiKey/)
})
