import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { RadiantLines } from '../../components/RadiantLines'
import { Backdrop } from '../Backdrop'
import { display, mono, ui } from '../fonts'
import { Words } from '../Kinetic'
import { SNAPPY, SOFT, drift, io, lerp, seg, spring } from '../motion'
import { VerseCard } from '../Operator'
import { LogoReveal } from './Title'

/** 75–84 s. The card waits; it moves only when a person presses. */
export function Trust(): React.ReactElement {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const arrive = spring(t, 3.2, { k: 60, d: 15 })
  const pressAt = 4.6
  const press = spring(t, pressAt, SNAPPY) - spring(t, pressAt + 0.1, SNAPPY)
  const border = io(seg(t, pressAt + 0.08, pressAt + 0.62))
  const live = spring(t, pressAt + 0.28, SOFT)
  const settle = spring(t, 0.1, SOFT)
  const cardX = 1060
  const cardY = 330 + drift(t, 4)
  return (
    <AbsoluteFill>
      <Backdrop />
      <div style={{ position: 'absolute', left: 150, top: 380, fontFamily: display, fontWeight: 700, fontSize: 84, lineHeight: 1.08, letterSpacing: '-0.035em', color: '#F9FAFB' }}>
        <div>
          <Words text="Kairo suggests." t={t} start={0.3} exitAt={6.3} />
        </div>
        <div style={{ color: 'rgb(176 202 255)' }}>
          <Words text="You decide." t={t} start={1.9} exitAt={6.4} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 150, top: 440, fontFamily: display, fontWeight: 700, fontSize: 84, letterSpacing: '-0.035em', color: '#F9FAFB', whiteSpace: 'nowrap' }}>
        <Words text="You approve every slide." t={t} start={6.7} />
      </div>
      <div style={{ position: 'absolute', left: cardX, top: cardY, opacity: settle, transform: `translateY(${(1 - settle) * 30}px)` }}>
        <VerseCard reference="John 4:14" width={600} border={border} live={live} press={press} />
      </div>
      {t > 3.0 && (
        <svg width={28} height={34} viewBox="0 0 28 34" style={{ position: 'absolute', left: lerp(1820, cardX + 330, arrive), top: lerp(980, cardY + 250, arrive), transform: `scale(${1.6 * (1 - press * 0.12)})`, transformOrigin: '4px 3px', overflow: 'visible' }}>
          <path d="M4 3 L4 26 L10 20.5 L14.5 30.5 L18.5 28.8 L14.2 19 L22 19 Z" fill="#fff" stroke="#000" strokeWidth={1.4} strokeLinejoin="round" />
        </svg>
      )}
    </AbsoluteFill>
  )
}

/** 84–92 s. */
export function EndCard(): React.ReactElement {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const warp = (f: number): number => 0.75 + 2.2 * Math.exp(-(f / fps) / 0.9)
  const meta = spring(t, 2.3, SOFT)
  return (
    <AbsoluteFill style={{ background: '#0C111D' }}>
      <RadiantLines warp={warp} opacity={0.8 * seg(t, 0, 0.4)} seed={3} />
      <AbsoluteFill style={{ background: 'radial-gradient(42% 44% at 50% 50%, rgb(12 17 29 / 0.94) 0%, rgb(12 17 29 / 0.1) 100%)' }} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ transform: `translateY(${-40 + drift(t, 2)}px)` }}>
          <LogoReveal t={t} at={0.5} width={500} />
        </div>
        <div style={{ position: 'absolute', top: 640, fontFamily: display, fontWeight: 600, fontSize: 40, letterSpacing: '-0.02em', color: 'rgb(249 250 251 / 0.8)' }}>
          <Words text="Free during early access." t={t} start={1.5} />
        </div>
        <div style={{ position: 'absolute', top: 720, display: 'flex', alignItems: 'center', gap: 28, opacity: meta, transform: `translateY(${(1 - meta) * 10}px)` }}>
          <span style={{ fontFamily: mono, fontSize: 32, color: '#F9FAFB' }}>kairopresenter.com</span>
          <span style={{ width: 1.5, height: 28, background: 'rgb(249 250 251 / 0.25)' }} />
          <span style={{ fontFamily: ui, fontSize: 26, fontWeight: 600, color: 'rgb(249 250 251 / 0.6)' }}>Mac · Windows</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
