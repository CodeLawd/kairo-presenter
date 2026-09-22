/**
 * Owns the on-disk Kairo workspace — the single folder songs and media live in.
 *
 * Everything else asks this service where things belong rather than deriving
 * paths of its own, so changing the workspace folder in Settings moves the
 * whole app at once. The folders are created lazily on first use; an operator
 * who deletes them between services gets them back on the next launch.
 */

import { promises as fs } from 'fs'
import path from 'path'
import { app, shell } from 'electron'
import log from 'electron-log/main'
import type { MediaFolderMigration, WorkspaceInfo } from '@shared/workspace'
import {
  MEDIA_DIR_NAME,
  SONGS_DIR_NAME,
  WORKSPACE_FOLDER_NAME,
  isInsideFolder,
} from '@shared/workspace'
import { store } from '../../db'

/** Media types the media dock indexes — used when counting a folder to adopt. */
const MEDIA_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif', '.heic',
  '.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi',
])

class WorkspaceService {
  /** Last resolved info, so repeat reads in one session skip the stat calls. */
  private cached: WorkspaceInfo | null = null

  /** `~/Documents/Kairo Presenter` — Documents falls back to home on odd setups. */
  defaultRoot(): string {
    let documents: string
    try {
      documents = app.getPath('documents')
    } catch {
      documents = app.getPath('home')
    }
    return path.join(documents, WORKSPACE_FOLDER_NAME)
  }

  /** The configured root, or the default when the operator never chose one. */
  root(): string {
    const configured = store.get('workspace')?.folder
    return typeof configured === 'string' && configured.trim()
      ? path.resolve(configured.trim())
      : this.defaultRoot()
  }

  songsDir(): string {
    return path.join(this.root(), SONGS_DIR_NAME)
  }

  mediaDir(): string {
    return path.join(this.root(), MEDIA_DIR_NAME)
  }

  /**
   * Creates the workspace folders if they are missing and reports the result.
   *
   * Never throws: a workspace on an unplugged drive should degrade to an error
   * banner, not a failed launch, so callers get `ready: false` instead.
   */
  async ensure(): Promise<WorkspaceInfo> {
    const root = this.root()
    const info: WorkspaceInfo = {
      root,
      songsDir: path.join(root, SONGS_DIR_NAME),
      mediaDir: path.join(root, MEDIA_DIR_NAME),
      isDefault: root === this.defaultRoot(),
      ready: false,
      error: null,
    }

    try {
      await fs.mkdir(info.songsDir, { recursive: true })
      await fs.mkdir(info.mediaDir, { recursive: true })
      info.ready = true
    } catch (err) {
      info.error = (err as Error).message
      log.error('[Workspace] Could not create workspace folders', { root, error: info.error })
    }

    this.cached = info
    return info
  }

  /** Cached `ensure()` result; runs the real thing on first call. */
  async info(): Promise<WorkspaceInfo> {
    if (this.cached && this.cached.root === this.root()) return this.cached
    return this.ensure()
  }

  /**
   * Points the workspace at a new folder.
   *
   * `move` carries the existing Songs and Media contents across, which is what
   * an operator relocating to an external drive expects; without it the new
   * folder starts empty and the old files stay where they are.
   */
  async setRoot(nextRoot: string, options: { move?: boolean } = {}): Promise<WorkspaceInfo> {
    const target = path.resolve(nextRoot)
    const previous = this.root()

    if (target === previous) return this.ensure()
    if (isInsideFolder(target, previous)) {
      throw new Error('Choose a folder outside the current workspace.')
    }

    await fs.mkdir(path.join(target, SONGS_DIR_NAME), { recursive: true })
    await fs.mkdir(path.join(target, MEDIA_DIR_NAME), { recursive: true })

    if (options.move) {
      for (const dir of [SONGS_DIR_NAME, MEDIA_DIR_NAME]) {
        await this.moveFolderContents(path.join(previous, dir), path.join(target, dir))
      }
    }

    store.set('workspace', { ...store.get('workspace'), folder: target })
    this.cached = null
    log.info('[Workspace] Root changed', { from: previous, to: target, moved: Boolean(options.move) })

    // Media follows the workspace whenever it was pointing at the old Media folder.
    const media = store.get('media')
    if (media?.folder && isInsideFolder(path.resolve(media.folder), previous)) {
      store.set('media', { ...media, folder: path.join(target, MEDIA_DIR_NAME) })
    }

    return this.ensure()
  }

  // ─── Media folder adoption ──────────────────────────────────────────────────

  /**
   * Describes the choice offered on first run when the operator already has a
   * backgrounds folder somewhere else: keep indexing it, or bring it inside
   * the workspace.
   */
  async mediaMigration(): Promise<MediaFolderMigration> {
    const targetFolder = this.mediaDir()
    const currentFolder = store.get('media')?.folder ?? ''
    const resolved = currentFolder ? path.resolve(currentFolder) : ''
    const needed = Boolean(resolved) && !isInsideFolder(resolved, this.root())

    let fileCount = 0
    if (needed) {
      try {
        const entries = await fs.readdir(resolved, { withFileTypes: true })
        fileCount = entries.filter(
          (e) => e.isFile() && MEDIA_EXT.has(path.extname(e.name).toLowerCase()),
        ).length
      } catch {
        fileCount = -1
      }
    }

    return { currentFolder: resolved, targetFolder, needed, fileCount }
  }

  /**
   * Repoints the media dock at `<workspace>/Media`, optionally carrying the
   * existing files across. Declining the move leaves the files behind but the
   * dock still switches, so the two never disagree about where media lives.
   */
  async adoptMediaFolder(options: { move?: boolean } = {}): Promise<string> {
    const info = await this.ensure()
    const media = store.get('media')
    const previous = media?.folder ? path.resolve(media.folder) : ''

    if (options.move && previous && previous !== info.mediaDir) {
      await this.moveFolderContents(previous, info.mediaDir)
    }

    store.set('media', { ...media, folder: info.mediaDir })
    log.info('[Workspace] Media folder adopted', {
      from: previous || '(unset)',
      to: info.mediaDir,
      moved: Boolean(options.move),
    })
    return info.mediaDir
  }

  /**
   * Claims the workspace Media folder for a fresh install — but never
   * overrides a folder the operator already picked.
   */
  async applyDefaultMediaFolder(): Promise<void> {
    const media = store.get('media')
    if (media?.folder) return
    const info = await this.ensure()
    if (!info.ready) return
    store.set('media', { ...media, folder: info.mediaDir })
    log.info('[Workspace] Media folder defaulted to the workspace', { folder: info.mediaDir })
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  async reveal(): Promise<void> {
    const info = await this.ensure()
    await shell.openPath(info.root)
  }

  async revealSongs(): Promise<void> {
    const info = await this.ensure()
    await shell.openPath(info.songsDir)
  }

  /**
   * Moves every entry of `from` into `to`, falling back to copy+delete across
   * filesystems (an external drive is the common case). A name already taken
   * in the destination is kept — the existing file wins and the source stays,
   * so nothing is silently overwritten.
   */
  private async moveFolderContents(from: string, to: string): Promise<void> {
    let entries: string[]
    try {
      entries = await fs.readdir(from)
    } catch {
      return
    }
    await fs.mkdir(to, { recursive: true })

    for (const name of entries) {
      const src = path.join(from, name)
      const dest = path.join(to, name)
      try {
        await fs.access(dest)
        log.warn('[Workspace] Skipped move — name already exists at destination', { dest })
        continue
      } catch {
        /* destination is free */
      }
      try {
        await fs.rename(src, dest)
      } catch {
        try {
          await fs.cp(src, dest, { recursive: true })
          await fs.rm(src, { recursive: true, force: true })
        } catch (err) {
          log.warn('[Workspace] Could not move entry', { src, error: (err as Error).message })
        }
      }
    }
  }
}

export const workspaceService = new WorkspaceService()
