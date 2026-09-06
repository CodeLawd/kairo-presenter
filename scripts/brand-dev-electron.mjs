#!/usr/bin/env node
/**
 * Brand the stock Electron.dev bundle so macOS Dock / ⌘-Tab show "Kairo"
 * instead of "Electron".
 *
 * macOS reads the name from the .app folder name + Info.plist at launch —
 * before any JavaScript runs. `app.setName()` only affects Electron's own
 * menus / About panel / userData path. Packaged builds get this for free;
 * this script puts the node_modules Electron.app in that same state for `npm run dev`.
 *
 * Idempotent. macOS-only (no-op elsewhere). Safe across npm installs: we
 * unlink Info.plist before rewriting so we never mutate a shared store inode.
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const require = createRequire(import.meta.url)

const NAME_KEYS = ['CFBundleDisplayName', 'CFBundleName']

function warn(message) {
  console.warn(`[brand-dev-electron] ${message}`)
}

function productName() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const name = pkg.productName || pkg.build?.productName
  if (!name || typeof name !== 'string') {
    warn('No productName in package.json — leaving the Electron bundle alone.')
    return null
  }
  if (name.includes('/') || name.includes('\0')) {
    warn(`productName "${name}" cannot be used as a bundle name.`)
    return null
  }
  return name
}

function electronPackageDir() {
  return dirname(require.resolve('electron/package.json'))
}

function plistGet(plistPath, key) {
  try {
    return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plistPath], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return null
  }
}

function plistSet(plistPath, key, value) {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plistPath])
  } catch {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plistPath])
  }
}

/**
 * Rename dist/Electron.app → dist/<productName>.app and keep path.txt in sync
 * so the `electron` package still finds its binary.
 */
function ensureBundleName(pkgDir, name) {
  const distDir = join(pkgDir, 'dist')
  const pathFile = join(pkgDir, 'path.txt')
  if (!existsSync(pathFile)) {
    warn(`No ${pathFile} — leaving the bundle alone.`)
    return null
  }

  const relative = readFileSync(pathFile, 'utf8').trim()
  const segments = relative.split('/')
  const currentName = segments[0]
  const desiredName = `${name}.app`
  if (!currentName.endsWith('.app')) {
    warn(`Unexpected path.txt entry "${relative}" — leaving the bundle alone.`)
    return null
  }

  const desiredDir = join(distDir, desiredName)
  if (currentName === desiredName && existsSync(desiredDir)) {
    return { appDir: desiredDir, renamed: false }
  }

  const currentDir = join(distDir, currentName)
  let renamed = false
  if (existsSync(currentDir) && currentDir !== desiredDir) {
    if (existsSync(desiredDir)) {
      warn(`Both ${currentName} and ${desiredName} exist — using the latter.`)
    } else {
      renameSync(currentDir, desiredDir)
      renamed = true
    }
  } else if (!existsSync(desiredDir)) {
    warn(`No Electron bundle under ${distDir} — leaving the bundle alone.`)
    return null
  }

  segments[0] = desiredName
  writeFileSync(pathFile, segments.join('/'))
  return { appDir: desiredDir, renamed }
}

function patchPlist(appDir, name) {
  const plistPath = join(appDir, 'Contents', 'Info.plist')
  if (!existsSync(plistPath)) {
    warn(`No Info.plist at ${plistPath}.`)
    return false
  }

  const stale = NAME_KEYS.filter((key) => plistGet(plistPath, key) !== name)
  if (stale.length === 0) return false

  // Break hardlinks into a shared store before writing.
  const original = readFileSync(plistPath)
  unlinkSync(plistPath)
  writeFileSync(plistPath, original)

  for (const key of stale) plistSet(plistPath, key, name)
  return true
}

function refreshLaunchServices(appDir) {
  const lsregister =
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
  if (!existsSync(lsregister)) return
  try {
    execFileSync(lsregister, ['-f', appDir], { stdio: 'ignore' })
  } catch {
    /* best-effort */
  }
}

function main() {
  if (process.platform !== 'darwin') return

  const name = productName()
  if (!name) return

  let pkgDir
  try {
    pkgDir = electronPackageDir()
  } catch (err) {
    warn(`Could not resolve electron: ${(err).message}`)
    return
  }

  let bundle
  try {
    bundle = ensureBundleName(pkgDir, name)
  } catch (err) {
    warn(`Could not rename the dev bundle: ${(err).message}`)
    return
  }
  if (!bundle) return

  let patched = false
  try {
    patched = patchPlist(bundle.appDir, name)
  } catch (err) {
    warn(`Could not patch Info.plist: ${(err).message}`)
    return
  }

  if (bundle.renamed || patched) {
    refreshLaunchServices(bundle.appDir)
    console.log(`[brand-dev-electron] Dev Electron bundle now identifies as "${name}".`)
  }
}

main()
