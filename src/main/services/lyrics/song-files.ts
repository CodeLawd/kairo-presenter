/**
 * The song library on disk: one JSON file per song under `<workspace>/Songs`.
 *
 * These files are the library's source of truth. SQLite still holds the songs
 * for search and fast reads, but it is rebuilt from this folder on launch, so
 * a song the operator deletes in Finder is gone and one they drop in appears.
 * Writes are synchronous because every caller is already inside a DB
 * transaction boundary and a half-written library is worse than a slow save.
 */

import fs from 'fs'
import path from 'path'
import log from 'electron-log/main'
import type { LyricsSong } from '@shared/ipc'
import {
  isSongFileName,
  parseSongFile,
  serializeSongFile,
  songFileName,
  songIdFromFileName,
} from '@shared/workspace'

export interface SongFileEntry {
  song: LyricsSong
  /** Absolute path the song was read from. */
  file: string
}

/** Every readable song in the folder. Unreadable files are logged and skipped. */
export function readSongFiles(songsDir: string): SongFileEntry[] {
  let names: string[]
  try {
    names = fs.readdirSync(songsDir)
  } catch {
    return []
  }

  const entries: SongFileEntry[] = []
  for (const name of names) {
    if (!isSongFileName(name)) continue
    const file = path.join(songsDir, name)
    try {
      const raw = fs.readFileSync(file, 'utf8')
      const song = parseSongFile(raw, songIdFromFileName(name) ?? '')
      if (!song) {
        log.warn('[SongFiles] Skipped unreadable song file', { file })
        continue
      }
      entries.push({ song, file })
    } catch (err) {
      log.warn('[SongFiles] Could not read song file', { file, error: (err as Error).message })
    }
  }
  return entries
}

/** Path of the file currently holding `songId`, or null when there is none. */
export function findSongFile(songsDir: string, songId: string): string | null {
  let names: string[]
  try {
    names = fs.readdirSync(songsDir)
  } catch {
    return null
  }
  for (const name of names) {
    if (!isSongFileName(name)) continue
    if (songIdFromFileName(name) === songId) return path.join(songsDir, name)
  }
  return null
}

/**
 * Writes the song, renaming its file when the title changed so the folder
 * keeps reading like a song list rather than a pile of ids.
 */
export function writeSongFile(songsDir: string, song: LyricsSong): string | null {
  const target = path.join(songsDir, songFileName(song))
  try {
    fs.mkdirSync(songsDir, { recursive: true })
    const existing = findSongFile(songsDir, song.id)
    fs.writeFileSync(target, serializeSongFile(song), 'utf8')
    if (existing && existing !== target) {
      fs.rmSync(existing, { force: true })
    }
    return target
  } catch (err) {
    log.error('[SongFiles] Could not write song file', {
      id: song.id,
      title: song.title,
      error: (err as Error).message,
    })
    return null
  }
}

/** Removes the song's file. Missing file counts as success — the goal is absence. */
export function deleteSongFile(songsDir: string, songId: string): boolean {
  const file = findSongFile(songsDir, songId)
  if (!file) return true
  try {
    fs.rmSync(file, { force: true })
    return true
  } catch (err) {
    log.error('[SongFiles] Could not delete song file', { file, error: (err as Error).message })
    return false
  }
}
