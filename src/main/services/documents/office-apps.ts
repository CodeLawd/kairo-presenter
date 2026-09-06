import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const run = promisify(execFile)

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

async function applicationRoots(): Promise<string[]> {
  return [
    '/Applications',
    join(homedir(), 'Applications'),
    '/System/Applications',
  ]
}

export async function findAppByName(match: (name: string) => boolean): Promise<string | null> {
  for (const root of await applicationRoots()) {
    let names: string[]
    try {
      names = await fs.readdir(root)
    } catch {
      continue
    }
    const found = names.find(match)
    if (found) return join(root, found)
  }
  return null
}

export async function findAppByBundleId(bundleId: string): Promise<string | null> {
  if (process.platform !== 'darwin') return null
  try {
    const { stdout } = await run('mdfind', [`kMDItemCFBundleIdentifier == "${bundleId}"`], {
      timeout: 5_000,
    })
    const path = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.endsWith('.app'))
    return path ?? null
  } catch {
    return null
  }
}
