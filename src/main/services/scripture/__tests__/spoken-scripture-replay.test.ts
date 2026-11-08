import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { ScriptureDetector, type ScriptureReference } from '../detector'
import { subscribeExplicitScriptureDetection } from '../live-detection-wiring'
import { matchGlobalQuote, retrieveGlobalQuote, wordRarity } from '../global-quote'
import type { TranscriptResult } from '../../../../lib/ipc'

/**
 * Scripture as preachers actually say it, replayed through the live wiring, the
 * local matcher and the bundled Bibles (KJV, BBE, BSB). Speech arrives the way
 * Deepgram finalizes it: in short pieces at each pause. A regression here means
 * a church would see a verse missed, or a verse that was never said.
 */
interface SpokenCase {
  said: string[]
  /** Expected verse, "Book chapter:verse"; `possible` when only a paraphrase match is expected. */
  expect: string | null
  possible?: boolean
}

const CASES: SpokenCase[] = [
  { said: ['For God so loved the world', 'that he gave his only begotten son', 'that whosoever believeth in him'], expect: 'John 3:16' },
  { said: ['For God so loved the world that he gave his only forgotten son'], expect: 'John 3:16' },
  { said: ['I can do all things', 'through Christ which strengtheneth me'], expect: 'Philippians 4:13' },
  { said: ['The Lord is my shepherd', 'I shall not want'], expect: 'Psalms 23:1' },
  { said: ['Trust in the Lord with all thine heart', 'and lean not unto thine own understanding'], expect: 'Proverbs 3:5' },
  { said: ['And we know that all things work together for good', 'to them that love God'], expect: 'Romans 8:28' },
  { said: ['But they that wait upon the Lord', 'shall renew their strength', 'they shall mount up with wings as eagles'], expect: 'Isaiah 40:31' },
  { said: ['Come unto me', 'all ye that labour and are heavy laden', 'and I will give you rest'], expect: 'Matthew 11:28' },
  { said: ['Greater is he that is', 'in you than he that', 'in the world.'], expect: '1 John 4:4' },
  { said: ['Give and it shall be given unto you.', 'Good measure.', 'Pressed down.', 'Shaken together.'], expect: 'Luke 6:38' },
  { said: ['Love not the world', 'neither the things that are in the world'], expect: '1 John 2:15' },
  { said: ['I am the way', 'the truth', 'and the life'], expect: 'John 14:6' },
  { said: ['The thief cometh not but for to steal', 'and to kill and to destroy'], expect: 'John 10:10' },
  { said: ['If only I touch the hem of his garment', 'I shall be made whole.'], expect: 'Matthew 14:36', possible: true },
]

/** Ordinary sermon talk — full of "God", "world", "love" and "life" — must place nothing. */
const ORDINARY: string[][] = [
  ['Good morning church', 'it is so good to see you all here today'],
  ['God wants the very best for your life', 'and he has a plan for you'],
  ['In the world today', 'there is so much fear and so much worry'],
  ['We love you church', 'and we are praying for every one of you'],
  ['Turn to the person next to you', 'and tell them you are blessed'],
  ['The way we treat each other', 'says a lot about what we believe'],
  ['Please turn off your phones', 'and let us stand for the reading'],
  ['If you are visiting for the first time', 'we would love to meet you after the service'],
  ['When I was a young boy', 'my father worked on a farm', 'and we planted corn every spring'],
  ['Our youth camp registration closes on Friday', 'so sign up at the welcome desk'],
  ['God is good all the time', 'and all the time God is good'],
  ['We are going to be here for a while', 'so let us take our time with this'],
  ['He is the one that is with you', 'in the good times and in the bad times'],
]

const db = new Database('resources/bible.db', { readonly: true })
const rarity = wordRarity(db)
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

async function replay(pieces: string[]): Promise<ScriptureReference[]> {
  let final!: (result: TranscriptResult) => void
  const detector = new ScriptureDetector({ apiKey: '' })
  detector.analyze = () => undefined // AI fallback is out of scope: this measures the local path.
  detector.setGeneralQuoteProvider(async (text, possible) =>
    matchGlobalQuote(text, retrieveGlobalQuote(db, text), possible ? rarity : undefined))
  const found: ScriptureReference[] = []
  detector.on('detection', (refs: ScriptureReference[]) => found.push(...refs))
  const stop = subscribeExplicitScriptureDetection(
    { onTranscript: (cb) => { final = cb }, offTranscript() {}, onInterim() {}, offInterim() {} },
    detector,
  )
  try {
    for (const [i, text] of pieces.entries()) {
      final({ text, id: `piece-${i}`, words: [], timestamp: Date.now(), duration: 1, isFinal: true })
      for (let k = 0; k < 4; k++) await tick()
    }
  } finally {
    stop()
    detector.destroy()
  }
  return found
}

const label = (ref: ScriptureReference): string => `${ref.book} ${ref.chapter}:${ref.verseStart}${ref.ambiguous ? '?' : ''}`

for (const spoken of CASES) {
  test(`finds ${spoken.expect} when said as: ${spoken.said.join(' / ')}`, async () => {
    const found = await replay(spoken.said)
    if (spoken.possible) { assert.deepEqual(found, [], 'Paraphrases are not direct quotations'); return }
    const hit = found.find((ref) => `${ref.book} ${ref.chapter}:${ref.verseStart}` === spoken.expect)
    assert.ok(hit, `expected ${spoken.expect}; got ${found.map(label).join(', ') || 'nothing'}`)
    if (!spoken.possible) assert.equal(hit.ambiguous ?? false, false, `${spoken.expect} should be a confident match`)
  })
}

for (const said of ORDINARY) {
  test(`places nothing for: ${said.join(' / ')}`, async () => {
    const found = await replay(said)
    assert.deepEqual(found.map(label), [])
  })
}
