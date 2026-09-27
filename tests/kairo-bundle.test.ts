import assert from 'node:assert/strict'
import test from 'node:test'
import type { LyricsSong, SermonPlan } from '../src/lib/ipc'
import {
  KAIRO_BUNDLE_VERSION,
  bundleFileName,
  mergeKairoBundles,
  parseKairoBundle,
  playlistBundle,
  serializeBundle,
  setlistBundle,
  songsBundle,
} from '../src/lib/kairo-bundle'
import { serializeSongFile } from '../src/lib/workspace'

function song(id: string, title: string): LyricsSong {
  return {
    id,
    title,
    artist: 'Kairo Worship',
    source: 'text',
    sections: [{ type: 'verse', label: 'Verse 1', lines: ['Line one', 'Line two'] }],
    createdAt: 1,
    updatedAt: 2,
  }
}

const plan: SermonPlan = {
  id: 'plan-1',
  title: 'Romans series',
  sourceFileName: 'notes.docx',
  createdAt: 1,
  updatedAt: 2,
  items: [
    {
      id: 'item-1',
      reference: 'Romans 8:28',
      translation: 'NKJV',
      available: true,
      verses: [{ book: 'Romans', chapter: 8, verse: 28, text: 'And we know that all things work together for good' }],
    },
  ],
}

test('a songs bundle round-trips with every song intact', () => {
  const songs = [song('a', 'Amazing Grace'), song('b', 'Way Maker')]
  const bundle = parseKairoBundle(serializeBundle(songsBundle('2 songs', songs, '1.0.0')))
  assert.equal(bundle.kind, 'songs')
  assert.equal(bundle.kairoBundle, KAIRO_BUNDLE_VERSION)
  assert.equal(bundle.appVersion, '1.0.0')
  assert.deepEqual(bundle.songs.map((s) => s.title), ['Amazing Grace', 'Way Maker'])
  assert.deepEqual(bundle.songs[0].sections[0].lines, ['Line one', 'Line two'])
})

test('a setlist bundle keeps service order and drops ids it does not carry', () => {
  const raw = JSON.parse(serializeBundle(setlistBundle('Sunday', [song('b', 'B'), song('a', 'A')])))
  raw.setlist.songIds.push('missing-song')
  const bundle = parseKairoBundle(JSON.stringify(raw))
  assert.equal(bundle.kind, 'setlist')
  assert.deepEqual(bundle.setlist, { name: 'Sunday', songIds: ['b', 'a'] })
})

test('a scripture playlist carries its verse text', () => {
  const bundle = parseKairoBundle(serializeBundle(playlistBundle(plan)))
  assert.equal(bundle.kind, 'scripture-playlist')
  assert.equal(bundle.playlist?.title, 'Romans series')
  assert.equal(bundle.playlist?.items[0].verses[0].text, plan.items[0].verses[0].text)
  assert.equal(bundle.playlist?.items[0].available, true)
})

test('a playlist item without verse text imports as unavailable, not as an error', () => {
  const raw = JSON.parse(serializeBundle(playlistBundle(plan)))
  raw.playlist.items[0].verses = []
  const item = parseKairoBundle(JSON.stringify(raw)).playlist!.items[0]
  assert.equal(item.available, false)
  assert.match(item.error ?? '', /No verse text/)
})

test('a lone .song.json from a Songs folder imports as one song', () => {
  const bundle = parseKairoBundle(serializeSongFile(song('s1', 'Alapanla')))
  assert.equal(bundle.kind, 'songs')
  assert.equal(bundle.songs.length, 1)
  assert.equal(bundle.songs[0].id, 's1')
})

test('duplicate song ids inside one file are read once', () => {
  const raw = JSON.parse(serializeBundle(songsBundle('x', [song('a', 'A')])))
  raw.songs.push(raw.songs[0])
  assert.equal(parseKairoBundle(JSON.stringify(raw)).songs.length, 1)
})

test('unreadable, foreign, empty and future files fail with an operator-facing message', () => {
  assert.throws(() => parseKairoBundle('not json'), /not a Kairo export/)
  assert.throws(() => parseKairoBundle('{"hello":1}'), /not a Kairo export/)
  assert.throws(() => parseKairoBundle('[]'), /not a Kairo export/)
  assert.throws(
    () => parseKairoBundle(JSON.stringify({ kairoBundle: 1, kind: 'songs', songs: [] })),
    /no songs/,
  )
  assert.throws(
    () => parseKairoBundle(JSON.stringify({ kairoBundle: KAIRO_BUNDLE_VERSION + 1, kind: 'songs' })),
    /newer version of Kairo/,
  )
  assert.throws(
    () => parseKairoBundle(JSON.stringify({ kairoBundle: 1, kind: 'themes' })),
    /cannot import/,
  )
})

test('export file names are filesystem-safe and end in .kairo', () => {
  assert.equal(bundleFileName('Sunday service / 3rd Sept'), 'Sunday-service-3rd-Sept.kairo')
})

test('several song files merge into one import, each song once', () => {
  const merged = mergeKairoBundles([
    parseKairoBundle(serializeSongFile(song('a', 'A'))),
    parseKairoBundle(serializeSongFile(song('b', 'B'))),
    parseKairoBundle(serializeBundle(songsBundle('x', [song('a', 'A'), song('c', 'C')]))),
  ])
  assert.equal(merged.kind, 'songs')
  assert.equal(merged.name, '3 songs')
  assert.deepEqual(merged.songs.map((s) => s.id), ['a', 'b', 'c'])
})

test('setlists and playlists do not merge with other files', () => {
  const songs = parseKairoBundle(serializeSongFile(song('a', 'A')))
  const list = parseKairoBundle(serializeBundle(setlistBundle('Sunday', [song('b', 'B')])))
  assert.throws(() => mergeKairoBundles([songs, list]), /one file at a time/)
  assert.equal(mergeKairoBundles([list]), list)
})
