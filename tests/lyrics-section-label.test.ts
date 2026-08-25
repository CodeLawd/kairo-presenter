import assert from 'node:assert/strict'
import test from 'node:test'

import { isSectionLine, parseSectionLabel } from '../src/main/services/lyrics/section-label'
import { structureLyrics, extractLyricLines } from '../src/main/services/lyrics/normalize'

test('parseSectionLabel accepts Ending and short E codes', () => {
  assert.deepEqual(parseSectionLabel('Ending'), { type: 'ending', index: 1 })
  assert.deepEqual(parseSectionLabel('[Ending]'), { type: 'ending', index: 1 })
  assert.deepEqual(parseSectionLabel('E'), { type: 'ending', index: 1 })
  assert.deepEqual(parseSectionLabel('E2'), { type: 'ending', index: 2 })
  assert.deepEqual(parseSectionLabel('{E}'), { type: 'ending', index: 1 })
})

test('parseSectionLabel does not treat End / END. as section markers', () => {
  // LRCLIB appends these as stage cues; treating them as Ending discarded the song.
  assert.equal(parseSectionLabel('END.'), null)
  assert.equal(parseSectionLabel('End'), null)
  assert.equal(parseSectionLabel('end'), null)
  assert.equal(isSectionLine('END.'), false)
})

test('LRCLIB Ija D\'opin plain lyrics survive structuring', () => {
  const plain = `Instruments playing
Ija d'opin, ogun si'tan
Olugbala jagun molu
Orin ayo la o ma ko
HALLELUJAH
Instruments playing
Ojo meta na tii koja
O jinde ku ro nu oku
E fogo fun Olorun wa
HALLELUJAH
Gba wa lowo oro iku
Ka le ka si maa yin o
HALLELUJAH
Okan mi yin oba oorun
Mu ore wa sodo re
Yin Olu wa yin Oluuwa
Yin Oba Ainipekun
Yin Olu wa yin Oluuwa
Yin Oba Ainipekun

END.`

  const structured = structureLyrics(plain)
  assert.ok(structured.includes("Ija d'opin"))
  assert.ok(!/instruments playing/i.test(structured))
  assert.ok(!/^END\.?$/m.test(structured))

  // No line should look like a section marker — otherwise orphan lyrics are dropped.
  const markerHits = structured.split('\n').filter((line) => isSectionLine(line))
  assert.deepEqual(markerHits, [])

  const lines = extractLyricLines(structured)
  assert.ok(lines.length >= 10)
  assert.equal(lines[0], "Ija d'opin, ogun si'tan")
})
