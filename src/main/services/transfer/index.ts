import { randomUUID } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import log from 'electron-log/main'
import {
  KAIRO_BUNDLE_EXT,
  KAIRO_BUNDLE_MAX_BYTES,
  bundleFileName,
  mergeKairoBundles,
  parseKairoBundle,
  playlistBundle,
  serializeBundle,
  setlistBundle,
  songsBundle,
  type KairoBundle,
  type TransferCommitRequest,
  type TransferCommitResult,
  type TransferExportRequest,
  type TransferExportResult,
  type TransferPreview,
} from '@shared/kairo-bundle'
import { findDuplicate } from '@shared/lyrics-duplicate'
import type { LyricsSong } from '@shared/ipc'
import { lyricsService } from '../lyrics'
import { setlistService } from '../setlist'
import { sermonPlanStore } from '../scripture/sermon-plans'
import { livePlanService } from '../scripture/live-plan'

const OPEN_FILTERS = [
  { name: 'Kairo files', extensions: ['kairo', 'json'] },
]

/**
 * `.kairo` export and import.
 *
 * Main gathers what to export itself, from the authoritative stores, so the
 * renderer only ever names *which* songs or list — never ships their content.
 * On import the parsed bundle stays here under a token while the operator
 * reviews it; the renderer sends back decisions, not data.
 */
class TransferService {
  private pending = new Map<string, { bundle: KairoBundle; fileName: string }>()

  private window(): BrowserWindow | undefined {
    return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  }

  // ─── Export ─────────────────────────────────────────────────────────────────

  private buildBundle(request: TransferExportRequest): KairoBundle {
    const version = app.getVersion()
    const library = lyricsService.getLibrary()
    const byId = new Map(library.map((song) => [song.id, song]))
    const pick = (ids: string[]): LyricsSong[] =>
      ids.map((id) => byId.get(id)).filter((song): song is LyricsSong => song !== undefined)

    switch (request.kind) {
      case 'library':
        if (library.length === 0) throw new Error('The song library is empty.')
        return songsBundle(`All songs (${library.length})`, library, version)

      case 'songs': {
        const songs = pick(request.songIds)
        if (songs.length === 0) throw new Error('Choose at least one song to export.')
        const name = request.name?.trim()
          || (songs.length === 1 ? songs[0].title : `${songs.length} songs`)
        return songsBundle(name, songs, version)
      }

      case 'setlist': {
        const list = setlistService.snapshot().lists.find((item) => item.id === request.listId)
        if (!list) throw new Error('That setlist no longer exists.')
        return setlistBundle(list.name, pick(list.songIds), version)
      }

      case 'playlist': {
        const plan = sermonPlanStore.get(request.planId)
        if (!plan) throw new Error('That playlist no longer exists.')
        return playlistBundle(plan, version)
      }
    }
  }

  async export(request: TransferExportRequest): Promise<TransferExportResult> {
    const bundle = this.buildBundle(request)
    const win = this.window()
    const options: Electron.SaveDialogOptions = {
      title: 'Export to a Kairo file',
      defaultPath: bundleFileName(bundle.name),
      filters: [{ name: 'Kairo file', extensions: ['kairo'] }],
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { saved: false }

    const filePath = result.filePath.endsWith(KAIRO_BUNDLE_EXT)
      ? result.filePath
      : `${result.filePath}${KAIRO_BUNDLE_EXT}`
    await writeFile(filePath, serializeBundle(bundle), 'utf8')
    log.info('[Transfer] Exported', {
      kind: bundle.kind,
      songs: bundle.songs.length,
      playlistItems: bundle.playlist?.items.length ?? 0,
    })
    return { saved: true, fileName: basename(filePath) }
  }

  // ─── Import ─────────────────────────────────────────────────────────────────

  async pickAndPreview(): Promise<TransferPreview | null> {
    const win = this.window()
    const options: Electron.OpenDialogOptions = {
      title: 'Import Kairo files',
      message: 'Choose a .kairo file, or select several song files at once.',
      properties: ['openFile', 'multiSelections'],
      filters: OPEN_FILTERS,
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return this.previewFiles(result.filePaths)
  }

  private async readBundle(filePath: string): Promise<KairoBundle> {
    const info = await stat(filePath)
    if (info.size > KAIRO_BUNDLE_MAX_BYTES) throw new Error('This file is too large to be a Kairo export.')
    return parseKairoBundle(await readFile(filePath, 'utf8'))
  }

  async previewFile(filePath: string): Promise<TransferPreview> {
    return this.previewFiles([filePath])
  }

  /**
   * One review for any number of files. A file that cannot be read is listed
   * and skipped rather than failing the batch — one stray JSON file in a
   * folder of songs should not block the other hundred.
   */
  async previewFiles(filePaths: string[]): Promise<TransferPreview> {
    const bundles: KairoBundle[] = []
    const skippedFiles: { fileName: string; error: string }[] = []
    for (const filePath of filePaths) {
      try {
        bundles.push(await this.readBundle(filePath))
      } catch (err) {
        skippedFiles.push({ fileName: basename(filePath), error: (err as Error).message })
      }
    }
    if (bundles.length === 0) {
      throw new Error(
        filePaths.length === 1
          ? skippedFiles[0].error
          : `None of the ${filePaths.length} files could be read. ${skippedFiles[0].error}`,
      )
    }
    const bundle = mergeKairoBundles(bundles)
    const fileName = filePaths.length === 1 ? basename(filePaths[0]) : `${filePaths.length} files`
    const token = randomUUID()
    this.pending.set(token, { bundle, fileName })

    const library = lyricsService.getLibrary()
    const byId = new Map(library.map((song) => [song.id, song]))
    const preview: TransferPreview = {
      token,
      fileName,
      kind: bundle.kind,
      name: bundle.name,
      exportedAt: bundle.exportedAt,
      ...(skippedFiles.length > 0 ? { skippedFiles } : {}),
      songs: bundle.songs.map((song) => {
        // Same id means it came from this library (or a copy of it) — the
        // strongest signal there is, ahead of title and lyric matching.
        const sameId = byId.get(song.id)
        return {
          id: song.id,
          title: song.title,
          artist: song.artist ?? '',
          sectionCount: song.sections.length,
          duplicate: sameId
            ? { songId: sameId.id, title: sameId.title, artist: sameId.artist ?? '', reason: 'same-song' }
            : findDuplicate(song, library),
        }
      }),
    }
    if (bundle.setlist) {
      preview.setlist = { name: bundle.setlist.name, songCount: bundle.setlist.songIds.length }
    }
    if (bundle.playlist) {
      preview.playlist = {
        title: bundle.playlist.title,
        itemCount: bundle.playlist.items.length,
        exists: sermonPlanStore.get(bundle.playlist.id) !== null,
      }
    }
    return preview
  }

  discard(token: string): void {
    this.pending.delete(token)
  }

  commit(request: TransferCommitRequest): TransferCommitResult {
    const entry = this.pending.get(request.token)
    if (!entry) throw new Error('This import has expired. Open the file again.')
    this.pending.delete(request.token)
    const { bundle } = entry

    const library = lyricsService.getLibrary()
    const byId = new Map(library.map((song) => [song.id, song]))
    const result: TransferCommitResult = { added: 0, replaced: 0, skipped: 0 }
    /** Bundle song id → the library id it ended up as (for the setlist). */
    const landed = new Map<string, string>()

    for (const song of bundle.songs) {
      const choice = request.songs[song.id] ?? 'skip'
      const match = byId.has(song.id)
        ? byId.get(song.id)!
        : (() => {
            const found = findDuplicate(song, library)
            return found ? byId.get(found.songId) : undefined
          })()

      if (choice === 'skip') {
        result.skipped++
        if (match) landed.set(song.id, match.id)
        continue
      }
      if (choice === 'replace' && match) {
        const updated = lyricsService.updateSong(match.id, { ...song, id: match.id })
        if (updated) {
          result.replaced++
          landed.set(song.id, match.id)
        }
        continue
      }
      // 'add', 'keep-both', or a 'replace' whose target vanished. A fresh id
      // whenever the original is already taken, so nothing is overwritten.
      const saved = lyricsService.addImportedSong(song, { freshId: byId.has(song.id) })
      result.added++
      landed.set(song.id, saved.id)
    }

    if (bundle.setlist && request.createSetlist) {
      const songIds = bundle.setlist.songIds
        .map((id) => landed.get(id))
        .filter((id): id is string => Boolean(id))
      result.setlistName = setlistService.importList(bundle.setlist.name, songIds).name
    }

    if (bundle.playlist && request.playlist && request.playlist !== 'skip') {
      const incoming = bundle.playlist
      const exists = sermonPlanStore.get(incoming.id) !== null
      const plan =
        request.playlist === 'replace' || !exists
          ? incoming
          : { ...incoming, id: randomUUID(), title: `${incoming.title} (imported)`, createdAt: Date.now() }
      const saved = sermonPlanStore.save(plan)
      livePlanService.refresh(saved.id)
      result.playlistTitle = saved.title
    }

    log.info('[Transfer] Imported', { file: entry.fileName, kind: bundle.kind, ...result })
    return result
  }
}

export const transferService = new TransferService()
