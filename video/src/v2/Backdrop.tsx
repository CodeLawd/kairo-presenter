import { AbsoluteFill } from 'remotion'

/** Onyx with a soft light from above, the room every scene sits in. */
export function Backdrop({ light = 1 }: { light?: number }): React.ReactElement {
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(70% 55% at 50% -8%, rgb(28 38 64 / ${0.55 * light}) 0%, rgb(12 17 29 / 0) 70%), #0C111D`,
      }}
    />
  )
}

/** A thin line of sound: amplitude follows `energy(x)` (0–1 along the line). */
export function SoundLine({
  t,
  x0,
  x1,
  y,
  energy,
  color = 'rgb(176 202 255)',
  opacity = 1,
  width = 2,
}: {
  t: number
  x0: number
  x1: number
  y: number
  energy: (u: number) => number
  color?: string
  opacity?: number
  width?: number
}): React.ReactElement {
  const pts: string[] = []
  const n = 220
  for (let i = 0; i <= n; i++) {
    const u = i / n
    const x = x0 + (x1 - x0) * u
    const env = Math.sin(Math.PI * u) ** 0.6
    const a = energy(u) * env
    const v = Math.sin(x * 0.055 - t * 7.5) * 0.6 + Math.sin(x * 0.021 + t * 3.1) * 0.4
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${(y + v * a * 42).toFixed(1)}`)
  }
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, opacity }}>
      <path d={pts.join(' ')} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
