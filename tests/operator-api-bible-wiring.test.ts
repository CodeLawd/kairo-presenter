import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/main/orchestrator.ts'),
  'utf8',
)

test('Operator detections resolve verse text through the shared Scripture service', () => {
  const detectionHandler = source.slice(
    source.indexOf('private async handleDetection'),
    source.indexOf('// ─── Auto-present countdown'),
  )

  assert.match(detectionHandler, /scriptureService\.search\(/)
  assert.match(detectionHandler, /store\.get\(["']stt["']\)\.bibleApiKey/)
})
