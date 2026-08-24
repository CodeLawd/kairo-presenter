import assert from 'node:assert/strict'
import test from 'node:test'
import { clampPaneWidth, maxPaneWidthForViewport, scaleToFit } from '../src/renderer/src/lib/paneSizing'

test('clamps a requested pane width to its configured bounds', () => {
  assert.equal(clampPaneWidth(120, 160, 280), 160)
  assert.equal(clampPaneWidth(220, 160, 280), 220)
  assert.equal(clampPaneWidth(340, 160, 280), 280)
})

test('tightens a pane maximum to preserve the preview minimum width', () => {
  assert.equal(maxPaneWidthForViewport(960, 330, 300, 280), 280)
  assert.equal(maxPaneWidthForViewport(760, 330, 300, 280), 130)
})

test('scales a 1920px theme canvas to the current thumbnail width', () => {
  assert.equal(scaleToFit(192, 1920), 0.1)
  assert.equal(scaleToFit(288, 1920), 0.15)
})
