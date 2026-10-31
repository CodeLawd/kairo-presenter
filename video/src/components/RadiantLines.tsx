import { useMemo } from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { useDesign } from './Stage'
import { RADIANT } from '../tokens/tokens'

/**
 * The website's radiant lines (website/src/components/landing/ThesisLines.tsx),
 * made deterministic: every star's depth is a pure function of the distance
 * travelled so far, so any frame renders the same on any machine. `warp` is
 * the speed curve over time, in the site's units (0.22 is its idle drift,
 * 8 its hardest warp).
 */

const STAR_COUNT = 420
const DEPTH = 1000
const TRAVEL_PER_SEC = 2.4 * 60
const TRAIL_DT = 1 / 60

export const IDLE = 0.22

const hash = (n: number): number => {
  let t = (n + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function RadiantLines({
  warp = () => IDLE,
  direction = 1,
  opacity = 1,
  seed = 7,
}: {
  /** Speed at a frame. */
  warp?: (frame: number) => number
  /** 1 streams out of the center toward the camera; -1 pulls in. */
  direction?: 1 | -1
  opacity?: number
  seed?: number
}): React.ReactElement {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const { w: width, h: height } = useDesign()

  // Distance travelled up to this frame: the integral of the speed curve.
  const travelled = useMemo(() => {
    let sum = 0
    for (let f = 0; f < frame; f++) sum += warp(f) * TRAVEL_PER_SEC * (1 / fps)
    return sum
  }, [frame, fps, warp])
  const speed = warp(frame)

  const cx = width / 2
  const cy = height / 2
  const focal = Math.max(width, height) * 0.5
  // The site draws at CSS pixels; scale strokes with the frame so 4K matches 1080p.
  const px = Math.max(width, height) / 1920

  const lines: React.ReactElement[] = []
  for (let i = 0; i < STAR_COUNT; i++) {
    const z0 = hash(seed * 9973 + i) * DEPTH
    const path = z0 - direction * travelled
    const cycle = Math.floor(path / DEPTH)
    const z = Math.max(1.01, path - cycle * DEPTH)
    const key = seed * 7919 + i * 131 + cycle * 17
    const x = (hash(key) - 0.5) * DEPTH
    const y = (hash(key + 1) - 0.5) * DEPTH
    const color = RADIANT[Math.floor(hash(key + 2) * RADIANT.length)]
    // Tails are drawn longer than the site's so the streaks read at film distance.
    const pz = Math.min(DEPTH, Math.max(1.01, z + direction * Math.max(speed, 0.5) * TRAVEL_PER_SEC * TRAIL_DT * 12))

    const k = focal / z
    const sx = cx + x * k
    const sy = cy + y * k
    const pk = focal / pz
    const tx = cx + x * pk
    const ty = cy + y * pk
    if ((sx < -50 && tx < -50) || (sx > width + 50 && tx > width + 50) || (sy < -50 && ty < -50) || (sy > height + 50 && ty > height + 50)) continue

    const near = 1 - z / DEPTH
    const w = Math.max(0.8, near * (1.8 + speed * 0.12)) * px
    lines.push(
      <g key={i} opacity={0.35 + near * 0.65}>
        <line x1={tx} y1={ty} x2={sx} y2={sy} stroke={color} strokeWidth={w} strokeLinecap="round" />
        {near > 0.45 && <circle cx={sx} cy={sy} r={w * 0.9} fill={color} />}
      </g>,
    )
  }

  return (
    <AbsoluteFill style={{ opacity }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {lines}
      </svg>
    </AbsoluteFill>
  )
}
