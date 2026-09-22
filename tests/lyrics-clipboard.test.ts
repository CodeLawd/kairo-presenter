import assert from 'node:assert/strict'
import test from 'node:test'

import {
  hasSongMetadata,
  liftHeadingTitle,
  looksLikeLyrics,
  parseClipboardSong,
} from '../src/lib/lyrics-clipboard'

const GENIUS = [
  '37 Contributors',
  'Translations',
  'Way Maker Lyrics',
  '[Verse 1]',
  'You are here, moving in our midst',
  'I worship You, I worship You',
  '',
  '[Chorus]',
  'Way maker, miracle worker',
  'Promise keeper, light in the darkness',
  'You might also like',
  'My God, that is who You are12345Embed',
].join('\n')

test('parseClipboardSong lifts the title out of the Genius heading', () => {
  const draft = parseClipboardSong(GENIUS)
  assert.ok(draft)
  assert.equal(draft.title, 'Way Maker')
})

test('parseClipboardSong drops contributor, translation and promo chrome', () => {
  const draft = parseClipboardSong(GENIUS)
  assert.ok(draft)
  assert.ok(!draft.text.includes('Contributors'))
  assert.ok(!draft.text.includes('Translations'))
  assert.ok(!draft.text.includes('You might also like'))
})

test('parseClipboardSong strips the trailing Embed counter', () => {
  const draft = parseClipboardSong(GENIUS)
  assert.ok(draft)
  assert.ok(draft.text.trimEnd().endsWith('My God, that is who You are'))
})

test('parseClipboardSong keeps section headers intact', () => {
  const draft = parseClipboardSong(GENIUS)
  assert.ok(draft)
  assert.ok(draft.text.includes('[Verse 1]'))
  assert.ok(draft.text.includes('[Chorus]'))
})

test('parseClipboardSong splits an "Artist - Title lyrics" heading', () => {
  const draft = parseClipboardSong(
    ['Sinach - Way Maker lyrics', 'Line one', 'Line two', 'Line three', 'Line four'].join('\n')
  )
  assert.ok(draft)
  assert.equal(draft.artist, 'Sinach')
  assert.equal(draft.title, 'Way Maker')
})

test('parseClipboardSong pulls a byline and a copyright line out of the body', () => {
  const draft = parseClipboardSong(
    ['Great Is Thy Faithfulness Lyrics', 'by Thomas Chisholm', '© 1923 Hope Publishing', 'Line one', 'Line two', 'Line three', 'Line four'].join('\n')
  )
  assert.ok(draft)
  assert.equal(draft.artist, 'Thomas Chisholm')
  assert.equal(draft.copyright, '© 1923 Hope Publishing')
  assert.ok(!draft.text.includes('Hope Publishing'))
})

test('parseClipboardSong counts lyric lines, not section headers', () => {
  const draft = parseClipboardSong(GENIUS)
  assert.ok(draft)
  assert.equal(draft.lineCount, 5)
})

test('parseClipboardSong returns null when nothing survives cleaning', () => {
  assert.equal(parseClipboardSong('37 Contributors\nTranslations\n'), null)
  assert.equal(parseClipboardSong('   '), null)
})

test('looksLikeLyrics rejects a bare URL or a one-liner', () => {
  assert.equal(looksLikeLyrics('https://genius.com/some-song-lyrics'), false)
  assert.equal(looksLikeLyrics('Way Maker'), false)
  assert.equal(looksLikeLyrics(GENIUS), true)
})

// ─── liftHeadingTitle ─────────────────────────────────────────────────────────
// Documents people type themselves (an RTF song sheet, a .txt file) carry no
// metadata — just the song name, and often the artist, on the first lines.

test('a short opening line above a blank line is the title', () => {
  const { title, artist, text } = liftHeadingTitle('Way Maker\n\nYou are here\nMoving in our midst')
  assert.equal(title, 'Way Maker')
  assert.equal(artist, '')
  assert.equal(text, 'You are here\nMoving in our midst')
})

test('a title and an artist stacked above a blank line are both lifted', () => {
  const { title, artist, text } = liftHeadingTitle('WAY MAKER\nSinach\n\nVerse 1\nYou are here')
  assert.equal(title, 'WAY MAKER')
  assert.equal(artist, 'Sinach')
  assert.equal(text, 'Verse 1\nYou are here')
})

test('a first line that runs straight into the lyrics is not a title', () => {
  const input = 'You are here moving\nin our midst'
  assert.deepEqual(liftHeadingTitle(input), { title: '', artist: '', text: input })
})

test('a section header is structure, not a name', () => {
  const input = '[Verse 1]\n\nYou are here'
  assert.deepEqual(liftHeadingTitle(input), { title: '', artist: '', text: input })
})

test('a long opening line is a lyric, however it is spaced', () => {
  const input = 'I will sing of the mercies of the Lord forever and ever more amen\n\nAnd again'
  assert.deepEqual(liftHeadingTitle(input), { title: '', artist: '', text: input })
})

test('a document with nothing after the heading keeps its text', () => {
  const input = 'Way Maker\n\n'
  assert.deepEqual(liftHeadingTitle(input), { title: '', artist: '', text: input })
})

test('two lines with no blank after them are lyrics, not a heading pair', () => {
  const input = 'Jesus you are\nthe one I love\nforever more'
  assert.deepEqual(liftHeadingTitle(input), { title: '', artist: '', text: input })
})

// ─── hasSongMetadata ──────────────────────────────────────────────────────────
// Routing a plain lyrics file through the SongSelect parser is what produced a
// library of "Untitled": that parser reads a header the file does not have.

test('a SongSelect-style header is recognised, with either separator', () => {
  assert.equal(hasSongMetadata('Title=Way Maker\nAuthor=Sinach\n\nYou are here'), true)
  assert.equal(hasSongMetadata('Title: Way Maker\n\nYou are here'), true)
  assert.equal(hasSongMetadata('CCLI Song Number: 7115744\n\nYou are here'), true)
})

test('a plain lyrics file has no header', () => {
  assert.equal(hasSongMetadata('Way Maker\n\nYou are here\nMoving in our midst'), false)
  assert.equal(hasSongMetadata('[Verse 1]\nYou are here'), false)
})

test('a lyric line that happens to contain a colon is not a header', () => {
  assert.equal(hasSongMetadata('Chorus: sing it loud\nAgain and again'), false)
})

test('a copyright line at the foot of a sheet does not make it an export', () => {
  const song = ['Way Maker', '', 'You are here', '', '', '', '', '', '', 'Copyright: 2015 Integrity']
  assert.equal(hasSongMetadata(song.join('\n')), false)
})
