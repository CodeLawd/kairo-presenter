// Scratch voice-over with the Mac's built-in voice, one file per sentence,
// placed where the captions put it. Replaced by the recorded voice later.
//
//   node scripts/vo.mjs            (after scripts/captions.mjs)
//
// Writes public/audio/vo/<film>-NN.wav and src/data/<film>-vo.json.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const VOICE = process.env.VO_VOICE ?? 'Samantha'
const RATE = process.env.VO_RATE ?? '166'
const GAP_MS = 160
const probe = (file) =>
  Number(execFileSync('npx', ['remotion', 'ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { cwd: root, encoding: 'utf8' }).trim())

const outDir = path.join(root, 'public/audio/vo')
await mkdir(outDir, { recursive: true })

for (const film of ['hero', 'walkthrough', 'social']) {
  const cues = JSON.parse(await readFile(path.join(root, `src/data/${film}-captions.json`), 'utf8'))
  // Join caption chunks back into sentences.
  const sentences = []
  for (const c of cues) {
    const last = sentences.at(-1)
    if (last && !/[.?!]$/.test(last.text)) {
      last.text += ' ' + c.text
      last.endMs = c.endMs
    } else sentences.push({ text: c.text, startMs: c.startMs, endMs: c.endMs })
  }
  const lines = []
  let freeAt = 0
  for (const [i, s] of sentences.entries()) {
    const base = path.join(outDir, `${film}-${String(i).padStart(2, '0')}`)
    execFileSync('say', ['-v', VOICE, '-r', RATE, '--file-format=WAVE', '--data-format=LEI16@48000', '-o', `${base}.wav`, s.text])
    const durMs = Math.round(probe(`${base}.wav`) * 1000)
    // The voice is the timing source: a line never starts before the last one ends.
    const startMs = Math.max(s.startMs, freeAt)
    if (startMs - s.startMs > 600) console.warn(`${film} ${i}: starts ${startMs - s.startMs} ms after its slot: "${s.text}"`)
    freeAt = startMs + durMs + GAP_MS
    lines.push({ file: `audio/vo/${path.basename(base)}.wav`, text: s.text, startMs, durMs })
  }
  await writeFile(path.join(root, `src/data/${film}-vo.json`), JSON.stringify(lines, null, 2) + '\n')
  // Captions follow the voice: re-time each sentence's chunks across its spoken duration.
  const retimed = []
  for (const l of lines) {
    const chunks = cues.filter((c) => l.text.startsWith(c.text) || l.text.includes(c.text)).filter((c, k, all) => all.indexOf(c) === k)
    const words = l.text.split(' ').length
    let t = l.startMs
    for (const c of chunks.filter((c) => !retimed.includes(c))) {
      const d = (l.durMs * c.text.split(' ').length) / words
      retimed.push(c)
      c.startMs = Math.round(t)
      c.endMs = Math.round(t + d)
      t += d
    }
  }
  await writeFile(path.join(root, `src/data/${film}-captions.json`), JSON.stringify(cues, null, 2) + '\n')
  console.log(`${film}: ${lines.length} lines`)
}
