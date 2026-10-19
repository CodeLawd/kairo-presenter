// Builds the syphon N-API addon. macOS only; universal binary.
// Syphon's server/client base and messaging (vendor/Syphon, BSD) are compiled
// straight in, so there is no Syphon.framework to ship and no Metal toolchain
// to install: the frame copy is a blit, not a shader.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
if (process.platform !== 'darwin') {
  console.log('syphon: macOS only — skipping')
  process.exit(0)
}
const headers = resolve(dirname(process.execPath), '../include/node')
if (!existsSync(resolve(headers, 'node_api.h'))) throw new Error(`node_api.h not found in ${headers}`)
const vendor = resolve(root, 'vendor/Syphon')
const objects = resolve(root, 'build/obj')
mkdirSync(objects, { recursive: true })

const common = [
  '-O2', '-Wall', '-Wno-unused-parameter', '-Wno-deprecated-declarations', '-fobjc-arc',
  '-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=11.0',
  // `#import <Syphon/…>` resolves to vendor/Syphon/….
  '-I', headers, '-I', resolve(root, 'vendor'), '-I', vendor,
]

function compile(source, language, extra = []) {
  const out = resolve(objects, `${basename(source)}.o`)
  const result = spawnSync('xcrun', ['clang', '-c', '-x', language, ...common, ...extra, source, '-o', out], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
  return out
}

// Syphon's prefix header pulls in Cocoa and its logging macro.
const prefix = ['-include', resolve(vendor, 'Syphon_Prefix.pch')]
const built = [
  compile(resolve(root, 'syphon.mm'), 'objective-c++', ['-std=c++17', ...prefix]),
  ...readdirSync(vendor).filter((name) => name.endsWith('.m')).map((name) => compile(resolve(vendor, name), 'objective-c', prefix)),
  ...readdirSync(vendor).filter((name) => name.endsWith('.c')).map((name) => compile(resolve(vendor, name), 'c')),
]

const link = spawnSync('xcrun', [
  'clang++', '-shared', '-undefined', 'dynamic_lookup', '-fobjc-arc',
  '-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=11.0',
  ...built,
  '-framework', 'Metal', '-framework', 'Foundation', '-framework', 'IOSurface',
  '-framework', 'CoreFoundation', '-framework', 'Cocoa',
  '-o', resolve(root, 'build/syphon.node'),
], { stdio: 'inherit' })
process.exit(link.status ?? 1)
