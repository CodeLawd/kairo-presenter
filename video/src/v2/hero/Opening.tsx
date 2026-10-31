import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { Backdrop, SoundLine } from '../Backdrop'
import { display, mono, ui } from '../fonts'
import { Words } from '../Kinetic'
import { HEAVY, SNAPPY, SOFT, io, kf, seg, spring } from '../motion'

/**
 * 0–18 s. The hook and the problem as one shot: the pastor's words arrive
 * over a line of sound, then shrink away as the sermon moves on while the
 * booth guesses at a reference. Hard cut to black at 17.4 s.
 */

const LINE_A = 'Jesus said, drink the water I give,'
const LINE_B = 'and you’ll never be thirsty again.'
const WORD_GAP = 0.26
const A_AT = 1.2
const B_AT = 3.4

/** When each spoken word lands, for the sound line's energy. */
const WORD_TIMES = [
  ...LINE_A.split(' ').map((_, i) => A_AT + i * WORD_GAP),
  ...LINE_B.split(' ').map((_, i) => B_AT + i * WORD_GAP),
]

const FOLLOWING = ['So she leaves her water jar by the well,', 'and runs back into the town,', 'telling everyone what she heard.']

const GUESSES: { q: string; at: number; hold: number }[] = [
  { q: 'john 3', at: 9.7, hold: 2.3 },
  { q: 'john 7:37', at: 12.0, hold: 1.9 },
  { q: 'water never thirst', at: 13.9, hold: 1.6 },
  { q: 'isaiah 55', at: 15.5, hold: 1.6 },
]

const RESULTS: Record<string, [string, string][]> = {
  'john 3': [
    ['John 3:1', 'There was a man of the Pharisees, named Nicodemus, a ruler of the Jews:'],
    ['John 3:2', 'The same came to Jesus by night, and said unto him, Rabbi…'],
    ['John 3:3', 'Jesus answered and said unto him, Verily, verily, I say unto thee…'],
  ],
  'john 7:37': [['John 7:37', 'In the last day, that great day of the feast, Jesus stood and cried…']],
  'water never thirst': [
    ['Revelation 7:16', 'They shall hunger no more, neither thirst any more…'],
    ['Isaiah 49:10', 'They shall not hunger nor thirst; neither shall the heat nor sun smite them…'],
  ],
  'isaiah 55': [['Isaiah 55:1', 'Ho, every one that thirsteth, come ye to the waters…']],
}

function SearchField({ t }: { t: number }): React.ReactElement {
  const enter = spring(t, 9.1, SOFT)
  const g = [...GUESSES].reverse().find((x) => t >= x.at) ?? GUESSES[0]
  const local = t - g.at
  const typeDur = 0.08 * g.q.length
  const cleared = local > g.hold - 0.18
  const chars = cleared ? 0 : Math.floor(Math.min(1, Math.max(0, local / typeDur)) * g.q.length)
  const results = !cleared && local > typeDur + 0.25 ? RESULTS[g.q] : []
  const shown = spring(t, g.at + typeDur + 0.25, SNAPPY)
  const caret = Math.floor(t * 2.2) % 2 === 0
  return (
    <div style={{ position: 'absolute', left: 360, top: 452 + (1 - enter) * 60, width: 1200, opacity: enter }}>
      <div style={{ height: 84, borderRadius: 16, background: 'rgb(24 27 35)', border: '1px solid rgb(56 61 76)', display: 'flex', alignItems: 'center', gap: 20, padding: '0 30px', fontFamily: ui, fontSize: 36, color: 'rgb(238 238 242)' }}>
        <MagnifyingGlass size={30} color="rgb(157 163 182)" />
        <span>{g.q.slice(0, chars)}</span>
        <span style={{ width: 2.5, height: 40, marginLeft: -16, background: 'rgb(59 107 255)', opacity: caret ? 1 : 0 }} />
      </div>
      {results.length > 0 && (
        <div style={{ marginTop: 12, borderRadius: 16, background: 'rgb(24 27 35)', padding: 10, opacity: shown, transform: `translateY(${(1 - shown) * -8}px)` }}>
          {results.map(([ref, text], i) => (
            <div key={ref} style={{ display: 'flex', gap: 26, alignItems: 'baseline', padding: '16px 20px', borderRadius: 10, background: i === 0 ? 'rgb(33 37 48)' : 'transparent' }}>
              <span style={{ fontFamily: mono, fontSize: 24, color: 'rgb(214 217 226)', width: 250, flexShrink: 0 }}>{ref}</span>
              <span style={{ fontFamily: ui, fontSize: 25, color: 'rgb(157 163 182)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Opening(): React.ReactElement {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  if (t >= 17.4) return <AbsoluteFill style={{ background: '#000' }} />

  // The quote shrinks to the corner as the sermon moves on.
  const away = spring(t, 8.0, SOFT)
  const scale = 1 - away * 0.52
  const qx = 160
  const qy = kf(t, [
    [0, 404],
    [8, 404],
    [9.4, 120],
  ])
  const speaking = WORD_TIMES.reduce((m, w) => Math.max(m, Math.exp(-(((t - w) / 0.2) ** 2))), 0)
  const following = FOLLOWING.map((line, i) => ({ line, at: 9.6 + i * 1.9 }))
  const lateSpeech = following.reduce((m, f) => Math.max(m, Math.exp(-(((t - f.at - 0.4) / 0.6) ** 2))), 0)
  const energy = 0.12 + 0.7 * Math.max(speaking, lateSpeech * 0.7)
  // The moment slipping: a thin line racing across the top.
  const slip = io(seg(t, 9.0, 17.3))

  return (
    <AbsoluteFill>
      <Backdrop light={1 - away * 0.6} />
      <SoundLine t={t} x0={160} x1={1760} y={kf(t, [[0, 820], [8, 820], [9.4, 1000]])} energy={() => energy} opacity={io(seg(t, 0.2, 1.2)) * (1 - away)} />
      <div style={{ position: 'absolute', left: qx, top: qy, transform: `scale(${scale})`, transformOrigin: '0 0', opacity: 1 - away * 0.62, fontFamily: display, fontWeight: 600, fontSize: 88, lineHeight: 1.12, letterSpacing: '-0.03em', color: '#F9FAFB', width: 1600 }}>
        <div>
          <Words text={LINE_A} t={t} start={A_AT} stagger={WORD_GAP} />
        </div>
        <div>
          <Words text={LINE_B} t={t} start={B_AT} stagger={WORD_GAP} />
        </div>
      </div>
      {/* The sermon keeps going while the booth searches. */}
      <div style={{ position: 'absolute', left: 160, top: 248, fontFamily: display, fontWeight: 500, fontSize: 30, lineHeight: 1.5, color: 'rgb(249 250 251 / 0.36)' }}>
        {following.map(({ line, at }, i) => (
          <div key={i} style={{ opacity: 1 - seg(t, at + 3.2, at + 4.4), transform: `translateY(${-spring(t, at + 3.0, HEAVY) * 24}px)` }}>
            <Words text={line} t={t} start={at} stagger={0.2} />
          </div>
        ))}
      </div>
      <SearchField t={t} />
      <div style={{ position: 'absolute', left: 160, top: 56, width: 1600 * slip, height: 2, borderRadius: 1, background: 'rgb(249 250 251 / 0.5)', opacity: t > 9 ? 1 : 0 }} />
    </AbsoluteFill>
  )
}
