import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { RadiantLines } from '../../components/RadiantLines'
import { Stage } from '../../components/Stage'
import { Backdrop, SoundLine } from '../Backdrop'
import { display, mono, ui } from '../fonts'
import { Words } from '../Kinetic'
import { SNAPPY, SOFT, camera, clamp01, io, lerp, seg, spring, type CamKey } from '../motion'
import { OP_COLORS as C, OP_H, OP_W, Operator } from '../Operator'
import { LogoReveal } from '../hero/Title'
import { Soundtrack } from '../Soundtrack'
import { SOCIAL_SOUND } from '../sound-cues'
import vo from '../../data/social-vo.json'

/**
 * 9:16, 24 s, made to work with the sound off: the caption at the top is the
 * story, the picture under it proves it. Captions sit in the top third, clear
 * of platform UI at the bottom.
 */

const W = 1080
const H = 1920

function Caption({ t, lines }: { t: number; lines: { text: string; at: number; out?: number; color?: string }[] }): React.ReactElement {
  return (
    <div style={{ position: 'absolute', left: 80, right: 80, top: 250, fontFamily: display, fontWeight: 700, fontSize: 92, lineHeight: 1.04, letterSpacing: '-0.04em', color: '#F9FAFB' }}>
      {lines.map((l, i) => (
        <div key={i} style={{ position: i === 0 ? 'relative' : 'absolute', top: i === 0 ? undefined : 0, left: 0, right: 0, color: l.color }}>
          <Words text={l.text} t={t} start={l.at} exitAt={l.out} stagger={0.06} />
        </div>
      ))}
    </div>
  )
}

function Hook(): React.ReactElement {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const words = 'Jesus said, drink the water I give, and you’ll never be thirsty again.'
  const speaking = words.split(' ').reduce((m, _, i) => Math.max(m, Math.exp(-(((t - (0.9 + i * 0.17)) / 0.18) ** 2))), 0)
  const field = spring(t, 3.4, SOFT)
  const q = 'john 7'
  const typed = Math.floor(seg(t, 3.9, 4.5) * q.length)
  return (
    <AbsoluteFill>
      <Backdrop />
      <Caption
        t={t}
        lines={[
          { text: 'The pastor quotes a verse.', at: 0.15, out: 3.1 },
          { text: 'Nobody planned it.', at: 3.3 },
        ]}
      />
      <div style={{ position: 'absolute', left: 80, right: 80, top: 760, fontFamily: display, fontWeight: 600, fontSize: 58, lineHeight: 1.2, letterSpacing: '-0.02em', color: 'rgb(249 250 251 / 0.86)', opacity: 1 - field * 0.6, transform: `translateY(${-field * 60}px)` }}>
        <Words text={`“${words}”`} t={t} start={0.9} stagger={0.17} />
      </div>
      <SoundLine t={t} x0={80} x1={1000} y={1330} energy={() => 0.12 + 0.7 * speaking} opacity={(1 - field) * seg(t, 0.2, 0.8)} />
      <div style={{ position: 'absolute', left: 80, right: 80, top: 1180 + (1 - field) * 60, opacity: field }}>
        <div style={{ height: 96, borderRadius: 18, background: C.surface2, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 20, padding: '0 30px', fontFamily: ui, fontSize: 40, color: C.text }}>
          <MagnifyingGlass size={34} color={C.fg500} />
          {q.slice(0, typed)}
          <span style={{ width: 3, height: 44, background: C.accent, opacity: Math.floor(t * 2.2) % 2 }} />
        </div>
        <div style={{ marginTop: 14, borderRadius: 18, background: C.surface2, padding: '20px 26px', fontFamily: ui, opacity: spring(t, 4.8, SNAPPY) }}>
          <div style={{ fontFamily: mono, fontSize: 30, color: C.fg300 }}>John 7:37</div>
          <div style={{ marginTop: 6, fontSize: 28, color: C.fg500 }}>In the last day, that great day of the feast…</div>
        </div>
      </div>
    </AbsoluteFill>
  )
}

const CAM_HEARD: CamKey[] = [
  [0, 2.2, 205, 420],
  [3.2, 2.45, 200, 470],
  [3.8, 2.45, 200, 470],
]
const CAM_SEND: CamKey[] = [
  [0, 3.4, 444, 220],
  [2.4, 3.4, 444, 220],
  [3.2, 2.4, 850, 230],
]

function OpCam({ t, cam, s }: { t: number; cam: CamKey[]; s: Parameters<typeof Operator>[0]['s'] }): React.ReactElement {
  const c = camera(t, cam)
  return (
    <div style={{ position: 'absolute', left: 0, top: 820, width: W, height: 1000, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: OP_W, height: OP_H, transformOrigin: '0 0', transform: `translate(${W / 2}px, 500px) scale(${c.zoom}) translate(${-c.x}px, ${-c.y}px)` }}>
        <Operator s={s} />
      </div>
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, #0C111D 0%, rgb(12 17 29 / 0) 12%, rgb(12 17 29 / 0) 88%, #0C111D 100%)' }} />
    </div>
  )
}

const SEGS = ['I want to start with a question this morning.', 'When was the last time you felt really tired?']
const LINE = 'Jesus said, drink the water I give, and you’ll never be thirsty again.'
const PHRASE = 'drink the water I give, and you’ll never be thirsty again'

function Heard(): React.ReactElement {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const staged = spring(t, 3.9, SOFT)
  return (
    <AbsoluteFill>
      <Backdrop />
      <Caption
        t={t}
        lines={[
          { text: 'Kairo heard it.', at: 0.1, out: 3.4 },
          { text: 'Found the passage. Even paraphrased.', at: 3.6, color: 'rgb(176 202 255)' },
        ]}
      />
      <OpCam
        t={t}
        cam={[...CAM_HEARD, [4.6, 2.6, 444, 230]]}
        s={{
          t,
          clock: '00:14:31',
          segs: SEGS,
          line: { text: LINE, typed: seg(t, 0.4, 2.2), match: { phrase: PHRASE, ref: 'John 4:14', lit: io(seg(t, 2.3, 3.0)), chip: spring(t, 3.0, SNAPPY) } },
          level: t < 2.3 ? 0.8 : 0.35,
          staged,
          focus: t < 4 ? ['transcript'] : ['detected'],
          focusAmount: 0.8,
        }}
      />
    </AbsoluteFill>
  )
}

function Send(): React.ReactElement {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const pressAt = 1.3
  const press = spring(t, pressAt, SNAPPY) - spring(t, pressAt + 0.1, SNAPPY)
  const border = io(seg(t, pressAt + 0.08, pressAt + 0.62))
  const live = spring(t, pressAt + 0.28, SOFT)
  const arrive = spring(t, 0, { k: 60, d: 15 })
  const c = camera(t, CAM_SEND)
  return (
    <AbsoluteFill>
      <Backdrop />
      <Caption t={t} lines={[{ text: 'You press send.', at: 0.1 }]} />
      <OpCam
        t={t}
        cam={CAM_SEND}
        s={{ t, clock: '00:14:36', segs: SEGS, line: { text: LINE, typed: 1, match: { phrase: PHRASE, ref: 'John 4:14', lit: 1, chip: 1 } }, level: 0.3, staged: 1, border, live, press, focus: ['detected', 'live'], focusAmount: 0.75 }}
      />
      {t < 2.6 && (
        <svg width={28} height={34} viewBox="0 0 28 34" style={{ position: 'absolute', left: lerp(980, W / 2 + (452 - c.x) * c.zoom, arrive), top: lerp(1800, 820 + 500 + (214 - c.y) * c.zoom, arrive), transform: `scale(${1.9 * (1 - press * 0.12)})`, transformOrigin: '4px 3px', overflow: 'visible', opacity: 1 - seg(t, 2.3, 2.6) }}>
          <path d="M4 3 L4 26 L10 20.5 L14.5 30.5 L18.5 28.8 L14.2 19 L22 19 Z" fill="#fff" stroke="#000" strokeWidth={1.4} strokeLinejoin="round" />
        </svg>
      )}
    </AbsoluteFill>
  )
}

function End(): React.ReactElement {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const warp = (f: number): number => 0.8 + 5 * Math.exp(-(((f / fps - 0.3) / 0.4) ** 2))
  return (
    <AbsoluteFill style={{ background: '#0C111D' }}>
      <RadiantLines warp={warp} opacity={0.85 * seg(t, 0, 0.3)} seed={9} />
      <AbsoluteFill style={{ background: 'radial-gradient(60% 34% at 50% 50%, rgb(12 17 29 / 0.94) 0%, rgb(12 17 29 / 0.1) 100%)' }} />
      <Caption t={t} lines={[{ text: 'Because every moment matters.', at: 0.6 }]} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 50, paddingTop: 240 }}>
        <LogoReveal t={t} at={1.8} width={600} />
        <div style={{ fontFamily: mono, fontSize: 44, color: '#F9FAFB', opacity: spring(t, 2.6, SOFT) }}>kairopresenter.com</div>
        <div style={{ fontFamily: ui, fontSize: 34, fontWeight: 600, color: 'rgb(249 250 251 / 0.6)', opacity: spring(t, 3.0, SOFT) }}>Free during early access</div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

const SCENES = [
  { id: 'hook', dur: 6.4, C: Hook },
  { id: 'heard', dur: 7.6, C: Heard },
  { id: 'send', dur: 4.5, C: Send },
  { id: 'end', dur: 5.5, C: End },
]
export const SOCIAL_V2_SECONDS = SCENES.reduce((s, x) => s + x.dur, 0)

export function SocialV2(): React.ReactElement {
  const { fps } = useVideoConfig()
  let from = 0
  return (
    <Stage>
      <AbsoluteFill style={{ background: '#0C111D' }} />
      {SCENES.map(({ id, dur, C: Scene }) => {
        const start = from
        from += dur
        return (
          <Sequence key={id} name={id} from={Math.round(start * fps)} durationInFrames={Math.round(dur * fps)} premountFor={fps}>
            <Scene />
          </Sequence>
        )
      })}
      <Soundtrack vo={vo} {...SOCIAL_SOUND} />
    </Stage>
  )
}

