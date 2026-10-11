// Builds the gpu-frames N-API addon (plan 008). macOS only; universal binary.
// N-API is ABI-stable, so the one .node file loads in Node (tests) and Electron.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
if (process.platform !== 'darwin') {
  console.log('gpu-frames: macOS only — skipping (the CPU capture path is used elsewhere)')
  process.exit(0)
}
const headers = resolve(dirname(process.execPath), '../include/node')
if (!existsSync(resolve(headers, 'node_api.h'))) throw new Error(`node_api.h not found in ${headers}`)
mkdirSync(resolve(root, 'build'), { recursive: true })
const result = spawnSync('xcrun', [
  'clang++', '-std=c++17', '-O2', '-Wall', '-Wextra', '-Wno-unused-parameter',
  '-ObjC++', '-fobjc-arc', '-shared', '-undefined', 'dynamic_lookup',
  '-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=11.0',
  '-I', headers, '-I', root,
  resolve(root, 'gpu_frames.mm'),
  '-framework', 'Metal', '-framework', 'Foundation', '-framework', 'IOSurface', '-framework', 'CoreFoundation',
  '-o', resolve(root, 'build/gpu_frames.node'),
], { stdio: 'inherit' })
process.exit(result.status ?? 1)
