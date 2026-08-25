import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyLineGlosses,
  collectTranslatableIndices,
  expandInlineGlossesToLines,
  extractInlineGlossPairs,
  formatGloss,
  isEnglishLanguageCode,
  isGlossLine,
  isJunkGloss,
  isLikelyEnglishLyric,
  lookupOnlineGloss,
  glossMatchKey,
  sectionsHaveGlosses,
  shouldApplyGloss,
  shouldTranslateLine,
  stripLineGlosses,
} from '../src/lib/lyrics-translate'

test('isGlossLine matches parenthetical-only lines', () => {
  assert.equal(isGlossLine('(Hello world)'), true)
  assert.equal(isGlossLine('  (Hello)  '), true)
  assert.equal(isGlossLine('Hello (world)'), false)
  assert.equal(isGlossLine('()'), false)
})

test('formatGloss wraps and unwraps nested parens', () => {
  assert.equal(formatGloss('Hello'), '(Hello)')
  assert.equal(formatGloss('(Hello)'), '(Hello)')
  assert.equal(formatGloss('((Hello))'), '(Hello)')
})

test('shouldTranslateLine skips blanks, markers, and glosses', () => {
  assert.equal(shouldTranslateLine('Odudu dabu Jesus no'), true)
  assert.equal(shouldTranslateLine(''), false)
  assert.equal(shouldTranslateLine('[Chorus]'), false)
  assert.equal(shouldTranslateLine('(Already glossed)'), false)
})

test('collectTranslatableIndices lists only singable lines', () => {
  assert.deepEqual(
    collectTranslatableIndices(['[Verse]', 'Line one', '', 'Line two', '(old gloss)']),
    [1, 3]
  )
})

test('applyLineGlosses inserts a gloss under each source line', () => {
  const lines = ['Odudu dabu Jesus no', 'Ide na lolu le']
  const glosses = new Map([
    [0, 'There is no other Name like Jesus'],
    [1, 'He made the lame walk'],
  ])
  assert.deepEqual(applyLineGlosses(lines, glosses), [
    'Odudu dabu Jesus no',
    '(There is no other Name like Jesus)',
    'Ide na lolu le',
    '(He made the lame walk)',
  ])
})

test('applyLineGlosses preserves blank slide breaks', () => {
  const lines = ['A', '', 'B']
  const glosses = new Map([
    [0, 'Alpha'],
    [2, 'Beta'],
  ])
  assert.deepEqual(applyLineGlosses(lines, glosses), [
    'A',
    '(Alpha)',
    '',
    'B',
    '(Beta)',
  ])
})

test('applyLineGlosses replaces an existing gloss instead of stacking', () => {
  const lines = ['Odudu dabu Jesus no', '(Old gloss)', 'Next line']
  const glosses = new Map([
    [0, 'New gloss'],
    [2, 'Next'],
  ])
  assert.deepEqual(applyLineGlosses(lines, glosses), [
    'Odudu dabu Jesus no',
    '(New gloss)',
    'Next line',
    '(Next)',
  ])
})

test('applyLineGlosses leaves section markers alone', () => {
  const lines = ['[Chorus]', 'Sing this']
  const glosses = new Map([[1, 'English']])
  assert.deepEqual(applyLineGlosses(lines, glosses), [
    '[Chorus]',
    'Sing this',
    '(English)',
  ])
})

test('stripLineGlosses removes bilingual glosses and keeps originals', () => {
  assert.deepEqual(
    stripLineGlosses([
      'Odudu dabu Jesus no',
      '(There is no other Name like Jesus)',
      '',
      'Power!',
      '(Power!)',
    ]),
    ['Odudu dabu Jesus no', '', 'Power!']
  )
})

test('sectionsHaveGlosses detects gloss presence', () => {
  assert.equal(sectionsHaveGlosses([{ lines: ['Hello'] }]), false)
  assert.equal(sectionsHaveGlosses([{ lines: ['Hola', '(Hello)'] }]), true)
})

test('shouldApplyGloss skips English detections and identical text', () => {
  assert.equal(shouldApplyGloss('Hello', 'Hola', 'en'), false)
  assert.equal(shouldApplyGloss('Hello', 'Hello', 'es'), false)
  assert.equal(shouldApplyGloss('Odudu', 'Spirit', 'yo'), true)
  assert.equal(isEnglishLanguageCode('en-GB'), true)
  assert.equal(isEnglishLanguageCode('yo'), false)
})

test('shouldApplyGloss rejects junk and already-English lyrics', () => {
  assert.equal(isLikelyEnglishLyric('I see Jesus'), true)
  assert.equal(isLikelyEnglishLyric('Ide na lolu le'), false)
  assert.equal(isJunkGloss('Refrain'), true)
  assert.equal(shouldApplyGloss('I see Jesus', 'Refrain', 'und'), false)
  assert.equal(shouldApplyGloss('Ide na lolu le', 'He made the lame walk', 'und'), true)
})

test('lookupOnlineGloss matches apostrophe / doubled-vowel hymn spellings', () => {
  const pairs = new Map([
    ['ija dopin oguun si tan', "The strife is o'er, the battle done;"],
    ['omo olorun se gun ota', 'The victory of life is won;'],
  ])
  assert.equal(
    lookupOnlineGloss("Ija d'opin, ogun si'tan", pairs),
    "The strife is o'er, the battle done;"
  )
  // Apostrophes are stripped so d'opin→dopin and si'tan→sitan; compact
  // matching still aligns with spaced hymn-page lines.
  assert.equal(glossMatchKey("Ija d'opin, ogun si'tan"), 'ija dopin ogun sitan')
})

test('lookupOnlineGloss ignores weak substring junk matches', () => {
  const pairs = new Map([
    ['i see jesus x4', 'Refrain'],
    ['ide na lolu le', 'He made the lame walk'],
  ])
  assert.equal(lookupOnlineGloss('I see Jesus', pairs), undefined)
  assert.equal(lookupOnlineGloss('Ide na lolu le', pairs), 'He made the lame walk')
})

test('lookupOnlineGloss matches shorter slide lines to longer site lines', () => {
  const pairs = new Map([
    ['odu jesus nana tumale chaka chaka', 'The Name of Jesus is the greatest'],
    ['e chego mano', 'You are not the same as men'],
    ['odudu dabu jesus no', 'There is no other Name like Jesus'],
  ])
  assert.equal(
    lookupOnlineGloss('Odu Jesus nana tumale', pairs),
    'The Name of Jesus is the greatest'
  )
  assert.equal(
    lookupOnlineGloss('E chego mano Jesus! E chego mano', pairs),
    'You are not the same as men'
  )
})

test('extractInlineGlossPairs peels glued section labels', () => {
  const pairs = extractInlineGlossPairs(
    'ChorusOdudu dabu Jesus No\n(no name like the name of Jesus)\nVerseIde na lolu le (He made the lame to walk)'
  )
  // under-line pair is harvested by the scraper, not extractInline alone — inline form:
  assert.equal(lookupOnlineGloss('Ide na lolu le', pairs), 'He made the lame to walk')
})

test('extractInlineGlossPairs reads lyric-site parentheticals', () => {
  const pairs = extractInlineGlossPairs(
    'Odudu dabu Jesus no (There is no other Name like Jesus)\nIde na lolu le (He made the lame to walk)'
  )
  assert.equal(lookupOnlineGloss('Odudu dabu Jesus no', pairs), 'There is no other Name like Jesus')
  assert.equal(lookupOnlineGloss('Ide na lolu le', pairs), 'He made the lame to walk')
})

test('expandInlineGlossesToLines converts end-of-line glosses', () => {
  assert.equal(
    expandInlineGlossesToLines('Odudu dabu Jesus no (There is no other Name like Jesus)'),
    'Odudu dabu Jesus no\n(There is no other Name like Jesus)'
  )
})
