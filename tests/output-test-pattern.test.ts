import { it } from 'node:test'
import assert from 'node:assert/strict'
import { outputTestPatternHTML } from '../src/lib/output-test-pattern'

it('escapes output names and keeps diagnostic content in one removable layer', () => {
  for (const pattern of ['bars', 'text', 'motion'] as const) {
    const html = outputTestPatternHTML(pattern, '<img src=x onerror=alert(1)>')
    assert.match(html, /id="kairo-diagnostic-pattern"/)
    assert.match(html, /&lt;img/)
    assert.doesNotMatch(html, /<img|<script|https?:/)
  }
})

it('animates the motion pattern continuously so idle output updates can be checked', () => {
  assert.match(outputTestPatternHTML('motion', 'Main'), /3s linear infinite alternate/)
  assert.match(outputTestPatternHTML('text', 'Main'), /0123456789/)
  assert.match(outputTestPatternHTML('bars', 'Main'), /#ff0000/)
})
