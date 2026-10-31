import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { Backdrop } from './Backdrop'
import { display, ui } from './fonts'
import { Words } from './Kinetic'
import { HEAVY, SNAPPY, SOFT, clamp01, lerp, seg, spring } from './motion'
import { OP_COLORS as C } from './Operator'

/**
 * A walkthrough chapter: the chapter title arrives large, then settles into a
 * small label while the beats play. Each beat is a one-line title beside one
 * panel that reshapes from beat to beat (the same system as the hero's "rest
 * of Sunday"). Beats can also be full-frame scenes (`full`).
 */

export type Beat = {
  /** Seconds into the chapter. */
  at: number
  title?: string
  hue?: string
  panel?: { w: number; h: number }
  View?: React.FC<{ t: number }>
  /** A full-frame scene instead of title + panel. */
  full?: React.FC<{ t: number }>
}

const INTRO = 1.6

export function Chapter({ n, name, beats, dur }: { n: number; name: string; beats: Beat[]; dur: number }): React.ReactElement {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const i = beats.reduce((k, b, j) => (t >= b.at ? j : k), -1)
  const beat = i >= 0 ? beats[i] : undefined
  const local = beat ? t - beat.at : 0
  const nextAt = i + 1 < beats.length ? beats[i + 1].at : dur
  const span = nextAt - (beat?.at ?? 0)

  // The chapter title: large first, then a label top-left.
  const settle = spring(t, INTRO, SOFT)
  const titleIn = spring(t, 0.1, HEAVY)
  const label = `${String(n).padStart(2, '0')}`

  // Panel reshapes between consecutive panel beats.
  const prevPanel = [...beats.slice(0, Math.max(0, i))].reverse().find((b) => b.panel)?.panel
  const panel = beat?.panel
  const morph = prevPanel ? spring(local, 0, SOFT) : 1
  const w = panel ? lerp(prevPanel?.w ?? panel.w, panel.w, morph) : 0
  const h = panel ? lerp(prevPanel?.h ?? panel.h, panel.h, morph) : 0
  const panelIn = prevPanel ? 1 : spring(local, 0, SOFT)
  const contentIn = spring(local, prevPanel ? 0.25 : 0.15, SOFT)
  const contentOut = seg(local, span - 0.3, span)
  const exitAll = seg(t, dur - 0.35, dur)

  return (
    <AbsoluteFill style={{ opacity: 1 - exitAll }}>
      <Backdrop />
      {beat?.full && (
        <AbsoluteFill style={{ opacity: clamp01(spring(local, 0, SOFT)) * (1 - contentOut) }}>
          <beat.full t={local} />
        </AbsoluteFill>
      )}
      {/* Chapter title → label, above full-frame scenes (with a little shade so it reads). */}
      {beat?.full && <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgb(12 17 29 / 0.7) 0%, rgb(12 17 29 / 0) 14%)', opacity: settle }} />}
      <div
        style={{
          position: 'absolute',
          left: lerp(120, 64, settle),
          top: lerp(450, 52, settle),
          transform: `scale(${lerp(1, 0.32, settle)})`,
          transformOrigin: '0 0',
          display: 'flex',
          alignItems: 'baseline',
          gap: 28,
          fontFamily: display,
          fontWeight: 700,
          fontSize: 110,
          letterSpacing: '-0.04em',
          color: '#F9FAFB',
          whiteSpace: 'nowrap',
          opacity: titleIn,
        }}
      >
        <span style={{ color: C.accent200 }}>{label}</span>
        <Words text={name} t={t} start={0.15} />
      </div>
      {beat?.title && (
        <div key={i} style={{ position: 'absolute', left: 120, top: 476, width: 860 }}>
          <span style={{ display: 'block', width: 12, height: 12, borderRadius: 6, background: beat.hue ?? C.accent200, marginBottom: 26, opacity: spring(local, 0, SNAPPY) }} />
          <div style={{ fontFamily: display, fontWeight: 700, fontSize: 54, lineHeight: 1.06, letterSpacing: '-0.035em', color: '#F9FAFB', whiteSpace: 'nowrap' }}>
            <Words text={beat.title} t={local} start={0.05} exitAt={span - 0.35} />
          </div>
        </div>
      )}
      {panel && beat?.View && (
        <div
          style={{
            position: 'absolute',
            left: 1800 - w,
            top: 560 - h / 2 + (1 - panelIn) * 40,
            width: w,
            height: h,
            borderRadius: 18,
            background: C.surface,
            border: `1px solid ${C.line}`,
            overflow: 'hidden',
            opacity: panelIn * (beats[i + 1]?.panel ? 1 : 1 - contentOut),
            fontFamily: ui,
          }}
        >
          <div style={{ position: 'relative', width: '100%', height: '100%', opacity: clamp01(contentIn) * (1 - contentOut), transform: `translateY(${(1 - contentIn) * 18 - contentOut * 18}px)` }}>
            <beat.View t={local} />
          </div>
        </div>
      )}
    </AbsoluteFill>
  )
}
