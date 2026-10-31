/**
 * Motion primitives. Everything is a pure function of time in seconds, so
 * any frame renders identically on its own.
 */

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/** 0→1 over [a, b], unshaped. Only ever fed into an easing or a spring. */
export const seg = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a))

/** Cubic in-out. */
export const io = (x: number): number => {
  const v = clamp01(x)
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2
}
/** Quint out: fast start, long settle. */
export const out = (x: number): number => 1 - Math.pow(1 - clamp01(x), 5)
/** Exponential out. */
export const expo = (x: number): number => {
  const v = clamp01(x)
  return v === 1 ? 1 : 1 - Math.pow(2, -10 * v)
}

export type SpringPreset = { k: number; d: number }
/** Skill presets: snappy UI, default containers and camera, heavy type and logos. */
export const SNAPPY: SpringPreset = { k: 320, d: 30 }
export const SOFT: SpringPreset = { k: 170, d: 26 }
export const HEAVY: SpringPreset = { k: 120, d: 24 }

/**
 * Closed-form step response of a unit-mass spring released at `start`
 * (seconds). Damping ratio stays ≥ 0.72 for every preset, so at most a
 * whisper of overshoot.
 */
export function spring(t: number, start: number, { k, d }: SpringPreset = SOFT): number {
  const x = t - start
  if (x <= 0) return 0
  const w = Math.sqrt(k)
  const z = d / (2 * w)
  if (z >= 1) {
    // Critically damped (or over): no overshoot.
    return 1 - Math.exp(-w * x) * (1 + w * x)
  }
  const wd = w * Math.sqrt(1 - z * z)
  return 1 - Math.exp(-z * w * x) * (Math.cos(wd * x) + (z / Math.sqrt(1 - z * z)) * Math.sin(wd * x))
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Keyed values with eased segments: keys of [t, value]. */
export function kf(t: number, keys: [number, number][], ease: (x: number) => number = io): number {
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]
    if (t <= t1) {
      const [t0, v0] = keys[i - 1]
      return lerp(v0, v1, ease((t - t0) / (t1 - t0)))
    }
  }
  return keys[keys.length - 1][1]
}

export type CamKey = [t: number, zoom: number, x: number, y: number]
export type Cam = { zoom: number; x: number; y: number }

/** Camera keys with zoom interpolated in log space, so pushes feel even at every scale. */
export function camera(t: number, keys: CamKey[], ease: (x: number) => number = io): Cam {
  if (t <= keys[0][0]) return { zoom: keys[0][1], x: keys[0][2], y: keys[0][3] }
  for (let i = 1; i < keys.length; i++) {
    const [t1, z1, x1, y1] = keys[i]
    if (t <= t1) {
      const [t0, z0, x0, y0] = keys[i - 1]
      const e = ease((t - t0) / (t1 - t0))
      return { zoom: Math.exp(lerp(Math.log(z0), Math.log(z1), e)), x: lerp(x0, x1, e), y: lerp(y0, y1, e) }
    }
  }
  const [, z, x, y] = keys[keys.length - 1]
  return { zoom: z, x, y }
}

/** Seeded PRNG (mulberry32): never Math.random. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A slow, continuous drift so no frame is ever frozen. */
export const drift = (t: number, amp: number, period = 9, phase = 0): number => Math.sin((t / period) * Math.PI * 2 + phase) * amp
