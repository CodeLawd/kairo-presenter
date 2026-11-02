import { promises as fs } from 'fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'path'
import { shell } from 'electron'
import log from 'electron-log/main'
import type { TracksLibrary, TracksSettings, TrackItem } from '@shared/ipc'
import { isTrackExtension, siblingAudioFolder, trackFileName } from '@shared/tracks'
import { store } from '../../db'
import { uniqueFileName, isInsideRoot } from '../media'

const MAX_DEPTH = 1

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

function readSettings(): TracksSettings {
  const raw = store.get('tracks') as Partial<TracksSettings> | undefined
  return { folder: typeof raw?.folder === 'string' ? raw.folder : '' }
}

function itemIdFor(root: string, absPath: string): string {
  return relative(root, absPath).split(sep).join('/')
}

class TracksService {
  private items: TrackItem[] = []
  private scanError: string | null = null
  private liveId: string | null = null
  private livePaused = false
  private listeners = new Set<(library: TracksLibrary) => void>()

  onChange(listener: (library: TracksLibrary) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    const library = this.getLibrary()
    for (const listener of this.listeners) {
      try {
        listener(library)
      } catch (err) {
        log.warn('[Tracks] listener threw', (err as Error).message)
      }
    }
  }

  getLibrary(): TracksLibrary {
    return {
      folder: this.root,
      items: this.items,
      liveId: this.liveId,
      livePaused: this.livePaused,
      error: this.scanError,
    }
  }

  private get root(): string {
    return readSettings().folder
  }

  allowedRoot(): string | null {
    const root = this.root
    return root ? resolve(root) : null
  }

  async ensureFolder(): Promise<string> {
    let folder = this.root
    if (!folder) {
      const media = store.get('media')?.folder
      if (typeof media === 'string' && media) {
        folder = siblingAudioFolder(media)
        store.set('tracks', { folder })
      }
    }
    if (!folder) throw new Error('Choose a backgrounds folder first — audio is kept next to it.')
    await fs.mkdir(folder, { recursive: true })
    return folder
  }

  async setFolder(folder: string): Promise<TracksLibrary> {
    store.set('tracks', { folder })
    this.liveId = null
    this.livePaused = false
    return this.scan()
  }

  async scan(): Promise<TracksLibrary> {
    let root = this.root
    if (!root) {
      const media = store.get('media')?.folder
      if (typeof media === 'string' && media) {
        root = siblingAudioFolder(media)
        store.set('tracks', { folder: root })
      }
    }
    if (!root) {
      this.items = []
      this.scanError = null
      this.emit()
      return this.getLibrary()
    }

    try {
      await fs.mkdir(root, { recursive: true })
      this.items = await this.walk(root, root, 0)
      this.scanError = null
      if (this.liveId && !this.items.some((item) => item.id === this.liveId)) {
        this.liveId = null
        this.livePaused = false
      }
    } catch (err) {
      this.items = []
      this.scanError = (err as Error).message
      log.warn('[Tracks] Scan failed', this.scanError)
    }
    this.emit()
    return this.getLibrary()
  }

  private async walk(root: string, dir: string, depth: number): Promise<TrackItem[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const items: TrackItem[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) items.push(...(await this.walk(root, abs, depth + 1)))
        continue
      }
      const ext = extname(entry.name).slice(1).toLowerCase()
      if (!isTrackExtension(ext)) continue
      const stat = await fs.stat(abs)
      items.push({
        id: itemIdFor(root, abs),
        name: basename(entry.name, extname(entry.name)),
        path: abs,
        ext,
        size: stat.size,
      })
    }
    items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    return items
  }

  async importFiles(sourcePaths: string[]): Promise<TracksLibrary> {
    const root = await this.ensureFolder()
    const taken = new Set((await fs.readdir(root)).map((name) => name.toLowerCase()))
    let imported = 0
    for (const source of sourcePaths) {
      const ext = extname(source).slice(1).toLowerCase()
      if (!isTrackExtension(ext)) continue
      const abs = resolve(source)
      if (isInsideRoot(abs, root)) {
        imported += 1
        continue
      }
      const destName = uniqueFileName(basename(source), taken)
      await fs.copyFile(abs, join(root, destName))
      taken.add(destName.toLowerCase())
      imported += 1
      log.info('[Tracks] Copied into library', { from: abs, dest: destName })
    }
    if (imported === 0) throw new Error('None of those files are audio we can play.')
    return this.scan()
  }

  /**
   * Takes a track out of the library by moving its file to the system Trash —
   * the folder is the library, so hiding it from the list would only last until
   * the next scan. Undo lives in the Finder/Explorer Trash.
   */
  async remove(id: string): Promise<TracksLibrary> {
    const item = this.items.find((candidate) => candidate.id === id)
    if (!item) throw new Error('That track is no longer in the folder.')
    const root = this.allowedRoot()
    if (!root || !isInsideRoot(item.path, root)) throw new Error('That track is outside the audio folder.')
    if (this.liveId === id) {
      this.liveId = null
      this.livePaused = false
      // Tell the player first, then give it a moment to close the file — on
      // Windows a file still open in the audio element cannot be trashed.
      this.emit()
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    try {
      await shell.trashItem(item.path)
      log.info('[Tracks] Moved to Trash', { path: item.path })
    } catch (err) {
      // Already gone (deleted in Finder): still rescan so the row disappears.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    return this.scan()
  }

  /**
   * Renames the file itself, keeping its folder and extension — the library is
   * a folder scan, so a name held only in memory would vanish on the next scan.
   */
  async rename(id: string, nextName: string): Promise<TracksLibrary> {
    const item = this.items.find((candidate) => candidate.id === id)
    if (!item) throw new Error('That track is no longer in the folder.')
    const root = this.allowedRoot()
    if (!root || !isInsideRoot(item.path, root)) throw new Error('That track is outside the audio folder.')
    // Keep the extension exactly as the file has it, including its case.
    const fileExt = extname(item.path).slice(1) || item.ext
    const name = trackFileName(nextName, fileExt)
    if (!name) throw new Error('Give the track a name.')
    const target = join(dirname(item.path), `${name}.${fileExt}`)
    if (resolve(target) === resolve(item.path)) return this.getLibrary()
    if (!isInsideRoot(target, root)) throw new Error('That name cannot be used here.')
    // A case-only rename on a case-insensitive disk finds the same file, not a clash.
    const caseOnly = resolve(target).toLowerCase() === resolve(item.path).toLowerCase()
    if (!caseOnly && (await exists(target))) throw new Error(`A file called “${name}.${fileExt}” is already in that folder.`)
    const wasLive = this.liveId === id
    const wasPaused = this.livePaused
    if (wasLive) {
      // The player holds the file open; let it pause before the rename.
      this.livePaused = true
      this.emit()
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    try {
      await fs.rename(item.path, target)
    } catch (err) {
      if (wasLive) {
        this.livePaused = wasPaused
        this.emit()
      }
      throw err
    }
    if (wasLive) {
      this.liveId = itemIdFor(root, target)
      this.livePaused = wasPaused
    }
    log.info('[Tracks] Renamed', { from: item.path, to: target })
    return this.scan()
  }

  /** Shows the track in Finder / Explorer. */
  reveal(id: string): void {
    const item = this.items.find((candidate) => candidate.id === id)
    if (!item) throw new Error('That track is no longer in the folder.')
    shell.showItemInFolder(item.path)
  }

  play(id: string): TracksLibrary {
    const item = this.items.find((candidate) => candidate.id === id)
    if (!item) throw new Error('That track is no longer in the folder.')
    this.liveId = id
    this.livePaused = false
    this.emit()
    return this.getLibrary()
  }

  setPaused(paused: boolean): TracksLibrary {
    if (!this.liveId) {
      this.livePaused = false
      this.emit()
      return this.getLibrary()
    }
    this.livePaused = paused
    this.emit()
    return this.getLibrary()
  }

  stop(): TracksLibrary {
    this.liveId = null
    this.livePaused = false
    this.emit()
    return this.getLibrary()
  }
}

export const tracksService = new TracksService()
