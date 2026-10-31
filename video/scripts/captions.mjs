// Timed scratch captions from the approved VO: one source for the on-screen
// review captions (src/data/*-captions.json) and the .srt files.
//
//   node scripts/captions.mjs
//
// Hero and social VO come from the shot list (src/compositions/shots.ts);
// the walkthrough's from its chapters in docs/script.md. Lines are paced at
// about 140 words a minute from the start of their window.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const WPS = 140 / 60
const MAX_WORDS = 7

const { outputFiles } = await build({ entryPoints: [path.join(root, 'src/compositions/shots.ts')], bundle: true, format: 'esm', write: false })
const { HERO_SHOTS, SOCIAL_SHOTS, withStarts } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)

/** Stage directions in parentheses are not spoken. */
const spoken = (text) => text.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
const sentences = (text) => spoken(text).split(/(?<=[.!?])\s+/).filter(Boolean)

/** Lay sentences out from `start`, compressing to fit before `end`. */
function place(lines, start, end) {
  const words = lines.reduce((n, l) => n + l.split(' ').length, 0)
  const natural = words / WPS + lines.length * 0.35
  const room = Math.max(0.5, end - start - 0.3)
  const k = Math.min(1, room / natural)
  const cues = []
  let t = start
  for (const line of lines) {
    const w = line.split(' ')
    const dur = (w.length / WPS) * k
    // Even chunks, so a line never ends on a two-word stub.
    const per = Math.ceil(w.length / Math.ceil(w.length / MAX_WORDS))
    for (let i = 0; i < w.length; i += per) {
      const part = w.slice(i, i + per)
      const d = (dur * part.length) / w.length
      cues.push({ text: part.join(' '), startMs: Math.round(t * 1000), endMs: Math.round((t + d) * 1000), timestampMs: null, confidence: null })
      t += d
    }
    t += 0.35 * k
  }
  return cues
}

const fromShots = (shots, lead = 0.4) =>
  withStarts(shots).flatMap((s) => {
    const lines = sentences(s.vo)
    return lines.length ? place(lines, s.start + lead, s.start + s.duration) : []
  })

// Walkthrough chapters and their windows (match src/compositions/Walkthrough.tsx).
const CHAPTERS = [35, 40, 30, 55, 35, 15]
const md = await readFile(path.join(root, 'docs/script.md'), 'utf8')
const section = md.split('## 2. Walkthrough')[1].split('## 3. Social')[0]
const chapterText = section
  .split('\n')
  .map((l, i, all) => (all[i - 1]?.startsWith('**Chapter') ? l : null))
  .filter(Boolean)
let at = 0
const walkthrough = chapterText.flatMap((text, i) => {
  // Calmer than the hero: each VO line (split by " / ") gets an even share of
  // its chapter, so the picture can be cut to the line it illustrates.
  const lines = text.split(' / ')
  const slot = (CHAPTERS[i] - 1.2) / lines.length
  const cues = lines.flatMap((line, j) => place(sentences(line), at + 1.2 + j * slot, at + 1.2 + (j + 1) * slot))
  at += CHAPTERS[i]
  return cues
})

const srtTime = (ms) => {
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0')
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0')
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, '0')}`
}
const srt = (cues) => cues.map((c, i) => `${i + 1}\n${srtTime(c.startMs)} --> ${srtTime(c.endMs)}\n${c.text}\n`).join('\n')

const outDir = path.join(root, 'out/animatic')
await mkdir(outDir, { recursive: true })
for (const [name, cues] of [
  ['hero', fromShots(HERO_SHOTS)],
  ['social', fromShots(SOCIAL_SHOTS, 0.3)],
  ['walkthrough', walkthrough],
]) {
  await writeFile(path.join(root, `src/data/${name}-captions.json`), JSON.stringify(cues, null, 2) + '\n')
  await writeFile(path.join(outDir, `${name}.srt`), srt(cues))
  await writeFile(path.join(outDir, `${name}-voiceover.txt`), cues.map((c) => c.text).join(' ') + '\n')
  console.log(`${name}: ${cues.length} cues, ends ${(cues.at(-1).endMs / 1000).toFixed(1)}s`)
}
