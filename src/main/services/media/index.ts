import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'path'
import { shell } from 'electron'
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
import { applyItemOrder } from '@shared/media-order'
import { readFilePathsFromClipboard } from './clipboard'

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
  /**
   * Operator order for the whole library ("All backgrounds"). Empty means
   * fall back to the scan's name sort. Playlists keep their own `itemIds`.
   */
  private itemOrder: string[] = []
  private scanError: string | null = null
  private liveItemId: string | null = null
  private livePaused = false
  /**
   * In-app clipboard. System pasteboard is also written for Finder, but
   * Electron's macOS clipboard clears between writes — so Paste here prefers
   * these ids whenever they are set.
   */
  private clipboardIds: string[] | null = null
  private clipboardMode: 'copy' | 'cut' | null = null
  /** Playlist the cut items were taken from — cleared on Paste / Copy. */
  private clipboardCutFromPlaylistId: string | null = null
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
      livePaused: this.livePaused,
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
      this.itemOrder = []
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
    this.folders = listMediaFolders(basename(root), subdirectoryNames, counts)

    // Manifest holds the operator's library order — load it before applying so
    // a rescan does not flash the alphabetical list for one frame.
    await this.loadPlaylists(root)
    this.items = applyItemOrder(items, this.itemOrder)

    // A background that disappeared from disk is no longer on screen.
    if (this.liveItemId && !items.some((item) => item.id === this.liveItemId)) {
      this.liveItemId = null
      this.livePaused = false
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
      const parsed = JSON.parse(raw) as {
        playlists?: unknown
        playback?: unknown
        itemOrder?: unknown
      }
      this.playlists = Array.isArray(parsed.playlists) ? parsed.playlists.filter(isPlaylist) : []
      this.playback = normalizePlaybackMap(parsed.playback)
      this.itemOrder = Array.isArray(parsed.itemOrder)
        ? parsed.itemOrder.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : []
      // Persist the repair, or the same files get re-matched on every launch and
      // the manifest on disk keeps pointing at paths that no longer exist.
      if (this.repairPlaylistIds() > 0) await this.savePlaylists()
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn('[Media] Could not read playlists manifest', (err as Error).message)
        this.playlists = []
        this.playback = {}
        this.itemOrder = []
        return
      }
    }

    // No manifest yet. Playlists that predate it live in app settings under the
    // old absolute-path hashes — carry them over once, then stop reading them.
    const legacy = readSettings().playlists
    if (legacy.length === 0) {
      this.playlists = []
      this.playback = {}
      this.itemOrder = []
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
        `${JSON.stringify(
          {
            version: MANIFEST_VERSION,
            playlists: this.playlists,
            playback: this.playback,
            itemOrder: this.itemOrder,
          },
          null,
          2,
        )}\n`,
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
    this.livePaused = false
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

  /**
   * Deletes a background from disk and drops every reference to it.
   *
   * This is the one write that removes the operator's file — playlists only
   * hold ids, so a "remove from playlist" is not enough when they want the
   * thumbnail gone from the folder. Path is checked against the media root
   * before unlink so a forged id cannot reach outside it.
   */
  async deleteItem(id: string): Promise<MediaLibrary> {
    const item = this.getItem(id)
    if (!item) throw new Error('That background is no longer in the folder.')

    const root = this.root
    if (!root) throw new Error('Choose a backgrounds folder first.')
    const target = resolve(item.path)
    if (!isInsideRoot(target, root)) {
      throw new Error('That file is outside the backgrounds folder.')
    }

    try {
      await fs.unlink(target)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Could not delete “${item.name}” — ${(err as Error).message}`)
      }
    }

    this.items = this.items.filter((candidate) => candidate.id !== id)
    this.itemOrder = this.itemOrder.filter((entry) => entry !== id)
    this.playlists = this.playlists.map((playlist) => ({
      ...playlist,
      itemIds: playlist.itemIds.filter((entry) => entry !== id),
    }))
    if (this.playback[id]) {
      const { [id]: _removed, ...rest } = this.playback
      this.playback = rest
    }
    if (this.liveItemId === id) {
      this.liveItemId = null
      this.livePaused = false
    }

    // Folder counts are derived from the item list — rebuild so empty shelves
    // still show and the sidebar number matches what is on disk.
    const counts = new Map<string, number>()
    for (const remaining of this.items) {
      counts.set(remaining.folder, (counts.get(remaining.folder) ?? 0) + 1)
    }
    for (const folder of this.folders) {
      if (!counts.has(folder.id)) counts.set(folder.id, 0)
    }
    this.folders = this.folders.map((folder) => ({
      ...folder,
      count: counts.get(folder.id) ?? 0,
    }))

    await this.savePlaylists()
    log.info('[Media] Background deleted', { id, name: item.name })
    this.emit()
    return this.getLibrary()
  }

  /**
   * Renames a background on disk. The id is a relative path, so every playlist
   * entry, the library order and any playback grade have to move with it —
   * otherwise the next scan would report the old name as missing.
   */
  async renameItem(id: string, nextName: string): Promise<MediaLibrary> {
    const item = this.getItem(id)
    if (!item) throw new Error('That background is no longer in the folder.')

    const root = this.root
    if (!root) throw new Error('Choose a backgrounds folder first.')

    const clean = nextName.trim().replace(/[/\\:*?"<>|]/g, '').trim()
    if (!clean || clean.startsWith('.')) throw new Error('That name is not allowed.')

    // Keep the original extension — operators rename the title, not the codec.
    const stem = clean.toLowerCase().endsWith(`.${item.ext}`)
      ? clean.slice(0, -(item.ext.length + 1))
      : clean
    if (!stem) throw new Error('That name is not allowed.')

    const destName = `${stem}.${item.ext}`
    const destDir = dirname(item.path)
    const destPath = join(destDir, destName)
    if (resolve(destPath) === resolve(item.path)) return this.getLibrary()

    if (!isInsideRoot(destPath, root) || dirname(resolve(destPath)) !== resolve(destDir)) {
      throw new Error('That name is not allowed.')
    }

    const exists = await fs.access(destPath).then(() => true).catch(() => false)
    if (exists) throw new Error(`“${stem}” already exists in this folder.`)

    await fs.rename(item.path, destPath)
    const newId = itemIdFor(root, destPath)
    this.retargetItemId(id, newId, {
      ...item,
      id: newId,
      name: stem,
      path: destPath,
    })
    await this.savePlaylists()
    log.info('[Media] Background renamed', { from: id, to: newId })
    this.emit()
    return this.getLibrary()
  }

  /** Opens the file's enclosing folder in Finder / Explorer / the file manager. */
  revealItem(id: string): void {
    const item = this.getItem(id)
    if (!item) throw new Error('That background is no longer in the folder.')
    shell.showItemInFolder(item.path)
  }

  /**
   * Remembers backgrounds for in-app Paste.
   *
   * We deliberately do NOT write NSFilenamesPboardType here — on some Electron
   * / macOS builds that call freezes the process. Finder → app paste still works
   * by reading the system pasteboard in pasteItems.
   */
  copyItems(ids: string[]): void {
    const paths = ids
      .map((id) => this.getItem(id)?.path)
      .filter((p): p is string => Boolean(p))
    if (paths.length === 0) throw new Error('Nothing to copy.')
    this.clipboardIds = [...ids]
    this.clipboardMode = 'copy'
    this.clipboardCutFromPlaylistId = null
  }

  /**
   * Marks backgrounds to move on Paste.
   * `fromPlaylistId` — when set, Paste removes them from that playlist
   * (playlist cut) after placing them at the destination.
   */
  cutItems(ids: string[], fromPlaylistId?: string): void {
    const paths = ids
      .map((id) => this.getItem(id)?.path)
      .filter((p): p is string => Boolean(p))
    if (paths.length === 0) throw new Error('Nothing to cut.')
    this.clipboardIds = [...ids]
    this.clipboardMode = 'cut'
    this.clipboardCutFromPlaylistId =
      fromPlaylistId && this.playlists.some((p) => p.id === fromPlaylistId)
        ? fromPlaylistId
        : null
  }

  clipboardHasFiles(): boolean {
    if (this.clipboardIds && this.clipboardIds.length > 0) return true
    try {
      return readFilePathsFromClipboard().length > 0
    } catch {
      return false
    }
  }

  /**
   * Pastes into the media root (and optionally a playlist).
   * Copy → duplicate with a unique name.
   * Cut → move: into a playlist, out of the source playlist, and/or to the
   * end of All-backgrounds order. Files already under the root stay on disk;
   * files in a subfolder are moved up into the root.
   */
  async pasteItems(playlistId?: string): Promise<MediaLibrary> {
    const root = this.root
    if (!root) throw new Error('Choose a backgrounds folder first.')

    const mode = this.clipboardMode
    const ids = this.clipboardIds
    const cutFromPlaylistId = this.clipboardCutFromPlaylistId

    if (mode === 'cut' && ids && ids.length > 0) {
      this.clipboardIds = null
      this.clipboardMode = null
      this.clipboardCutFromPlaylistId = null

      const movedIds: string[] = []
      for (const id of ids) {
        const item = this.getItem(id)
        if (!item) continue
        // Already at the media root — keep the path; still reorder / re-playlist below.
        if (dirname(item.path) === resolve(root)) {
          movedIds.push(id)
          continue
        }
        // Subfolder (or outside) → move into the root.
        if (!isInsideRoot(item.path, root)) {
          // Shouldn't happen for library items; fall through to path keep.
          movedIds.push(id)
          continue
        }
        const taken = new Set((await fs.readdir(root)).map((name) => name.toLowerCase()))
        const destName = uniqueFileName(basename(item.path), taken)
        const destPath = join(root, destName)
        await fs.rename(item.path, destPath)
        const newId = itemIdFor(root, destPath)
        this.retargetItemId(id, newId, {
          ...item,
          id: newId,
          name: basename(destName, extname(destName)),
          path: destPath,
          folder: '',
        })
        movedIds.push(newId)
      }

      if (movedIds.length === 0) throw new Error('Nothing to paste.')

      // Drop from the playlist they were cut from (unless pasting back into it —
      // then we still re-append at the end below).
      if (cutFromPlaylistId && cutFromPlaylistId !== playlistId) {
        this.removeFromPlaylist(cutFromPlaylistId, movedIds)
      }

      if (playlistId) {
        // Paste into a playlist: remove then append so they land at the end.
        this.removeFromPlaylist(playlistId, movedIds)
        this.appendToPlaylist(playlistId, movedIds)
      } else {
        // Paste into All backgrounds: move to the end of the operator order.
        const without = this.itemOrder.filter((id) => !movedIds.includes(id))
        this.itemOrder = [...without, ...movedIds]
      }

      await this.savePlaylists()
      // Rescan so subfolder→root moves show up with fresh paths.
      return this.scan()
    }

    const sources: string[] = []
    if (mode === 'copy' && ids && ids.length > 0) {
      for (const id of ids) {
        const path = this.getItem(id)?.path
        if (path) sources.push(path)
      }
      // Keep copy on the clipboard so Paste can be repeated.
    } else {
      try {
        sources.push(...readFilePathsFromClipboard())
      } catch (err) {
        log.warn('[Media] System clipboard read failed', (err as Error).message)
      }
      this.clipboardIds = null
      this.clipboardMode = null
      this.clipboardCutFromPlaylistId = null
    }

    if (sources.length === 0) throw new Error('Nothing to paste.')

    const taken = new Set((await fs.readdir(root)).map((name) => name.toLowerCase()))
    const pastedIds: string[] = []
    for (const source of sources) {
      const plan = planMediaPaste(source, root, taken)
      if (plan.action === 'skip') continue
      const dest = join(root, plan.destName)
      await fs.copyFile(plan.from, dest)
      taken.add(plan.destName.toLowerCase())
      pastedIds.push(itemIdFor(root, dest))
    }
    if (pastedIds.length === 0) throw new Error('Nothing to paste.')

    // Persist order before scan — scan reloads the manifest from disk.
    if (mode === 'copy' && ids && ids[0]) {
      const anchor = ids[0]
      const without = this.itemOrder.filter((id) => !pastedIds.includes(id))
      const at = without.indexOf(anchor)
      this.itemOrder =
        at >= 0
          ? [...without.slice(0, at + 1), ...pastedIds, ...without.slice(at + 1)]
          : [...without, ...pastedIds]
    } else {
      this.itemOrder = [...this.itemOrder.filter((id) => !pastedIds.includes(id)), ...pastedIds]
    }
    if (playlistId) this.appendToPlaylist(playlistId, pastedIds)
    await this.savePlaylists()
    return this.scan()
  }

  private appendToPlaylist(playlistId: string, itemIds: readonly string[]): void {
    const playlist = this.playlists.find((p) => p.id === playlistId)
    if (!playlist || itemIds.length === 0) return
    const seen = new Set(playlist.itemIds)
    const next = [...playlist.itemIds]
    for (const id of itemIds) {
      if (seen.has(id)) continue
      seen.add(id)
      next.push(id)
    }
    this.playlists = this.playlists.map((p) =>
      p.id === playlistId ? { ...p, itemIds: next } : p,
    )
  }

  private removeFromPlaylist(playlistId: string, itemIds: readonly string[]): void {
    const drop = new Set(itemIds)
    this.playlists = this.playlists.map((p) =>
      p.id === playlistId ? { ...p, itemIds: p.itemIds.filter((id) => !drop.has(id)) } : p,
    )
  }

  /** Rewires every stored reference when a file's relative id changes. */
  private retargetItemId(oldId: string, newId: string, nextItem: MediaItem): void {
    this.items = this.items.map((item) => (item.id === oldId ? nextItem : item))
    this.itemOrder = this.itemOrder.map((id) => (id === oldId ? newId : id))
    this.playlists = this.playlists.map((playlist) => ({
      ...playlist,
      itemIds: playlist.itemIds.map((id) => (id === oldId ? newId : id)),
    }))
    if (this.playback[oldId]) {
      const { [oldId]: grade, ...rest } = this.playback
      this.playback = { ...rest, [newId]: grade }
    }
    if (this.liveItemId === oldId) this.liveItemId = newId
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
    this.livePaused = false
    this.emit()
  }

  /**
   * Pause or resume the clip that is already on screen. Does not persist —
   * the next push always starts playing.
   */
  setLivePaused(paused: boolean): MediaLibrary {
    const live = this.getLiveItem()
    if (!live || live.kind !== 'video') {
      this.livePaused = false
      this.emit()
      return this.getLibrary()
    }
    this.livePaused = paused
    this.emit()
    return this.getLibrary()
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
   * Saves the operator's order for "All backgrounds". New files from a later
   * scan that are not in this list still appear — they append after the saved
   * ones — so rearranging never hides a drop-in.
   */
  async setItemOrder(itemIds: string[]): Promise<MediaLibrary> {
    this.itemOrder = itemIds.filter((id) => typeof id === 'string' && id.length > 0)
    this.items = applyItemOrder(this.items, this.itemOrder)
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
  async importIntoPlaylist(playlistId: string | null, sourcePaths: string[]): Promise<MediaLibrary> {
    const root = this.root
    if (!root) throw new Error('Choose a backgrounds folder first.')
    if (playlistId !== null && !this.playlists.some((playlist) => playlist.id === playlistId)) {
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
    if (playlistId === null) return this.getLibrary()
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
 * Paste always writes a new file under the media root — including when the
 * source is already in the library (Copy → Paste duplicates as `name 1.ext`).
 * Import-to-playlist keeps `planMediaImport` so existing files are reused.
 */
export function planMediaPaste(
  sourcePath: string,
  _root: string,
  takenLower: ReadonlySet<string>,
): { action: 'copy'; from: string; destName: string } | { action: 'skip' } {
  const ext = extname(sourcePath).slice(1).toLowerCase()
  if (!kindOf(ext)) return { action: 'skip' }
  const abs = resolve(sourcePath)
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
