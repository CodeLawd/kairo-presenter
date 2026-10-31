// Render the films with sound, then normalise each mix to -14 LUFS (two-pass
// loudnorm, true peak -1 dB). Video is copied untouched.
//
//   node scripts/render-films.mjs [Hero1080 Walkthrough Social]
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { bundle } from '@remotion/bundler'
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const out = path.join(root, 'out/films')
await mkdir(out, { recursive: true })
const ff = (args) => execFileSync('npx', ['remotion', 'ffmpeg', '-hide_banner', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
/** ffmpeg's log (stderr), whatever the exit code: loudnorm prints its JSON there. */
const ffErr = (args) => spawnSync('npx', ['remotion', 'ffmpeg', '-hide_banner', ...args], { cwd: root, encoding: 'utf8' }).stderr

const FILMS = {
  Hero1080: { name: 'hero', poster: 41.5 },
  Walkthrough: { name: 'walkthrough', poster: 136 },
  Social: { name: 'social', poster: 11.5 },
}
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(FILMS)
const serveUrl = await bundle({ entryPoint: path.join(root, 'src/index.ts') })

for (const id of ids) {
  const { name, poster } = FILMS[id]
  const composition = await selectComposition({ serveUrl, id, timeoutInMilliseconds: 120000 })
  const raw = path.join(out, `${name}-raw.mp4`)
  let last = -1
  await renderMedia({
    serveUrl,
    composition,
    codec: 'h264',
    outputLocation: raw,
    crf: 18,
    pixelFormat: 'yuv420p',
    audioBitrate: '256k',
    concurrency: 6,
    timeoutInMilliseconds: 120000,
    onProgress: ({ progress }) => {
      const step = Math.floor(progress * 10)
      if (step > last) {
        last = step
        console.log(`${name}: ${step * 10}%`)
      }
    },
  })
  // Pass 1: measure. ffmpeg prints the loudnorm JSON on stderr (the null muxer "fails" quietly).
  const log = ffErr(['-i', raw, '-vn', '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-c:a', 'pcm_s16le', '-f', 'null', '-'])
  const m = JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1))
  // Pass 2: correct, linear when possible.
  const af = `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
  const final = path.join(out, `${name}.mp4`)
  ff(['-y', '-v', 'error', '-i', raw, '-c:v', 'copy', '-af', af, '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', final])
  await rm(raw)
  const check = ffErr(['-i', final, '-vn', '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-c:a', 'pcm_s16le', '-f', 'null', '-'])
  const c = JSON.parse(check.slice(check.lastIndexOf('{'), check.lastIndexOf('}') + 1))
  await renderStill({ serveUrl, composition, frame: Math.round(poster * composition.fps), output: path.join(out, `${name}-poster.png`), timeoutInMilliseconds: 120000 })
  console.log(`${name}: done, ${c.input_i} LUFS, true peak ${c.input_tp} dB → ${path.relative(root, final)}`)
}
