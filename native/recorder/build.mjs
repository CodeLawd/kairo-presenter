// Builds the recorder N-API addon. macOS only; universal binary.
// AVFoundation does the encoding; the frame copy is a blit or a precompiled
// Metal Performance Shaders scale, so no Metal toolchain is needed.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
if (process.platform !== 'darwin') {
  console.log('recorder: macOS only — skipping')
  process.exit(0)
}
const headers = resolve(dirname(process.execPath), '../include/node')
if (!existsSync(resolve(headers, 'node_api.h'))) throw new Error(`node_api.h not found in ${headers}`)
mkdirSync(resolve(root, 'build'), { recursive: true })

const result = spawnSync('xcrun', [
  'clang++', '-x', 'objective-c++', '-std=c++17', '-O2', '-Wall', '-Wno-unused-parameter', '-Wno-deprecated-declarations',
  '-fobjc-arc', '-shared', '-undefined', 'dynamic_lookup',
  '-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=11.0',
  '-I', headers,
  resolve(root, 'recorder.mm'),
  '-framework', 'AVFoundation', '-framework', 'CoreMedia', '-framework', 'CoreVideo', '-framework', 'Accelerate',
  '-framework', 'Metal', '-framework', 'MetalPerformanceShaders', '-framework', 'IOSurface', '-framework', 'Foundation',
  '-o', resolve(root, 'build/recorder.node'),
], { stdio: 'inherit' })
process.exit(result.status ?? 1)
