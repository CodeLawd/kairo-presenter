import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { RadiantLines } from '../../components/RadiantLines'
import { Backdrop, SoundLine } from '../Backdrop'
import { display, mono, ui } from '../fonts'
import { Words } from '../Kinetic'
import { HEAVY, SNAPPY, SOFT, camera, clamp01, io, kf, lerp, out, seg, spring, type CamKey } from '../motion'
import { OP_H, OP_W, Operator, VerseCard } from '../Operator'
import { KJV, Slide } from '../Slide'

/**
 * 24–55 s, one continuous take on the real Operator. The line of sound
 * becomes the meter; the pastor's line types in and lights up; the phrase
 * lifts out and resolves to the verse; the verse flies into Detected as the
 * card; the operator sends it; the live output becomes the screen in the room.
 */

const SEGS = [
  'Good morning, church. It’s good to be together.',
  'If you’ve got your Bibles, keep them close. We’ll be in one place today.',
  'I want to start with a question this morning.',
  'When was the last time you felt really tired?',
]
const LINE = 'Jesus said, drink the water I give, and you’ll never be thirsty again.'
const PHRASE = 'drink the water I give, and you’ll never be thirsty again'

// Beats (scene seconds).
const TYPE_AT = 6.6
const TYPE_END = 9.6
const LIT_AT = 9.8
const CHIP_AT = 10.7
const LIFT_AT = 11.3
const FLY_AT = 15.6
const LAND_AT = 17.6
const ARRIVE_AT = 23.0
const PRESS_AT = 24.3
const ROOM_AT = 28.6

const CAM: CamKey[] = [
  [0.0, 5.2, 324, 560],
  [0.9, 5.2, 324, 560],
  [4.2, 1.12, 800, 480],
  [5.0, 1.12, 800, 480],
  [6.4, 1.8, 330, 360],
  [10.6, 1.9, 330, 372],
  [LIFT_AT, 1.9, 330, 372],
  [FLY_AT, 1.9, 330, 372],
  [LAND_AT, 2.3, 450, 232],
  [ARRIVE_AT, 2.45, 452, 222],
  [PRESS_AT + 0.3, 2.45, 452, 222],
  [26.2, 1.38, 860, 300],
  [27.3, 1.38, 860, 300],
  [ROOM_AT, 4.571, 1350, 207.5],
]

/** Operator layout point → screen point under the camera (no tilt in handoffs). */
const toScreen = (t: number, x: number, y: number): { x: number; y: number; zoom: number } => {
  const c = camera(t, CAM)
  return { x: 960 + (x - c.x) * c.zoom, y: 540 + (y - c.y) * c.zoom, zoom: c.zoom }
}

// Where things sit in the Operator (layout px), from the rebuild.
const PHRASE_AT = { x: 141, y: 455 }
const CARD_AT = { x: 353, y: 145, w: 182, h: 126 }

function Cursor({ x, y, press, scale }: { x: number; y: number; press: number; scale: number }): React.ReactElement {
  return (
    <svg width={28} height={34} viewBox="0 0 28 34" style={{ position: 'absolute', left: x, top: y, transform: `scale(${scale * (1 - press * 0.12)})`, transformOrigin: '4px 3px', overflow: 'visible' }}>
      <path d="M4 3 L4 26 L10 20.5 L14.5 30.5 L18.5 28.8 L14.2 19 L22 19 Z" fill="#fff" stroke="#000" strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  )
}

/** The phrase, lifted: rows chosen so each connecting line leaves from a row's end. */
const ROWS = ['drink the water I give,', 'and you’ll never be thirsty', 'again.']
const VERSE_PARTS: { text: string; key?: boolean }[] = [
  { text: 'But whosoever ' },
  { text: 'drinketh of the water that I shall give', key: true },
  { text: ' him ' },
  { text: 'shall never thirst', key: true },
  { text: '; but the water that I shall give him shall be in him a well of water springing up into everlasting life.' },
]

function Match({ t }: { t: number }): React.ReactElement {
  // Settle in place first (the copy replaces the transcript words), then fly.
  const lift = spring(t, LIFT_AT + 0.22, SOFT)
  const gone = spring(t, FLY_AT - 0.1, SNAPPY)
  // From the phrase's place in the transcript to the left of frame.
  const from = toScreen(LIFT_AT, PHRASE_AT.x, PHRASE_AT.y)
  const fromScale = (14 * from.zoom) / 56
  const x = lerp(from.x, 150, lift)
  const y = lerp(from.y, 372, lift)
  const s = lerp(fromScale, 1, lift)
  const lines = io(seg(t, 12.7, 13.7))
  const lit = io(seg(t, 13.5, 14.2))
  const ref = spring(t, 14.3, SNAPPY)
  const verseIn = spring(t, 12.0, SOFT)
  const keyStyle = (on: number): React.CSSProperties => ({
    color: `color-mix(in srgb, rgb(176 202 255) ${on * 100}%, rgb(249 250 251 / 0.88))`,
    background: `rgb(59 107 255 / ${on * 0.16})`,
    borderRadius: 6,
  })
  // Row ends (measured on the rendered rows) and verse anchors.
  const rowEnds = [
    { x: 150 + 600, y: 372 + 36 },
    { x: 150 + 690, y: 372 + 106 },
  ]
  const anchors = [
    { x: 1040, y: 384 },
    { x: 1040, y: 429 },
  ]
  return (
    <AbsoluteFill style={{ opacity: 1 - gone }}>
      <div style={{ position: 'absolute', left: x, top: y, transform: `scale(${s})`, transformOrigin: '0 0', fontFamily: display, fontWeight: 600, fontSize: 56, lineHeight: '70px', letterSpacing: '-0.025em', color: 'rgb(176 202 255)', opacity: seg(t, LIFT_AT, LIFT_AT + 0.15) }}>
        {ROWS.map((r) => (
          <div key={r} style={{ whiteSpace: 'nowrap' }}>
            <span style={{ background: 'rgb(59 107 255 / 0.16)', borderRadius: 6 }}>{r}</span>
          </div>
        ))}
      </div>
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        {rowEnds.map((a, i) => {
          const b = anchors[i]
          const mid = (a.x + b.x) / 2
          const p = clamp01(lines * 1.25 - i * 0.25)
          return (
            <path key={i} d={`M${a.x + 18} ${a.y} C${mid} ${a.y}, ${mid} ${b.y}, ${b.x} ${b.y}`} pathLength={1} fill="none" stroke="rgb(138 180 255)" strokeWidth={2} strokeLinecap="round" strokeDasharray={1} strokeDashoffset={1 - p} />
          )
        })}
      </svg>
      <div
        style={{
          position: 'absolute',
          left: 1040,
          top: 330,
          width: 720,
          padding: '30px 36px',
          borderRadius: 18,
          border: `1.5px solid rgb(249 250 251 / ${0.12 + lit * 0.16})`,
          background: `rgb(24 27 35 / ${0.85 * verseIn})`,
          opacity: verseIn,
          transform: `translateY(${(1 - verseIn) * 16}px)`,
        }}
      >
        <p style={{ margin: 0, fontFamily: display, fontWeight: 500, fontSize: 30, lineHeight: 1.5, color: 'rgb(249 250 251 / 0.88)' }}>
          {VERSE_PARTS.map((p, i) => (
            <span key={i} style={p.key ? keyStyle(lit) : undefined}>
              {p.text}
            </span>
          ))}
        </p>
        <div style={{ marginTop: 22, display: 'flex', alignItems: 'baseline', gap: 14, opacity: ref, transform: `translateY(${(1 - ref) * 8}px)` }}>
          <span style={{ fontFamily: mono, fontSize: 28, color: '#F9FAFB' }}>John 4:14</span>
          <span style={{ fontFamily: ui, fontSize: 22, fontWeight: 600, color: 'rgb(157 163 182)' }}>KJV</span>
        </div>
      </div>
    </AbsoluteFill>
  )
}

/** The verse becomes the card: from the verse panel to the card's exact place in Detected. */
function FlyingCard({ t }: { t: number }): React.ReactElement | null {
  if (t < FLY_AT || t >= LAND_AT) return null
  const p = spring(t, FLY_AT, { k: 140, d: 22 })
  const appear = seg(t, FLY_AT, FLY_AT + 0.3)
  const target = toScreen(t, CARD_AT.x, CARD_AT.y)
  const x = lerp(1040, target.x, p)
  const y = lerp(330, target.y, p)
  const w = lerp(720, CARD_AT.w * target.zoom, p)
  return (
    <div style={{ position: 'absolute', left: x, top: y, opacity: appear }}>
      <VerseCard reference="John 4:14" width={w} />
    </div>
  )
}

/** The slide fills the frame, then pulls back to the screen in a dark room. */
function Room({ t }: { t: number }): React.ReactElement | null {
  if (t < ROOM_AT) return null
  const back = spring(t, ROOM_AT + 0.6, { k: 40, d: 13 })
  const s = lerp(1, 0.56, back)
  const cy = lerp(540, 392, back)
  const room = seg(t, ROOM_AT + 0.6, ROOM_AT + 1.6)
  const rows = [0, 1, 2, 3, 4]
  return (
    <AbsoluteFill style={{ background: '#05070c' }}>
      {/* Light from the screen falling into the room. */}
      <AbsoluteFill style={{ opacity: room, background: `radial-gradient(60% 46% at 50% ${cy / 10.8 + 6}%, rgb(40 62 104 / 0.55) 0%, rgb(5 7 12 / 0) 70%)` }} />
      <div style={{ position: 'absolute', left: 960 - 960 * s, top: cy - 540 * s, width: 1920 * s, height: 1080 * s, boxShadow: `0 0 ${160 * room}px rgb(60 100 170 / ${0.35 * room})` }}>
        <div style={{ transform: `scale(${s})`, transformOrigin: '0 0' }}>
          <Slide reference="John 4:14" width={1920} />
        </div>
      </div>
      {/* Pews catching the light: the room, without inventing its people. */}
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, opacity: room }}>
        {[0, 1, 2, 3].map((r) => {
          const y = 800 + r * 76 + (1 - back) * (140 + r * 40)
          const h = 54 + r * 10
          const spread = 1 + r * 0.22
          // Two banks of pews either side of a centre aisle, widening toward the camera.
          const bank = (side: -1 | 1): React.ReactElement => {
            const inner = 960 + side * 70 * spread
            const outer = 960 + side * 980 * spread
            const x = Math.min(inner, outer)
            const w = Math.abs(outer - inner)
            return (
              <g key={side}>
                <rect x={x} y={y} width={w} height={h} rx={10} fill={`rgb(${16 + r * 3} ${20 + r * 3} ${31 + r * 4})`} />
                <rect x={x + 6} y={y} width={w - 12} height={2} rx={1} fill={`rgb(120 160 220 / ${0.55 - r * 0.1})`} />
              </g>
            )
          }
          return (
            <g key={r}>
              {bank(-1)}
              {bank(1)}
            </g>
          )
        })}
      </svg>
    </AbsoluteFill>
  )
}

export function OneTake(): React.ReactElement {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const c = camera(t, CAM)
  const tilt = kf(t, [
    [0, 0],
    [4.2, -5],
    [5.2, -2],
    [6.4, 0],
  ])

  const typed = seg(t, TYPE_AT, TYPE_END)
  const speaking = t > TYPE_AT - 0.2 && t < TYPE_END + 0.2
  const level = t < 4.5 ? 0.95 : speaking ? 0.8 : 0.36
  const lifted = seg(t, LIFT_AT, LIFT_AT + 0.15)
  const staged = spring(t, FLY_AT + 0.9, SOFT)
  const press = spring(t, PRESS_AT, SNAPPY) - spring(t, PRESS_AT + 0.1, SNAPPY)
  const border = io(seg(t, PRESS_AT + 0.08, PRESS_AT + 0.62))
  const live = spring(t, PRESS_AT + 0.28, SOFT)

  // Where attention is.
  const focus = t < 5 ? undefined : t < FLY_AT + 0.6 ? (['transcript'] as const) : t < PRESS_AT + 0.4 ? (['detected'] as const) : (['detected', 'live'] as const)
  const focusAmount = t < 5 ? 0 : t < FLY_AT + 0.6 ? spring(t, 5.4, SOFT) : t < PRESS_AT + 0.4 ? 0.9 : 0.9 * (1 - spring(t, PRESS_AT + 0.4, SOFT))
  const dark = clamp01(spring(t, LIFT_AT, SOFT) - spring(t, FLY_AT + 0.3, SOFT)) * 0.78

  // Cursor, in Operator space so it rides the camera.
  const toCard = spring(t, ARRIVE_AT - 1.6, { k: 60, d: 15 })
  const cx = lerp(640, 455, toCard)
  const cy = lerp(430, 214, toCard)

  // The line of sound arrives from the left and becomes the meter.
  const lineIn = io(seg(t, 0, 1.0))
  const lineOut = seg(t, 1.0, 1.8)

  return (
    <AbsoluteFill>
      <Backdrop />
      <div style={{ position: 'absolute', inset: 0, perspective: 2600, opacity: io(seg(t, 0.5, 1.3)) }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: OP_W,
            height: OP_H,
            transformOrigin: '0 0',
            transform: `translate(960px, 540px) rotateY(${tilt}deg) scale(${c.zoom}) translate(${-c.x}px, ${-c.y}px)`,
          }}
        >
          <Operator
            hideCard={t < LAND_AT}
            s={{
              t,
              clock: `00:14:${String(12 + Math.floor(t)).padStart(2, '0')}`,
              segs: SEGS,
              line: t >= TYPE_AT - 0.1 ? { text: LINE, typed, match: { phrase: PHRASE, ref: 'John 4:14', lit: io(seg(t, LIT_AT, LIT_AT + 0.8)), chip: spring(t, CHIP_AT, SNAPPY) }, lifted } : undefined,
              level,
              staged: t >= FLY_AT + 0.9 ? staged : 0,
              border,
              live,
              press,
              focus: focus as unknown as never,
              focusAmount,
            }}
          />
          {t > ARRIVE_AT - 1.7 && t < ROOM_AT && <Cursor x={cx} y={cy} press={press} scale={(1.25 / c.zoom) * 1.4} />}
        </div>
      </div>
      <SoundLine t={t} x0={-40} x1={lerp(200, 960, lineIn)} y={540} energy={() => 0.7} opacity={(1 - lineOut) * seg(t, 0, 0.3)} width={3} />
      <AbsoluteFill style={{ background: `rgb(12 17 29 / ${dark})` }} />
      {t > 13.2 && t < 15.4 && (
        <RadiantLines warp={(f) => 0.6 + 4 * Math.exp(-(((f / fps - 13.7) / 0.35) ** 2))} opacity={0.42 * seg(t, 13.2, 13.6) * (1 - seg(t, 14.8, 15.4))} seed={11} />
      )}
      {t > LIFT_AT && t < FLY_AT + 0.6 && <Match t={t} />}
      <FlyingCard t={t} />
      <Room t={t} />
    </AbsoluteFill>
  )
}

export const ONE_TAKE_SECONDS = 31
export { KJV }
