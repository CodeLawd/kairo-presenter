// Synthesized sound effects (no samples, nothing to license). Soft by design:
// the "premium" rule is a handful of quiet hits, nothing loud or cartoonish.
//
//   node scripts/sfx.mjs   → public/audio/sfx/*.wav (48 kHz mono)
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { rng } from './rng.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SR = 48000
const out = path.join(root, 'public/audio/sfx')
await mkdir(out, { recursive: true })

function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples.length * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(samples.length * 2, 40)
  const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 1e-9)
  samples.forEach((v, i) => buf.writeInt16LE(Math.round((v / peak) * 0.89 * 32767), 44 + i * 2))
  return buf
}

const make = (seconds, fn) => Array.from({ length: Math.round(seconds * SR) }, (_, i) => fn(i / SR, i))
/** One-pole low-pass over a buffer, cutoff in Hz (may vary over time). */
function lowpass(x, cutoff) {
  let y = 0
  return x.map((v, i) => {
    const fc = typeof cutoff === 'function' ? cutoff(i / SR) : cutoff
    const a = 1 - Math.exp((-2 * Math.PI * fc) / SR)
    y += a * (v - y)
    return y
  })
}
const noise = (seed) => {
  const r = rng(seed)
  return () => r() * 2 - 1
}

const sounds = {
  // A soft key: a short, dull tap.
  key: () => {
    const n = noise(1)
    return lowpass(make(0.045, (t) => n() * Math.exp(-t / 0.006) + 0.5 * Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t / 0.01)), 3200)
  },
  // A word arriving in the transcript: a tiny glassy tick.
  tick: () => make(0.06, (t) => Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t / 0.008) * 0.6 + Math.sin(2 * Math.PI * 1200 * t) * Math.exp(-t / 0.012) * 0.4),
  // The press: a trackpad click, two close transients.
  click: () => {
    const n = noise(2)
    return lowpass(make(0.07, (t) => (n() * Math.exp(-t / 0.003) + n() * Math.exp(-Math.max(0, t - 0.012) / 0.004) * (t > 0.012 ? 0.7 : 0)) + Math.sin(2 * Math.PI * 900 * t) * Math.exp(-t / 0.01) * 0.5), 5000)
  },
  // A card landing: a soft rounded pop, pitch falling.
  pop: () => make(0.16, (t) => Math.sin(2 * Math.PI * (520 - 900 * t) * t) * Math.exp(-t / 0.035)),
  // Air moving past: filtered noise with a swept cutoff.
  whoosh: () => {
    const n = noise(3)
    const d = 0.8
    return lowpass(make(d, (t) => n() * Math.sin((Math.PI * t) / d) ** 2), (t) => 300 + 2600 * Math.sin((Math.PI * t) / d))
  },
  // The match lighting up: three soft rising partials.
  shimmer: () =>
    make(1.4, (t) => {
      const notes = [659.25, 830.61, 987.77, 1318.5]
      return notes.reduce((s, f, k) => {
        const at = k * 0.09
        const u = t - at
        return u < 0 ? s : s + Math.sin(2 * Math.PI * f * u) * Math.exp(-u / 0.5) * Math.min(1, u / 0.01) * (1 - k * 0.15)
      }, 0)
    }),
  // The send: a low swell that blooms and settles.
  swell: () => {
    const n = noise(4)
    const lp = lowpass(make(3.2, () => n()), 400)
    return make(3.2, (t, i) => {
      const env = Math.min(1, t / 0.08) * Math.exp(-t / 1.1)
      return env * (Math.sin(2 * Math.PI * 55 * t) * 0.9 + Math.sin(2 * Math.PI * 110 * t) * 0.35 + Math.sin(2 * Math.PI * 164.8 * t) * 0.15 + lp[i] * 0.6)
    })
  },
  // A rise into the room / the title: noise and a fifth, swelling in.
  rise: () => {
    const n = noise(5)
    const d = 1.6
    const air = lowpass(make(d, () => n()), (t) => 200 + 3000 * (t / d) ** 2)
    return make(d, (t, i) => {
      const env = (t / d) ** 2 * (1 - Math.max(0, (t - d + 0.08) / 0.08))
      return env * (air[i] * 0.8 + Math.sin(2 * Math.PI * (110 + 40 * t) * t) * 0.3)
    })
  },
  // The logo: a soft, deep impact.
  impact: () => {
    const n = noise(6)
    return make(1.6, (t) => Math.sin(2 * Math.PI * (70 - 25 * t) * t) * Math.exp(-t / 0.45) + n() * Math.exp(-t / 0.015) * 0.4)
  },
}

for (const [name, fn] of Object.entries(sounds)) {
  await writeFile(path.join(out, `${name}.wav`), wav(fn()))
  console.log('sfx', name)
}
