// Render stills of a composition at given seconds, for review.
//   node scripts/probe.mjs Hero1080 out/probe 2.5 6 14 ...
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const [id, outDir, ...times] = process.argv.slice(2)
const out = path.resolve(root, outDir)
await mkdir(out, { recursive: true })
const serveUrl = await bundle({ entryPoint: path.join(root, 'src/index.ts') })
const composition = await selectComposition({ serveUrl, id, timeoutInMilliseconds: 120000 })
for (const s of times) {
  const frame = Math.min(composition.durationInFrames - 1, Math.round(Number(s) * composition.fps))
  const file = path.join(out, `${id}-${String(s).padStart(5, '0')}.png`)
  await renderStill({ serveUrl, composition, frame, output: file, scale: 0.5, timeoutInMilliseconds: 120000 })
  console.log(file)
}
