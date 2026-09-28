import { app } from 'electron'
import { copyFileSync, existsSync } from 'fs'
import { join } from 'path'
import log from 'electron-log/main'

/**
 * Store name for a renamed electron-store file, carrying an existing install's
 * data across the rename.
 *
 * Before the store is opened: if `<userData>/<next>.json` does not exist yet
 * and `<userData>/<legacy>.json` does, the legacy file is copied to the new
 * name. The legacy file is left in place, so an older build pointed at the
 * same profile still finds its settings. Never throws — at worst the store
 * starts from its defaults, exactly as on a fresh install.
 */
export function renamedStore(legacy: string, next: string): string {
  try {
    const dir = app.getPath('userData')
    const from = join(dir, `${legacy}.json`)
    const to = join(dir, `${next}.json`)
    if (!existsSync(to) && existsSync(from)) {
      copyFileSync(from, to)
      log.info('[Store] Adopted legacy store file', { legacy, next })
    }
  } catch (err) {
    log.warn('[Store] Could not adopt legacy store file', { legacy, next, error: (err as Error).message })
  }
  return next
}
