/**
 * Injectable NDI native loader (Plan 002).
 *
 * Selects the Plan 001 adapter using `process.platform` / `process.arch`.
 * Unsupported combinations return a typed unavailable result rather than
 * throwing, and native loading stays lazy inside error handling so a broken
 * addon disables only NDI — never main.
 *
 * Each tuple loads its `@grandi/*` NDI 6 prebuild. (The older `grandiose-mac`
 * fallback was removed once grandi proved itself on every release.)
 */
import log from 'electron-log/main'
import path from 'node:path'
import { createGrandiProvider, type NdiProvider } from './provider'

export type SupportedTuple = `${NodeJS.Platform}:${NodeJS.Architecture}`

/** The four supported release tuples from plans/README.md. */
export const SUPPORTED_TUPLES: readonly string[] = [
  'darwin:arm64',
  'darwin:x64',
  'win32:x64',
  'linux:x64',
] as const

export function currentTuple(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): string {
  return `${platform}:${arch}`
}

export function isSupportedTuple(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): boolean {
  return (SUPPORTED_TUPLES as readonly string[]).includes(currentTuple(platform, arch))
}

export type ProviderLoadResult =
  | { ok: true; provider: NdiProvider; adapter: 'grandi' }
  | { ok: false; reason: string }

export type RequireFn = (id: string) => unknown

const GRANDI_PREBUILD_BY_TUPLE: Readonly<Record<string, string>> = {
  'darwin:arm64': '@grandi/darwin-arm64',
  'darwin:x64': '@grandi/darwin-x64',
  'win32:x64': '@grandi/win32-x64',
  'linux:x64': '@grandi/linux-x64',
}

function tryLoadGrandi(tuple: string, requireFn: RequireFn): NdiProvider | null {
  const packageName = GRANDI_PREBUILD_BY_TUPLE[tuple]
  if (!packageName) return null
  const candidates = [
    packageName,
    path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', packageName),
  ]
  for (const candidate of candidates) {
    try {
    // Electron 33 embeds Node 20.18, which cannot synchronously require grandi's
    // ESM wrapper (and is below that wrapper's Node >=20.19.5 engine). The native
    // optional package exposes the same binding directly and is safe to require.
      const native = requireFn(candidate) as Parameters<typeof createGrandiProvider>[0]
      if (native) return createGrandiProvider(native)
    } catch {
      // Packaged apps may need the explicit app.asar.unpacked path.
    }
  }
  return null
}

/**
 * Select and lazily load the NDI provider for the given platform/arch.
 * Never throws for unsupported tuples or broken native bindings.
 */
export function loadNdiProvider(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
  requireFn: RequireFn = require,
): ProviderLoadResult {
  if (!isSupportedTuple(platform, arch)) {
    return { ok: false, reason: `unsupported platform/arch: ${platform}/${arch}` }
  }
  const tuple = currentTuple(platform, arch)
  const grandi = tryLoadGrandi(tuple, requireFn)
  if (grandi) {
    try {
      const sdk = grandi.version()
      log.info('[NDI] grandi loaded', { sdkVersion: sdk })
    } catch {
      /* version() must never fail selection */
    }
    return { ok: true, provider: grandi, adapter: 'grandi' }
  }
  return { ok: false, reason: `no NDI native binding available for ${platform}/${arch}` }
}
