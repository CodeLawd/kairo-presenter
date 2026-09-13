#!/usr/bin/env node
/**
 * Package integrity verifier (Plan 003).
 *
 * Usage:
 *   node scripts/verify-package.mjs <artifact-or-unpacked-app> <platform> <arch>
 *
 * platform: darwin | win32 | linux
 * arch: arm64 | x64
 *
 * Checks:
 * - main, preload, renderer output exist
 * - bible.db exists and is readable (non-empty)
 * - correct better-sqlite3 addon exists outside ASAR
 * - selected NDI addon/runtime exist outside ASAR
 * - no foreign native libraries exist
 * - unpacked app architecture matches the requested target (macOS only)
 *
 * Exit 0 on success, nonzero with diagnostics on failure.
 * Size is reported as diagnostic output with a generous per-target ceiling
 * (not a brittle exact assertion).
 */
import { promises as fs } from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const run = promisify(execFile)

const [, , targetPath, platform, arch] = process.argv

const SIZE_CEILINGS_MB = {
  'darwin:arm64': 600,
  'darwin:x64': 600,
  'win32:x64': 600,
  'linux:x64': 700,
}

function fail(msg) {
  console.error(`verify-package FAIL: ${msg}`)
  process.exit(1)
}

function ok(msg) {
  console.log(`verify-package ok: ${msg}`)
}

async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function findFiles(dir, predicate, out = []) {
  if (out.length > 5000) return out // cap total matches to avoid runaway output
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      await findFiles(full, predicate, out)
    } else if (predicate(full, e.name)) {
      out.push(full)
    }
    if (out.length > 5000) return out
  }
  return out
}

if (!targetPath || !platform || !arch) {
  console.error('Usage: node scripts/verify-package.mjs <app-dir> <darwin|win32|linux> <arm64|x64>')
  process.exit(2)
}

const tuple = `${platform}:${arch}`
if (!['darwin:arm64', 'darwin:x64', 'win32:x64', 'linux:x64'].includes(tuple)) {
  fail(`unsupported tuple ${tuple}`)
}

const appDir = path.resolve(targetPath)
if (!(await exists(appDir))) fail(`target does not exist: ${appDir}`)

// Resolve to the unpacked resources root:
// - mac: Kairo.app/Contents/Resources[/app.asar.unpacked]
// - win/linux unpacked dir: resources[/app.asar.unpacked]
async function resolveRoots(base) {
  const candidates = [
    path.join(base, 'Contents', 'Resources'),
    path.join(base, 'resources'),
    base,
  ]
  for (const c of candidates) {
    if (await exists(path.join(c, 'app.asar'))) return c
  }
  // electron-builder --dir layout may nest one level deeper; search shallowly.
  let entries = []
  try {
    entries = await fs.readdir(base, { withFileTypes: true })
  } catch { /* ignore */ }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    for (const c of [path.join(base, e.name, 'Contents', 'Resources'), path.join(base, e.name, 'resources')]) {
      if (await exists(path.join(c, 'app.asar'))) return c
    }
  }
  return null
}

const resourcesRoot = await resolveRoots(appDir)
if (!resourcesRoot) fail(`no app.asar found under ${appDir} (pass the unpacked .app / unpacked dir)`)

// 1. app.asar + unpacked dir exist
const unpackedRoot = path.join(resourcesRoot, 'app.asar.unpacked')
if (!(await exists(unpackedRoot))) fail(`missing app.asar.unpacked under ${resourcesRoot}`)
ok('app.asar + app.asar.unpacked exist')

// 2. main / preload / renderer — the compiled out/ lives inside the ASAR,
// so list it once and reuse the listing for the junk-dir and dependency
// checks below. If listing is unavailable, warn and check only the unpacked
// native payload (fail-open, but loud about it).
let asarListing = null
try {
  // Run the asar CLI's JS entry with this Node binary instead of the
  // node_modules/.bin shim: Node refuses to spawn .cmd files without a shell
  // on Windows (spawn EINVAL, CVE-2024-27980).
  const asarCli = path.join(process.cwd(), 'node_modules', '@electron', 'asar', 'bin', 'asar.js')
  const result = await run(process.execPath, [asarCli, 'list', path.join(resourcesRoot, 'app.asar')], {
    timeout: 120_000,
    maxBuffer: 256 * 1024 * 1024,
  })
  // asar lists with the platform separator (and CRLF on Windows); the checks
  // below expect POSIX-style `/out/main/...` lines.
  asarListing = result.stdout.replace(/\r\n/g, '\n').replace(/\\/g, '/')
} catch (err) {
  fail(`asar listing unavailable; package contents could not be verified (${err.message})`)
}
if (asarListing) {
  for (const needle of ['/out/main/', '/out/preload/', '/out/renderer/']) {
    if (!asarListing.includes(needle)) fail(`app.asar missing ${needle}`)
  }
  ok('main, preload, renderer output exist in app.asar')
  // No junk top-level dirs (repo layout must not leak into the artifact).
  // electron-builder REPLACES top-level `files` with a platform `files` block,
  // so each platform block in package.json must repeat the full whitelist —
  // this check catches regressions (including secret leaks like .env).
  // Anchored to top level: nested node_modules/*/src|scripts dirs are fine.
  const junkTop = [
    'website', 'server', 'src', 'tests', 'docs', 'plans',
    'design', 'scripts', '.claude', '.vite',
  ]
  const topDirs = new Set(
    asarListing.split('\n').map((l) => l.split('/')[1]).filter(Boolean),
  )
  const leaked = junkTop.filter((d) => topDirs.has(d))
  if (asarListing.split('\n').some((l) => l === '/.env' || l.startsWith('/.env.'))) {
    leaked.push('.env*')
  }
  if (leaked.length > 0) fail(`packaged app contains repo dirs: ${leaked.join(', ')}`)
  ok('no repo junk dirs in app.asar')
}

// 3. bible.db exists and is non-empty
const bibleCandidates = [
  path.join(resourcesRoot, 'bible.db'),
  path.join(resourcesRoot, '..', 'bible.db'),
]
let biblePath = null
for (const c of bibleCandidates) {
  if (await exists(c)) {
    biblePath = c
    break
  }
}
// Also search extraResources staging locations one level deep.
if (!biblePath) {
  const found = await findFiles(resourcesRoot, (full, name) => name === 'bible.db')
  biblePath = found[0] ?? null
}
if (!biblePath) fail('bible.db not found in packaged resources')
const bibleStat = await fs.stat(biblePath)
if (bibleStat.size < 1024) fail(`bible.db suspiciously small (${bibleStat.size} bytes)`)
ok(`bible.db exists (${(bibleStat.size / 1048576).toFixed(1)} MB)`)

// 4. better-sqlite3 addon outside ASAR
const sqliteAddons = await findFiles(unpackedRoot, (full, name) =>
  name === 'better_sqlite3.node' && full.includes('better-sqlite3'),
)
if (sqliteAddons.length === 0) fail('better-sqlite3 native addon missing outside ASAR')
ok(`better-sqlite3 addon: ${path.relative(unpackedRoot, sqliteAddons[0])}`)

// 5. NDI addon + runtime outside ASAR (per-platform expectations)
const allNode = await findFiles(unpackedRoot, (full, name) => name.endsWith('.node'))
const hasNdiNode = allNode.filter((f) => /grandiose|grandi/i.test(f))
if (hasNdiNode.length === 0) fail('NDI native addon (.node) missing outside ASAR')
ok(`NDI addon: ${hasNdiNode.map((f) => path.relative(unpackedRoot, f)).join(', ')}`)

const runtimeExpect = {
  darwin: { ext: '.dylib', label: 'libndi.dylib' },
  win32: { ext: '.dll', label: 'Processing.NDI.Lib.x64.dll' },
  linux: { ext: '.so', label: 'libndi.so' },
}[platform]
const runtimes = await findFiles(
  unpackedRoot,
  (full, name) => name.endsWith(runtimeExpect.ext) && /ndi/i.test(full),
)
if (runtimes.length === 0) fail(`NDI runtime (${runtimeExpect.label}) missing for ${platform}`)
ok(`NDI runtime: ${runtimes.map((f) => path.relative(unpackedRoot, f)).join(', ')}`)

// 6. No foreign native libraries
const foreignPatterns = {
  darwin: [/\.dll$/i, /\.so(\.|$)/i, /lib\/win_/i, /lib\/linux_/i],
  win32: [/\.dylib$/i, /\.so(\.|$)/i, /lib\/mac_universal/i, /lib\/linux_/i, /lib\/win_x86/i],
  linux: [/\.dylib$/i, /\.dll$/i, /lib\/mac_universal/i, /lib\/win_/i, /lib\/linux_arm64/i],
}[platform]
const allNative = await findFiles(
  unpackedRoot,
  (full, name) =>
    name.endsWith('.node') || name.endsWith('.dylib') || name.endsWith('.dll') || /\.so(\.|$)/.test(name),
)
// Patterns use `/`; normalize Windows paths so they can actually match.
const foreign = allNative.filter((f) => foreignPatterns.some((re) => re.test(f.replace(/\\/g, '/'))))
if (foreign.length > 0) {
  fail(`foreign native payload present:\n  ${foreign.map((f) => path.relative(unpackedRoot, f)).join('\n  ')}`)
}
ok(`no foreign native payload (${allNative.length} native files, all target-specific)`)

// 7. Production deps required by main/preload resolve (spot check).
// Note: only asarUnpack entries live in app.asar.unpacked; the rest of
// node_modules is inside app.asar. Check unpacked first, then the ASAR index
// captured in step 2.
for (const dep of ['electron-store', 'electron-log', 'better-sqlite3', 'electron-updater']) {
  if (await exists(path.join(unpackedRoot, 'node_modules', dep))) continue
  if (asarListing && asarListing.includes(`/node_modules/${dep}/package.json`)) continue
  fail(`production dependency missing from package: ${dep}`)
}
ok('production dependencies resolve')

// 8. Architecture check (macOS: every NDI addon must match; elsewhere informational)
if (platform === 'darwin') {
  const want = arch === 'arm64' ? 'arm64' : 'x86_64'
  const reject = arch === 'arm64' ? 'x86_64' : 'arm64'
  for (const addon of hasNdiNode) {
    let stdout
    try {
      ;({ stdout } = await run('lipo', ['-archs', addon], { timeout: 30_000 }))
    } catch (err) {
      fail(`could not inspect NDI addon architecture (${path.relative(unpackedRoot, addon)}): ${err.message}`)
    }
    const archs = stdout.trim().split(/\s+/)
    if (!archs.includes(want) || archs.includes(reject)) {
      fail(`NDI addon ${path.relative(unpackedRoot, addon)} has archs [${archs}], expected only ${want}`)
    }
  }
  ok(`all ${hasNdiNode.length} NDI addons match ${arch}`)
}

// 9. Size diagnostic with generous ceiling
async function dirSize(dir) {
  let total = 0
  async function walk(d) {
    let entries
    try {
      entries = await fs.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) await walk(full)
      else {
        try {
          total += (await fs.stat(full)).size
        } catch { /* ignore */ }
      }
    }
  }
  await walk(dir)
  return total
}
const bytes = await dirSize(appDir)
const mb = bytes / 1048576
const ceiling = SIZE_CEILINGS_MB[tuple]
console.log(`verify-package info: unpacked size ${mb.toFixed(1)} MB (ceiling ${ceiling} MB)`)
if (mb > ceiling) fail(`unpacked size ${mb.toFixed(1)} MB exceeds ceiling ${ceiling} MB`)

console.log(`\nverify-package PASS: ${appDir} [${tuple}]`)
