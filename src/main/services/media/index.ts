import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'path'
import log from 'electron-log/main'
import type {
  MediaFolder,
  MediaItem,
  MediaKind,
  MediaLibrary,
  MediaPlayback,
  MediaPlaylist,
  MediaSettings,
} from '@shared/ipc'
import { store } from '../../db'
import {
  isDefaultMediaPlayback,
  normalizeMediaPlayback,
  normalizePlaybackMap,
} from '@shared/media-playback'

// ─── What counts as a background ──────────────────────────────────────────────
// Chromium decodes these; anything else in the folder is ignored rather than
// listed as broken. `.mov` is deliberately included even though ProRes inside a
// .mov will not decode — the container is common enough that hiding it would
// look like the scan missed files. The dock flags the ones that fail to load.

const VIDEO_EXT = new Set(['mp4', 'webm', 'm4v', 'mov', 'ogv'])
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'])

/** Native file-picker extensions — kept in lockstep with what the scan accepts. */
export const MEDIA_FILE_EXTENSIONS = [...VIDEO_EXT, ...IMAGE_EXT]

/** Subfolders are one level deep — a media folder is a shelf, not a tree. */
const MAX_DEPTH = 1

/**
 * Playlists live WITH the media, not in app settings.
 *
 * Copy the folder to the other booth machine and the playlists come along;
 * reinstall the app and they survive. It is the only thing written into the
 * user's media folder, it is a dotfolder, and it never moves or renames their
 * files — a playlist references media, it does not contain it. That matters
 * because ProPresenter tracks the same files BY PATH: reorganising the folder
 * to make playlists physical would break every PP reference into it.
 */
const MANIFEST_DIR = '.proautomate'
const MANIFEST_FILE = 'playlists.json'
const MANIFEST_VERSION = 1

function kindOf(ext: string): MediaKind | null {
  if (VIDEO_EXT.has(ext)) return 'video'
  if (IMAGE_EXT.has(ext)) return 'image'
  return null
}

/**
 * An item's identity is its path RELATIVE to the media root, in posix form.
 *
 * Not an absolute-path hash: that changed whenever the folder itself moved, so
 * copying a library to another machine silently emptied every playlist. Relative
 * keeps ids stable across machines, and makes the manifest readable by a human
 * who opens it.
 */
function itemIdFor(root: string, absPath: string): string {
  return relative(root, absPath).split(sep).join('/')
}

function newPlaylistId(): string {
  return `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** The pre-manifest id scheme, kept only to migrate old settings-stored playlists. */
function legacyItemId(absPath: string): string {
  return createHash('sha1').update(resolve(absPath)).digest('hex').slice(0, 16)
}

function isPlaylist(value: unknown): value is MediaPlaylist {
  const p = value as Partial<MediaPlaylist> | null
  return Boolean(
    p &&
      typeof p === 'object' &&
      typeof p.id === 'string' &&
      typeof p.name === 'string' &&
      Array.isArray(p.itemIds),
  )
}

function readSettings(): MediaSettings {
  const raw = store.get('media') as Partial<MediaSettings> | undefined
  return {
    folder: typeof raw?.folder === 'string' ? raw.folder : '',
    playlists: Array.isArray(raw?.playlists) ? raw.playlists.filter(isPlaylist) : [],
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

class MediaService {
  private items: MediaItem[] = []
  private folders: MediaFolder[] = []
  private playlists: MediaPlaylist[] = []
  private playback: Record<string, MediaPlayback> = {}
  private scanError: string | null = null
  private liveItemId: string | null = null
  private listeners = new Set<(library: MediaLibrary) => void>()

  /** Fires whenever the library or the live item changes, so the dock re-renders. */
  onChange(listener: (library: MediaLibrary) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    const library = this.getLibrary()
    for (const listener of this.listeners) {
      try {
        listener(library)
      } catch (err) {
        log.warn('[Media] listener threw', (err as Error).message)
      }
    }
  }

  getLibrary(): MediaLibrary {
    return {
      folder: readSettings().folder,
      folders: this.folders,
      items: this.items,
      playlists: this.playlists,
      playback: this.playback,
      liveItemId: this.liveItemId,
      error: this.scanError,
    }
  }

  private get root(): string {
    return readSettings().folder
  }

  private manifestPath(root: string): string {
    return join(root, MANIFEST_DIR, MANIFEST_FILE)
  }

  // ─── Scanning ───────────────────────────────────────────────────────────────

  /**
   * Indexes the watched folder. Reads directory entries and sizes only — never
   * file contents — so a folder of 4K loops costs milliseconds, not seconds.
   */
  async scan(): Promise<MediaLibrary> {
    const root = this.root
    if (!root) {
      this.items = []
      this.folders = []
      this.playlists = []
      this.playback = {}
      this.scanError = null
      this.emit()
      return this.getLibrary()
    }

    const items: MediaItem[] = []
    const counts = new Map<string, number>()
    const subdirectoryNames: string[] = []

    const walk = async (dir: string, relativeDir: string, depth: number): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        // Skips our own manifest folder along with everything else dot-prefixed.
        if (entry.name.startsWith('.')) continue
        const full = join(dir, entry.name)

        if (entry.isDirectory()) {
          if (depth >= MAX_DEPTH) continue
          // Register before walking — an empty folder is still a shelf.
          if (depth === 0) subdirectoryNames.push(entry.name)
          await walk(full, entry.name, depth + 1)
          continue
        }
        if (!entry.isFile()) continue

        const ext = extname(entry.name).slice(1).toLowerCase()
        const kind = kindOf(ext)
        if (!kind) continue

        let sizeBytes = 0
        try {
          sizeBytes = (await fs.stat(full)).size
        } catch {
          // A file that vanished between readdir and stat is simply skipped.
          continue
        }

        items.push({
          id: itemIdFor(root, full),
          name: basename(entry.name, extname(entry.name)),
          path: full,
          kind,
          ext,
          folder: relativeDir,
          sizeBytes,
        })
        counts.set(relativeDir, (counts.get(relativeDir) ?? 0) + 1)
      }
    }

    try {
      await walk(root, '', 0)
      this.scanError = null
    } catch (err) {
      // A moved or unmounted folder must not wipe the dock silently.
      this.scanError = `Could not read the backgrounds folder — ${(err as Error).message}`
      log.warn('[Media] Scan failed', { root, error: this.scanError })
      this.items = []
      this.folders = []
      this.emit()
      return this.getLibrary()
    }

    items.sort((a, b) => a.name.localeCompare(b.name))
    this.items = items
    this.folders = listMediaFolders(basename(root), subdirectoryNames, counts)

    await this.loadPlaylists(root)

    // A background that disappeared from disk is no longer on screen.
    if (this.liveItemId && !items.some((item) => item.id === this.liveItemId)) {
      this.liveItemId = null
    }

    log.info('[Media] Scanned', {
      root,
      items: items.length,
      folders: this.folders.length,
      playlists: this.playlists.length,
    })
    this.emit()
    return this.getLibrary()
  }

  // ─── Playlist manifest ──────────────────────────────────────────────────────

  private async loadPlaylists(root: string): Promise<void> {
    try {
      const raw = await fs.readFile(this.manifestPath(root), 'utf8')
      const parsed = JSON.parse(raw) as { playlists?: unknown; playback?: unknown }
      this.playlists = Array.isArray(parsed.playlists) ? parsed.playlists.filter(isPlaylist) : []
      this.playback = normalizePlaybackMap(parsed.playback)
      // Persist the repair, or the same files get re-matched on every launch and
      // the manifest on disk keeps pointing at paths that no longer exist.
      if (this.repairPlaylistIds() > 0) await this.savePlaylists()
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('[Media] Could not read playlists manifest', (err as Error).message)
        this.playlists = []
        this.playback = {}
        return
      }
    }

    // No manifest yet. Playlists that predate it live in app settings under the
    // old absolute-path hashes — carry them over once, then stop reading them.
    const legacy = readSettings().playlists
    if (legacy.length === 0) {
      this.playlists = []
      this.playback = {}
      return
    }

    const byLegacyId = new Map(this.items.map((item) => [legacyItemId(item.path), item.id]))
    this.playlists = legacy.map((playlist) => ({
      ...playlist,
      itemIds: playlist.itemIds
        .map((old) => byLegacyId.get(old))
        .filter((id): id is string => Boolean(id)),
    }))
    log.info('[Media] Migrated playlists from settings into the media folder', {
      count: this.playlists.length,
    })
    await this.savePlaylists()
    store.set('media', { ...readSettings(), playlists: [] })
  }

  /**
   * Re-points entries whose file moved between subfolders.
   *
   * An id is a relative path, so moving `loop.mp4` from Motion/ to Stills/
   * changes it. When exactly one file in the library has that basename, the
   * intent is unambiguous and the entry is healed rather than dropped. Anything
   * still unresolved is LEFT IN PLACE — the dock reports it as missing, which is
   * far more useful than silently shrinking a playlist.
   */
  private repairPlaylistIds(): number {
    const { playlists, healed } = repairPlaylistItemIds(
      this.playlists,
      this.items.map((item) => item.id),
    )
    this.playlists = playlists
    if (healed > 0) log.info('[Media] Re-pointed moved playlist entries', { healed })
    return healed
  }

  private async savePlaylists(): Promise<void> {
    const root = this.root
    if (!root) return
    try {
      await fs.mkdir(join(root, MANIFEST_DIR), { recursive: true })
      await fs.writeFile(
        this.manifestPath(root),
        `${JSON.stringify({ version: MANIFEST_VERSION, playlists: this.playlists, playback: this.playback }, null, 2)}\n`,
        'utf8',
      )
    } catch (err) {
      // A read-only volume must not lose the edit that is already in memory.
      this.scanError = `Playlists could not be saved to the media folder — ${(err as Error).message}`
      log.warn('[Media] Could not write playlists manifest', (err as Error).message)
    }
  }

  // ─── Folder + item lookups ──────────────────────────────────────────────────

  async setFolder(folder: string): Promise<MediaLibrary> {
    store.set('media', { ...readSettings(), folder })
    this.liveItemId = null
    return this.scan()
  }

  /**
   * Creates an empty subfolder. Creating is safe; MOVING files is not, so the
   * app never does that — the operator fills the folder from Finder, and
   * ProPresenter's references to those files stay intact.
   */
  async createFolder(name: string): Promise<MediaLibrary> {
    const root = this.root
    if (!root) throw new Error('Choose a backgrounds folder first.')

    const clean = name.trim().replace(/[/\\:*?"<>|]/g, '').trim()
    if (!clean || clean.startsWith('.')) throw new Error('That folder name is not allowed.')

    const target = resolve(root, clean)
    // Belt and braces against a name that climbs out of the root.
    if (!isInsideRoot(target, root) || dirname(target) !== resolve(root)) {
      throw new Error('That folder name is not allowed.')
    }

    await fs.mkdir(target, { recursive: false }).catch((err: NodeJS.ErrnoException) => {
      throw new Error(err.code === 'EEXIST' ? 'That folder already exists.' : err.message)
    })
    log.info('[Media] Folder created', { name: clean })
    return this.scan()
  }

  getItem(id: string): MediaItem | null {
    return this.items.find((item) => item.id === id) ?? null
  }

  getLiveItem(): MediaItem | null {
    return this.liveItemId ? this.getItem(this.liveItemId) : null
  }

  getPlayback(id: string): MediaPlayback {
    return normalizeMediaPlayback(this.playback[id])
  }

  async setPlayback(id: string, patch: Partial<MediaPlayback>): Promise<MediaLibrary> {
    const next = normalizeMediaPlayback({ ...this.getPlayback(id), ...patch })
    if (isDefaultMediaPlayback(next)) {
      const { [id]: _removed, ...rest } = this.playback
      this.playback = rest
    } else {
      this.playback = { ...this.playback, [id]: next }
    }
    await this.savePlaylists()
    this.emit()
    return this.getLibrary()
  }

  setLiveItem(id: string | null): void {
    this.liveItemId = id
    this.emit()
  }

  /**
   * Every path the media folder makes servable over `pa-media://`.
   *
   * Returns the ROOT, not the file list: the protocol handler does a prefix
   * test, so a file added to the folder after the last scan still plays.
   */
  allowedRoot(): string | null {
    const root = this.root
    return root ? resolve(root) : null
  }

  // ─── Playlists ──────────────────────────────────────────────────────────────

  async createPlaylist(name: string): Promise<MediaLibrary> {
    this.playlists = [
      ...this.playlists,
      { id: newPlaylistId(), name: name.trim() || 'New playlist', itemIds: [], createdAt: Date.now() },
    ]
    await this.savePlaylists()
    this.emit()
    return this.getLibrary()
  }

  async renamePlaylist(id: string, name: string): Promise<MediaLibrary> {
    this.playlists = this.playlists.map((p) =>
      p.id === id ? { ...p, name: name.trim() || p.name } : p,
    )
    await this.savePlaylists()
    this.emit()
    return this.getLibrary()
  }

  async deletePlaylist(id: string): Promise<MediaLibrary> {
    this.playlists = this.playlists.filter((p) => p.id !== id)
    await this.savePlaylists()
    this.emit()
    return this.getLibrary()
  }

  async setPlaylistItems(id: string, itemIds: string[]): Promise<MediaLibrary> {
    this.playlists = this.playlists.map((p) => (p.id === id ? { ...p, itemIds } : p))
    await this.savePlaylists()
    this.emit()
    return this.getLibrary()
  }

  /**
   * Adds files to a playlist in one gesture.
   *
   * Files already inside the media folder are referenced in place — copying
   * them would duplicate what ProPresenter may already point at. Anything
   * outside is copied into the root (never moved) so the protocol allowlist
   * can serve it.
   */
  async importIntoPlaylist(playlistId: string, sourcePaths: string[]): Promise<MediaLibrary> {
    const root = this.root
    if (!root) throw new Error('Choose a backgrounds folder first.')
    if (!this.playlists.some((playlist) => playlist.id === playlistId)) {
      throw new Error('That playlist is gone.')
    }

    const taken = new Set((await fs.readdir(root)).map((name) => name.toLowerCase()))
    const importedIds: string[] = []

    for (const source of sourcePaths) {
      const plan = planMediaImport(source, root, taken)
      if (plan.action === 'skip') continue
      let dest: string
      if (plan.action === 'copy') {
        dest = join(root, plan.destName)
        await fs.copyFile(plan.from, dest)
        taken.add(plan.destName.toLowerCase())
        log.info('[Media] Copied into library', { from: plan.from, dest })
      } else {
        dest = plan.absPath
      }
      importedIds.push(itemIdFor(root, dest))
    }

    if (importedIds.length === 0) {
      throw new Error('None of those files are a background we can play.')
    }

    await this.scan()
    const playlist = this.playlists.find((candidate) => candidate.id === playlistId)
    if (!playlist) throw new Error('That playlist is gone.')

    const seen = new Set(playlist.itemIds)
    const itemIds = [...playlist.itemIds]
    for (const id of importedIds) {
      if (seen.has(id)) continue
      seen.add(id)
      itemIds.push(id)
    }
    return this.setPlaylistItems(playlistId, itemIds)
  }
}

export const mediaService = new MediaService()

/**
 * Picks a name that does not collide with files already in the media root.
 * Used when copying a background in from elsewhere.
 */
export function uniqueFileName(fileName: string, takenLower: ReadonlySet<string>): string {
  if (!takenLower.has(fileName.toLowerCase())) return fileName
  const ext = extname(fileName)
  const stem = basename(fileName, ext)
  let n = 1
  let candidate = `${stem} ${n}${ext}`
  while (takenLower.has(candidate.toLowerCase())) {
    n += 1
    candidate = `${stem} ${n}${ext}`
  }
  return candidate
}

export type MediaImportPlan =
  | { action: 'reuse'; absPath: string }
  | { action: 'copy'; from: string; destName: string }
  | { action: 'skip' }

/**
 * Files already under the media root are reused. Anything else is copied in —
 * never moved — so ProPresenter path references to the original stay intact.
 */
export function planMediaImport(
  sourcePath: string,
  root: string,
  takenLower: ReadonlySet<string>,
): MediaImportPlan {
  const ext = extname(sourcePath).slice(1).toLowerCase()
  if (!kindOf(ext)) return { action: 'skip' }
  const abs = resolve(sourcePath)
  if (isInsideRoot(abs, root)) return { action: 'reuse', absPath: abs }
  return { action: 'copy', from: abs, destName: uniqueFileName(basename(abs), takenLower) }
}

/**
 * One-level shelves under the media root, including empty folders.
 *
 * Files-only counting used to drop a folder the operator had just created, so
 * "new folder" looked like it did nothing until something was copied in.
 */
export function listMediaFolders(
  rootName: string,
  subdirectoryNames: readonly string[],
  fileCounts: ReadonlyMap<string, number>,
): MediaFolder[] {
  const counts = new Map(fileCounts)
  for (const id of subdirectoryNames) {
    if (id && !counts.has(id)) counts.set(id, 0)
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, name: id === '' ? rootName : id, count }))
    .sort((a, b) => (a.id === '' ? -1 : b.id === '' ? 1 : a.name.localeCompare(b.name)))
}

/**
 * Re-points playlist entries whose file moved between subfolders.
 *
 * An id is a path relative to the media root, so moving `loop.mp4` from Motion/
 * to Stills/ changes it. When exactly one known file has that basename the
 * intent is unambiguous and the entry is healed. Anything still unresolved is
 * LEFT IN PLACE so the dock can report it as missing — a playlist that quietly
 * shrinks is how you discover mid-service that someone renamed a file.
 *
 * Ambiguity is deliberately not guessed: two files sharing a basename in
 * different folders leave the entry alone rather than picking one at random.
 */
export function repairPlaylistItemIds(
  playlists: readonly MediaPlaylist[],
  knownIds: readonly string[],
): { playlists: MediaPlaylist[]; healed: number } {
  const known = new Set(knownIds)
  const byBasename = new Map<string, string[]>()
  for (const id of knownIds) {
    const key = basename(id)
    byBasename.set(key, [...(byBasename.get(key) ?? []), id])
  }

  let healed = 0
  const next = playlists.map((playlist) => ({
    ...playlist,
    itemIds: playlist.itemIds.map((id) => {
      if (known.has(id)) return id
      const candidates = byBasename.get(basename(id)) ?? []
      if (candidates.length === 1) {
        healed++
        return candidates[0]
      }
      return id
    }),
  }))
  return { playlists: next, healed }
}

/** True when `filePath` sits inside `root` — symlink-resolved by the caller. */
export function isInsideRoot(filePath: string, root: string): boolean {
  const target = resolve(filePath)
  const base = resolve(root)
  // `startsWith(base)` alone would also match a sibling like `${base}-secret`.
  return target === base || target.startsWith(base + sep)
}
