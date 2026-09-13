import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join, isAbsolute } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const run = promisify(execFile)

/**
 * Injectable system probes so tests never depend on installed apps.
 * Defaults perform real filesystem/process access.
 */
export interface OfficeProbes {
  platform?: NodeJS.Platform
  readdir?: (path: string) => Promise<string[]>
  readFile?: (path: string) => Promise<string>
  access?: (path: string) => Promise<void>
  homedir?: () => string
  env?: NodeJS.ProcessEnv
  runMdfind?: (bundleId: string) => Promise<string>
}

const defaultProbes: Required<OfficeProbes> = {
  platform: process.platform,
  readdir: (path: string) => fs.readdir(path),
  readFile: (path: string) => fs.readFile(path, 'utf8'),
  access: (path: string) => fs.access(path).then(() => undefined),
  homedir: () => homedir(),
  env: process.env,
  runMdfind: async (bundleId: string) => {
    const { stdout } = await run('mdfind', [`kMDItemCFBundleIdentifier == "${bundleId}"`], {
      timeout: 5_000,
    })
    return stdout
  },
}

function probesWith(overrides?: OfficeProbes): Required<OfficeProbes> {
  return { ...defaultProbes, ...overrides }
}

export function isPowerPointAppName(name: string): boolean {
  return /powerpoint\.app$/i.test(name)
}

export function isWpsAppName(name: string): boolean {
  return /^wpsoffice.*\.app$/i.test(name) || /^wps office.*\.app$/i.test(name)
}

export function isKeynoteAppName(name: string): boolean {
  return /^keynote\.app$/i.test(name)
}

export function isLibreOfficeAppName(name: string): boolean {
  return /^libreoffice\.app$/i.test(name)
}

function darwinApplicationRoots(home: string): string[] {
  return ['/Applications', join(home, 'Applications'), '/System/Applications']
}

/**
 * macOS `.app` bundle scan. Darwin-only by design — Windows discovery uses
 * registry-adjacent install locations and Linux uses PATH/`.desktop` entries
 * (see converters.ts); both return null here so callers fall through.
 */
export async function findAppByName(
  match: (name: string) => boolean,
  overrides?: OfficeProbes,
): Promise<string | null> {
  const probes = probesWith(overrides)
  if (probes.platform !== 'darwin') return null
  for (const root of darwinApplicationRoots(probes.homedir())) {
    let names: string[]
    try {
      names = await probes.readdir(root)
    } catch {
      continue // inaccessible root — try the next one
    }
    const found = names.find(match)
    if (found) return join(root, found)
  }
  return null
}

export async function findAppByBundleId(
  bundleId: string,
  overrides?: OfficeProbes,
): Promise<string | null> {
  const probes = probesWith(overrides)
  if (probes.platform !== 'darwin') return null
  try {
    const stdout = await probes.runMdfind(bundleId)
    const path = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.endsWith('.app'))
    return path ?? null
  } catch {
    return null
  }
}

function linuxDesktopDirs(home: string, env: NodeJS.ProcessEnv): string[] {
  const dirs: string[] = []
  const dataHome = env.XDG_DATA_HOME ?? join(home, '.local', 'share')
  dirs.push(join(dataHome, 'applications'))
  const dataDirs = (env.XDG_DATA_DIRS ?? '/usr/local/share:/usr/share').split(':')
  for (const dir of dataDirs) {
    if (dir) dirs.push(join(dir, 'applications'))
  }
  // Non-PATH installs (manual /opt unpacks) that still register a launcher.
  dirs.push('/opt/libreoffice/program')
  return dirs
}

/** First token of an Exec= line (`soffice --impress %U` → `soffice`). */
export function parseDesktopExec(execLine: string): string | null {
  const input = execLine.trim()
  if (!input) return null
  const quoted = /^"((?:\\.|[^"\\])*)"/.exec(input)
  const token = quoted?.[1] ?? /^((?:\\.|[^\s\\])+)/.exec(input)?.[1]
  return token?.replace(/\\(.)/g, '$1') || null
}

function desktopEntryMatchesLibreOfficeImpress(content: string): boolean {
  const name = (/^Name=(.*)$/m.exec(content)?.[1] ?? '').toLowerCase()
  const exec = (/^Exec=(.*)$/m.exec(content)?.[1] ?? '').toLowerCase()
  return (
    (name.includes('libreoffice') && (name.includes('impress') || name.includes('presentation'))) ||
    /(^|[\s/])soffice(\.bin)?\b/.test(exec)
  )
}

/**
 * Linux `.desktop` launcher scan for LibreOffice Impress. Returns the
 * resolved `soffice` binary or null. PATH lookup (cheaper, in converters.ts)
 * runs first; this catches launchers whose Exec points outside PATH.
 */
export async function findLibreOfficeDesktopBinary(overrides?: OfficeProbes): Promise<string | null> {
  const probes = probesWith(overrides)
  if (probes.platform !== 'linux') return null
  const home = probes.homedir()
  for (const dir of linuxDesktopDirs(home, probes.env)) {
    let names: string[]
    try {
      names = await probes.readdir(dir)
    } catch {
      continue // missing/inaccessible dir — try the next one
    }
    for (const name of names.filter((n) => n.endsWith('.desktop'))) {
      const full = join(dir, name)
      let content: string
      try {
        content = await probes.readFile(full)
      } catch {
        continue // unreadable entry — skip it
      }
      if (!desktopEntryMatchesLibreOfficeImpress(content)) continue
      const execLine = /^Exec=(.*)$/m.exec(content)?.[1]
      if (!execLine) continue // malformed entry: matches but has no Exec=
      const binary = parseDesktopExec(execLine)
      if (!binary) continue
      if (isAbsolute(binary)) {
        try {
          await probes.access(binary)
          return binary
        } catch {
          continue
        }
      }
      return binary // bare command — caller resolves via PATH
    }
  }
  // Direct fallback for manual /opt installs with no registered launcher.
  try {
    await probes.access('/opt/libreoffice/program/soffice')
    return '/opt/libreoffice/program/soffice'
  } catch {
    /* not installed there */
  }
  return null
}
