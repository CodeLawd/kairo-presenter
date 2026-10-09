/**
 * Self-update for macOS builds that are not signed with a Developer ID.
 *
 * Squirrel.Mac (what electron-updater uses on macOS) installs an update only
 * when its code signature matches the running app's designated requirement.
 * An ad-hoc signature is a hash of that one build, so every release looks like
 * a different developer and Squirrel refuses it. Until the app is signed, Kairo
 * installs its own updates instead:
 *
 *   1. download the release's .zip for this architecture (same file and same
 *      `latest-mac.yml` entry Squirrel would use),
 *   2. check its SHA-512 against that entry,
 *   3. unpack it and check the bundle is Kairo and its signature is intact,
 *   4. on quit, a small detached script swaps the bundle in place and, when
 *      asked, reopens it.
 *
 * A file the app downloads itself carries no quarantine flag, so the new
 * version opens without the "Open Anyway" prompt the first install needed.
 *
 * Everything here is pure (no Electron), so it is unit-tested directly.
 */

export interface UpdateFileInfo {
  url: string
  sha512: string
  size?: number
}

/** The release repository electron-builder publishes to (package.json `build.publish`). */
export const RELEASE_REPO = 'CodeLawd/kairo-presenter'

/**
 * The update zip for this machine. electron-builder names them
 * `Kairo-<v>-arm64-mac.zip` (Apple silicon) and `Kairo-<v>-mac.zip` (Intel).
 */
export function pickMacZip(files: readonly UpdateFileInfo[], arch: string): UpdateFileInfo | null {
  const zips = files.filter((file) => /\.zip$/i.test(file.url))
  const arm = (file: UpdateFileInfo): boolean => /(arm64|aarch64)/i.test(file.url)
  const match = arch === 'arm64' ? zips.find(arm) : zips.find((file) => !arm(file))
  return match ?? null
}

/** Absolute download URL for a release file. Refuses anything that is not a bare filename. */
export function releaseAssetUrl(version: string, file: string, repo = RELEASE_REPO): string {
  if (/^https?:\/\//i.test(file)) {
    if (!file.startsWith(`https://github.com/${repo}/releases/download/`)) {
      throw new Error(`Refusing update from an unexpected address: ${file}`)
    }
    return file
  }
  if (!/^[\w.-]+$/.test(file) || file.includes('..')) throw new Error(`Unexpected update file name: ${file}`)
  if (!/^[\w.-]+$/.test(version)) throw new Error(`Unexpected version: ${version}`)
  return `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(file)}`
}

/** True when `codesign -dv` describes an ad-hoc (not Developer ID) signature. */
export function isAdhocSignature(codesignOutput: string): boolean {
  return /Signature=adhoc/i.test(codesignOutput) || /TeamIdentifier=not set/i.test(codesignOutput)
}

/** The `.app` bundle that contains an executable at `<bundle>/Contents/MacOS/<name>`. */
export function bundleFromExecutable(exePath: string): string | null {
  const match = /^(.*?\.app)\/Contents\/MacOS\/[^/]+$/.exec(exePath)
  return match ? match[1] : null
}

/**
 * The swap, run by /bin/bash after Kairo has quit. Arguments: the old app's
 * PID, the installed bundle, the new bundle, and "1" to reopen afterwards.
 *
 * It waits for the PID to exit (up to a minute), moves the old bundle aside,
 * moves the new one into its place and deletes the old one. If the move fails
 * the old bundle is put back, so a failed update never leaves no Kairo at all.
 */
export const SWAP_SCRIPT = `#!/bin/bash
PID="$1"; OLD="$2"; NEW="$3"; RELAUNCH="$4"
for _ in $(seq 1 300); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done
BACKUP="$OLD.kairo-old-$$"
if mv "$OLD" "$BACKUP"; then
  if mv "$NEW" "$OLD"; then
    rm -rf "$BACKUP"
  else
    mv "$BACKUP" "$OLD"
  fi
fi
rm -rf "$(dirname "$NEW")"
if [ "$RELAUNCH" = "1" ]; then open "$OLD"; fi
`
