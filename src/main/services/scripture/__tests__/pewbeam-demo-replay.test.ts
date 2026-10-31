import assert from 'node:assert/strict'
import test from 'node:test'
import { ScriptureDetector, type ScriptureReference } from '../detector'
import { followUpContext, pickCommandContext, ScriptureVoiceNavigation, type LiveScriptureContext } from '../voice-navigation'
import type { ScriptureSuggestion, ScriptureVerse, TranscriptResult } from '../../../../lib/ipc'

// The Pewbeam demo's spoken lines, as Whisper transcribed them from its audio.
const DEMO = [
  'Genesis chapter 2 verse 6.',
  'Matthew chapter 1 verse 8.',
  'Next verse.',
  'Switch to KJV.',
  'Go back to the previous verse.',
]

const verses = (book: string, chapter: number, translation: string): ScriptureVerse[] =>
  Array.from({ length: 25 }, (_, i) => ({ book, chapter, verse: i + 1, text: `${translation} ${book} ${chapter}:${i + 1}` }))

test('the Pewbeam demo steps from the verse just said, not an older live verse', async () => {
  // Matthew 1:17 is still on screen from earlier; Automation is off, so detections only suggest.
  let live: { context: LiveScriptureContext; at: number } | null = {
    context: { book: 'Matthew', chapter: 1, verseStart: 17, verseEnd: 17, translation: 'KJV', revision: 1 },
    at: 1,
  }
  let followUp: { context: LiveScriptureContext; at: number } | null = null
  let clock = 10
  let followRevision = 0
  const suggested: ScriptureSuggestion[] = []
  const retranslated: string[] = []
  const note = (suggestion: ScriptureSuggestion): void => {
    const context = followUpContext(suggestion, --followRevision)
    if (context) followUp = { context, at: ++clock }
  }

  const navigation = new ScriptureVoiceNavigation({
    enabled: () => true,
    autoMode: () => false,
    current: () => pickCommandContext(live, followUp),
    chapter: async (book, chapter, translation) => verses(book, chapter, translation),
    present: async () => { throw new Error('Automation is off') },
    suggest: (suggestion) => { suggested.push(suggestion); note(suggestion) },
    retranslateRow: (passageId, translation) => {
      retranslated.push(`${passageId} ${translation}`)
      if (followUp?.context.passageId === passageId) followUp = { ...followUp, context: { ...followUp.context, translation } }
    },
    error: (error) => { throw error },
  })

  const detector = new ScriptureDetector({ apiKey: '' })
  detector.on('detection', (refs: ScriptureReference[]) => {
    for (const ref of refs) {
      const suggestion = {
        id: `${ref.book}-${ref.chapter}-${ref.verseStart}`, reference: `${ref.book} ${ref.chapter}:${ref.verseStart}`,
        verses: [{ book: ref.book, chapter: ref.chapter, verse: ref.verseStart, text: 'NKJV' }],
        translation: 'NKJV', confidence: ref.confidence, source: 'auto',
      } as ScriptureSuggestion
      suggested.push(suggestion)
      note(suggestion)
    }
  })

  try {
    for (const [i, text] of DEMO.entries()) {
      const final: TranscriptResult = { text, id: `demo-${i}`, words: [], timestamp: 0, duration: 1, isFinal: true }
      if (!navigation.claim(final)) detector.analyzeExplicit(text, true, false)
      await navigation.settled()
    }
    assert.deepEqual(
      suggested.map((s) => `${s.reference} ${s.translation}`),
      ['Genesis 2:6 NKJV', 'Matthew 1:8 NKJV', 'Matthew 1:9 NKJV', 'Matthew 1:8 KJV'],
    )
    // Next and previous extend Matthew 1:8's row; "switch to KJV" switches that row in place.
    const row = suggested[1].id
    assert.deepEqual(suggested.slice(2).map((s) => s.passageId), [row, row])
    assert.deepEqual(retranslated, [`${row} KJV`])
  } finally {
    live = null
    detector.destroy()
  }
})

test('presenting a verse makes it the place commands step from again', () => {
  const context = (verse: number): LiveScriptureContext =>
    ({ book: 'John', chapter: 3, verseStart: verse, verseEnd: verse, translation: 'KJV', revision: verse })
  assert.equal(pickCommandContext({ context: context(16), at: 5 }, { context: context(1), at: 3 })?.verseStart, 16)
  assert.equal(pickCommandContext({ context: context(16), at: 5 }, { context: context(1), at: 8 })?.verseStart, 1)
  assert.equal(pickCommandContext(null, { context: context(1), at: 8 })?.verseStart, 1)
  assert.equal(pickCommandContext(null, null), null)
})
