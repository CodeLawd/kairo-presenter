import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Card outputs are on in every macOS build. `KAIRO_ENABLE_DECKLINK=0` turns
 * them off (diagnosis); other platforms have no DeckLink provider yet.
 */
export function deckLinkEnabled(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): boolean {
  return platform === 'darwin' && env.KAIRO_ENABLE_DECKLINK !== '0'
}

/**
 * The out-of-process helper: bundled in `Contents/Resources/decklink/` when
 * packaged, the local build in development. The first that exists wins; the
 * provider reports "not included in this build" if neither does.
 */
export function deckLinkHelperPath(
  resourcesPath: string | undefined = process.resourcesPath,
  cwd = process.cwd(),
  exists: (path: string) => boolean = existsSync,
): string {
  const candidates = [
    ...(resourcesPath ? [join(resourcesPath, 'decklink', 'decklink-helper')] : []),
    join(cwd, 'native', 'decklink', 'build', 'decklink-helper'),
  ]
  return candidates.find((path) => exists(path)) ?? candidates[candidates.length - 1]
}

/**
 * The playback worker script. Packaged, it is unpacked next to app.asar (see
 * `asarUnpack`) so the worker loads from a real file rather than the archive.
 */
export function deckLinkWorkerPath(dir: string = __dirname, exists: (path: string) => boolean = existsSync): string {
  const packed = join(dir, 'decklink-playback-worker.js')
  const unpacked = packed.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')
  return unpacked !== packed && exists(unpacked) ? unpacked : packed
}
