import assert from 'node:assert/strict'
import test from 'node:test'
import { followUpContext, isOnScreen, parseScriptureVoiceCommand, readingTranslation, ScriptureVoiceNavigation, type LiveScriptureContext } from '../src/main/services/scripture/voice-navigation'
import type { ScriptureSuggestion, ScriptureVerse, TranscriptResult } from '../src/lib/ipc'
const final = (text: string, id = text): TranscriptResult => ({ text, id, words: [], timestamp: 0, duration: 1, isFinal: true })
for (const text of ['do not go to the next verse', 'next verse is what he said', 'next verse no stay here', 'switch to KJV but not yet']) {
  test(`does not navigate narration or corrections: ${text}`, () => assert.equal(parseScriptureVoiceCommand(text), null))
}
test('parses whole commands and spelled translation letters', () => {
  assert.deepEqual(parseScriptureVoiceCommand('Next verse.'), { direction: 1 })
  assert.deepEqual(parseScriptureVoiceCommand('Go back to the previous verse.'), { direction: -1 })
  assert.deepEqual(parseScriptureVoiceCommand('Switch to K J V.'), { translation: 'KJV' })
})
function harness(autoMode = false, chapterLookup?: (book: string, chapter: number) => Promise<ScriptureVerse[]>) {
  let current: LiveScriptureContext | null = { book: 'John', chapter: 3, verseStart: 16, verseEnd: 16, translation: 'KJV', revision: 1 }
  const presented: ScriptureSuggestion[] = [], suggested: ScriptureSuggestion[] = []
  const errors: unknown[] = []
  const navigation = new ScriptureVoiceNavigation({ enabled: () => true, autoMode: () => autoMode,
    current: () => current,
    chapter: chapterLookup ?? (async (book, chapter) => [16, 17, 18].map(verse => ({ book, chapter, verse, text: `text ${verse}` }))),
    present: async s => { presented.push(s); current = { ...current!, verseStart: s.verses[0].verse, verseEnd: s.verses[0].verse, revision: current!.revision + 1 } },
    suggest: s => suggested.push(s), error: e => errors.push(e),
  })
  return { navigation, presented, suggested, errors, clear: () => { current = null } }
}
test('manual commands suggest once without presenting', async () => {
  const h = harness(); h.navigation.claim(final('Next verse', 'same')); h.navigation.claim(final('Next verse', 'same'))
  await h.navigation.settled(); assert.equal(h.suggested.length, 1); assert.equal(h.suggested[0].reference, 'John 3:17'); assert.equal(h.presented.length, 0)
})
test('a stopped session cannot finish an old command', async () => {
  const h = harness(true); h.navigation.claim(final('Next verse')); h.navigation.reset(); await h.navigation.settled(); assert.equal(h.presented.length, 0)
})
test('removing live scripture invalidates queued command', async () => {
  const h = harness(true); h.navigation.claim(final('Next verse')); h.clear(); await h.navigation.settled(); assert.equal(h.presented.length, 0)
})
test('two distinct queued commands advance twice', async () => {
  const h = harness(true); h.navigation.claim(final('Next verse', 'one')); h.navigation.claim(final('Next verse', 'two'))
  await h.navigation.settled(); assert.deepEqual(h.presented.map(s => s.reference), ['John 3:17', 'John 3:18'])
})

test('next crosses chapters using the actual available verse numbers', async () => {
  const h = harness(false, async (book, chapter) => (chapter === 3 ? [16] : [1, 3]).map(verse => ({ book, chapter, verse, text: 'verse' })))
  h.navigation.claim(final('Next verse')); await h.navigation.settled()
  assert.equal(h.suggested[0].reference, 'John 4:1'); assert.equal(h.suggested[0].translation, 'KJV')
})
test('an unavailable adjacent chapter leaves program unchanged', async () => {
  const h = harness(true, async (book, chapter) => chapter === 3 ? [{ book, chapter, verse: 16, text: 'verse' }] : [])
  h.navigation.claim(final('Next verse')); await h.navigation.settled(); assert.equal(h.presented.length, 0)
})
test('a program cleared while the lookup is pending cannot be overwritten', async () => {
  let finish!: (verses: ScriptureVerse[]) => void
  const h = harness(true, () => new Promise(resolve => { finish = resolve }))
  h.navigation.claim(final('Next verse')); await Promise.resolve(); h.clear()
  finish([{ book: 'John', chapter: 3, verse: 17, text: 'verse' }])
  await h.navigation.settled(); assert.equal(h.presented.length, 0)
})
test('the same offset on a new provider connection is a fresh command',async()=>{
 const h=harness(true)
 h.navigation.claim({...final('Next verse','one'),audioStart:0,audioEpoch:1})
 await h.navigation.settled()
 h.navigation.claim({...final('Next verse','two'),audioStart:0,audioEpoch:2})
 await h.navigation.settled()
 assert.deepEqual(h.presented.map(s=>s.reference),['John 3:17','John 3:18'])
})

for (const [text, direction] of [
  ['Okay, next verse.', 1], ["Let's go to the next verse.", 1], ['Read the next verse, please.', 1], ['And next verse.', 1],
  ['Alright, previous verse.', -1], ['Go back a verse.', -1], ["Let's go back to the previous verse.", -1], ['Back to the previous verse.', -1],
] as const) {
  test(`accepts a natural command: ${text}`, () => assert.deepEqual(parseScriptureVoiceCommand(text), { direction }))
}
test('a detected passage is a starting point for the next command, spanning its verses', () => {
  const verse = (n: number): ScriptureVerse => ({ book: 'Matthew', chapter: 1, verse: n, text: `v${n}` })
  const suggestion = { id: 's', reference: 'Matthew 1:8-9', verses: [verse(8), verse(9)], translation: 'NKJV', confidence: 1, source: 'auto' } as ScriptureSuggestion
  assert.deepEqual(followUpContext(suggestion, -3), { book: 'Matthew', chapter: 1, verseStart: 8, verseEnd: 9, translation: 'NKJV', revision: -3, passageId: 's', passageIndex: 0 })
  assert.equal(followUpContext({ ...suggestion, ambiguous: true }, -4), null)
  assert.equal(followUpContext({ ...suggestion, verses: [] }, -5), null)
})
for (const [text, direction] of [
  ['Next.', 1], ['Next one.', 1], ['Go on.', 1], ['Continue.', 1], ['Keep going.', 1], ['Carry on.', 1],
  ['Move on.', 1], ['Following verse.', 1], ['And the next one.', 1], ['Okay, go on.', 1],
  ['Previous.', -1], ['Previous one.', -1], ['Back.', -1], ['Back one.', -1], ['The verse before.', -1], ['Go back one.', -1],
] as const) {
  test(`accepts a short command: ${text}`, () => assert.deepEqual(parseScriptureVoiceCommand(text), { direction }))
}
for (const text of ['Next week we will look at Romans.', 'Go on and tell your neighbour.', 'Continue to pray for the family.', 'Back in the day.']) {
  test(`does not treat narration as a command: ${text}`, () => assert.equal(parseScriptureVoiceCommand(text), null))
}

const johnFiveAmpc: LiveScriptureContext = { book: 'John', chapter: 5, verseStart: 30, verseEnd: 30, translation: 'AMPC', revision: 1 }
test('a detected verse follows the translation being read in the same passage', () => {
  assert.equal(readingTranslation(johnFiveAmpc, { book: 'John', chapter: 5 }), 'AMPC')
  // Reading on into the next chapter keeps the translation.
  assert.equal(readingTranslation(johnFiveAmpc, { book: 'John', chapter: 6 }), 'AMPC')
})
test('a verse elsewhere takes the default translation, not the one on screen', () => {
  assert.equal(readingTranslation(johnFiveAmpc, { book: 'Romans', chapter: 5 }), null)
  assert.equal(readingTranslation(johnFiveAmpc, { book: 'John', chapter: 14 }), null)
  assert.equal(readingTranslation(null, { book: 'John', chapter: 5 }), null)
})
test('the verse already on screen in the same translation is not suggested again', () => {
  assert.equal(isOnScreen(johnFiveAmpc, { book: 'John', chapter: 5, verseStart: 30 }, 'AMPC'), true)
  assert.equal(isOnScreen(johnFiveAmpc, { book: 'John', chapter: 5, verseStart: 30 }, 'NKJV'), false)
  assert.equal(isOnScreen(johnFiveAmpc, { book: 'John', chapter: 5, verseStart: 31 }, 'AMPC'), false)
  assert.equal(isOnScreen(null, { book: 'John', chapter: 5, verseStart: 30 }, 'AMPC'), false)
})
