import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { RadiantLines } from '../../components/RadiantLines'
import { display } from '../fonts'
import { Words } from '../Kinetic'
import { HEAVY, SNAPPY, seg, spring } from '../motion'

/**
 * The logo opens like an eye: a thin bar of light widens into the mark
 * (the skill's squash reveal, never a crossfade into the PNG).
 */
export function LogoReveal({ t, at, width = 520 }: { t: number; at: number; width?: number }): React.ReactElement {
  const bar = spring(t, at, SNAPPY)
  const open = spring(t, at + 0.12, HEAVY)
  const h = width * (557 / 2326)
  return (
    <div style={{ position: 'relative', width, height: h }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: h / 2 - 1, height: 2, background: '#F9FAFB', transform: `scaleX(${bar})`, opacity: 1 - seg(t, at + 0.12, at + 0.3) }} />
      <Img src={staticFile('brand/logo-white.png')} style={{ position: 'absolute', inset: 0, width, height: h, transform: `scaleY(${Math.max(0.014, open)})`, opacity: open > 0.01 ? 1 : 0 }} />
    </div>
  )
}

export function Title(): React.ReactElement {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  // Warp out of the centre, then settle to a slow drift.
  const warp = (f: number): number => {
    const s = f / fps
    return 0.8 + 7 * Math.exp(-(((s - 0.45) / 0.42) ** 2))
  }
  return (
    <AbsoluteFill style={{ background: '#0C111D' }}>
      <RadiantLines warp={warp} opacity={seg(t, 0, 0.25)} seed={5} />
      <AbsoluteFill style={{ background: 'radial-gradient(48% 42% at 50% 50%, rgb(12 17 29 / 0.92) 0%, rgb(12 17 29 / 0) 100%)' }} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', fontFamily: display, fontWeight: 700, fontSize: 112, letterSpacing: '-0.04em', color: '#F9FAFB', whiteSpace: 'nowrap' }}>
          <Words text="Because every moment matters." t={t} start={0.9} stagger={0.07} exitAt={3.5} />
        </div>
        <div style={{ position: 'absolute' }}>
          <LogoReveal t={t} at={3.95} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
