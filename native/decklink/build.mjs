import { spawnSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = dirname(fileURLToPath(import.meta.url))
const sdk = process.env.DECKLINK_SDK_PATH || process.argv[2]
if (process.platform !== 'darwin' || !sdk) throw new Error('Build on macOS with DECKLINK_SDK_PATH pointing to the extracted SDK')
const includes = resolve(sdk, 'Mac/include')
if (!existsSync(resolve(includes, 'DeckLinkAPI.h'))) throw new Error('DeckLink Mac headers not found')
mkdirSync(resolve(root, 'build'), { recursive: true })
// Universal, so the same helper ships in the Apple Silicon and Intel builds.
const result = spawnSync('xcrun', ['clang++', '-std=c++17', '-O2', '-Wall', '-Wextra', '-pthread',
  '-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=11.0', '-I', includes,
  resolve(root, 'helper.cpp'), resolve(includes, 'DeckLinkAPIDispatch.cpp'), '-framework', 'CoreFoundation',
  '-o', resolve(root, 'build/decklink-helper')], { stdio: 'inherit' })
process.exit(result.status ?? 1)
