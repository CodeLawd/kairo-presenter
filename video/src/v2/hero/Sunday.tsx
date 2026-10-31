import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { BookOpen, FileText, MusicNotes, Palette, Television, Broadcast, RecordFill } from '../icons'
import { Backdrop } from '../Backdrop'
import { display, mono, ui } from '../fonts'
import { Words } from '../Kinetic'
import { HEAVY, SNAPPY, SOFT, clamp01, io, lerp, seg, spring } from '../motion'
import { OP_COLORS as C, VerseCard } from '../Operator'
import { Slide } from '../Slide'

/**
 * 55–75 s: the rest of Sunday. One panel stays on screen and reshapes for
 * each vignette (no cuts); a one-line title rises beside it. Every vignette
 * is a state the app has: notes become a playlist, a song keeps its
 * sections, the theme preview is the output, one Kairo feeds every screen,
 * and the next verse moves up as the reading goes on.
 */

/** Beat starts, cut to the scratch voice (src/data/hero-vo.json): each vignette lasts as long as its line. */
const STARTS = [0, 6.6, 8.8, 12.3, 16.2]
const END = 20
const TITLES = ['Sermon notes, ready Saturday.', 'Songs keep their sections.', 'What you see goes out.', 'Every screen. Every stream.', 'Follows the reading.']
const HUES = [C.accent200, 'rgb(167 139 245)', C.pink, C.cyan, C.green]

/** Panel size for each beat; the panel springs between them. */
const PANELS = [
  { w: 820, h: 520 },
  { w: 860, h: 500 },
  { w: 860, h: 470 },
  { w: 820, h: 520 },
  { w: 820, h: 460 },
]

export function Notes({ t }: { t: number }): React.ReactElement {
  const refs = ['John 4:13–14', 'Psalm 23:1', 'Isaiah 40:31']
  const para = [
    ['The woman at the well comes alone, at noon. ', 0],
    ['John 4:13–14', 1],
    [': water that ends thirst. The Lord is the one who supplies: ', 0],
    ['Psalm 23:1', 1],
    ['. And those who wait on him are renewed: ', 0],
    ['Isaiah 40:31', 1],
    ['.', 0],
  ] as const
  let k = -1
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, padding: '34px 36px', borderRight: `1px solid ${C.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: ui, fontSize: 15, fontWeight: 600, color: C.fg300 }}>
          <FileText size={16} color={C.fg500} /> Living Water · notes.docx
        </div>
        <p style={{ marginTop: 26, fontFamily: ui, fontSize: 21, lineHeight: 1.7, color: C.fg400 }}>
          {para.map(([text, isRef], i) => {
            if (!isRef) return <span key={i}>{text}</span>
            k++
            const on = io(seg(t, 0.7 + k * 0.45, 1.0 + k * 0.45))
            return (
              <span key={i} style={{ color: `color-mix(in srgb, ${C.accent200} ${on * 100}%, ${C.fg400})`, background: `rgb(59 107 255 / ${on * 0.18})`, borderRadius: 5, padding: '0 3px' }}>
                {text}
              </span>
            )
          })}
        </p>
      </div>
      <div style={{ width: 300, padding: '30px 18px', background: C.surface2 }}>
        <div style={{ fontFamily: ui, fontSize: 12, fontWeight: 600, letterSpacing: '0.12em', color: C.fg500, padding: '0 10px' }}>PLAYLIST</div>
        <div style={{ fontFamily: ui, fontSize: 17, fontWeight: 600, color: C.text, padding: '10px 10px 14px' }}>Living Water</div>
        {refs.map((r, i) => {
          const p = spring(t, 1.1 + i * 0.45, SNAPPY)
          return (
            <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 10px', borderRadius: 8, background: i === 0 ? C.surface3 : 'transparent', opacity: p, transform: `translateX(${(1 - p) * -40}px)` }}>
              <BookOpen size={15} weight="fill" color="rgb(110 172 255)" />
              <span style={{ flex: 1, fontFamily: ui, fontSize: 16, fontWeight: 600, color: C.text }}>{r}</span>
              <span style={{ fontFamily: ui, fontSize: 12, color: C.fg500 }}>KJV</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Amazing Grace (John Newton, 1779). Public domain.
const GRACE = [
  ['Verse 1', 'Amazing grace! How sweet the sound', 'That saved a wretch like me!'],
  ['Verse 1', 'I once was lost, but now am found;', 'Was blind, but now I see.'],
  ['Verse 2', '’Twas grace that taught my heart to fear,', 'And grace my fears relieved;'],
  ['Verse 2', 'How precious did that grace appear', 'The hour I first believed.'],
  ['Verse 3', 'Through many dangers, toils and snares,', 'I have already come;'],
  ['Verse 3', '’Tis grace hath brought me safe thus far,', 'And grace will lead me home.'],
]

export function Songs({ t }: { t: number }): React.ReactElement {
  const picked = Math.min(5, Math.floor(seg(t, 1.6, 3.6) * 4) + 1)
  return (
    <div style={{ padding: '26px 30px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: ui, fontSize: 17, fontWeight: 600, color: C.text }}>
        <MusicNotes size={17} weight="fill" color="rgb(167 139 245)" /> Amazing Grace
        <span style={{ fontSize: 13, fontWeight: 500, color: C.fg500, marginLeft: 6 }}>John Newton · Public domain</span>
      </div>
      <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {GRACE.map(([section, a, b], i) => {
          const p = spring(t, 0.3 + i * 0.09, SNAPPY)
          return (
            <div key={i} style={{ borderRadius: 6, border: `2px solid ${i === picked ? '#fff' : C.border}`, overflow: 'hidden', opacity: p, transform: `translateY(${(1 - p) * 14}px)` }}>
              <div style={{ aspectRatio: '16 / 9', background: '#000', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', fontFamily: 'Helvetica Neue, Arial, sans-serif', fontWeight: 700, fontSize: 11.5, lineHeight: 1.35, color: '#fff', textAlign: 'center', padding: '0 10px' }}>
                <div>{a}</div>
                <div>{b}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', height: 24, background: C.surface3 }}>
                <span style={{ alignSelf: 'stretch', width: 64, background: '#3B63D9', color: '#F9FAFB', fontFamily: ui, fontSize: 11, fontWeight: 600, display: 'grid', placeItems: 'center' }}>{section}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: ui, fontSize: 11, color: C.fg400, paddingRight: 8 }}>{i + 1}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function Theme({ t }: { t: number }): React.ReactElement {
  // One setting moves; preview and output change together.
  const size = lerp(0.88, 1.08, io(seg(t, 0.9, 2.6)))
  const slider = io(seg(t, 0.9, 2.6))
  const verse = 'Psalm 23:1'
  const slide = (w: number): React.ReactElement => (
    <div style={{ width: w, height: (w * 9) / 16, position: 'relative', overflow: 'hidden', borderRadius: 4 }}>
      <div style={{ transform: `scale(${size})`, transformOrigin: '50% 38%', width: w, height: (w * 9) / 16 }}>
        <Slide reference={verse} width={w} />
      </div>
    </div>
  )
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, padding: '30px 28px' }}>
        <div style={{ fontFamily: ui, fontSize: 12, fontWeight: 600, letterSpacing: '0.12em', color: C.fg500 }}>PREVIEW</div>
        <div style={{ marginTop: 12 }}>{slide(500)}</div>
        <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: ui, fontSize: 12, fontWeight: 600, letterSpacing: '0.12em', color: C.fg500 }}>MAIN SCREEN</span>
          <span style={{ width: 7, height: 7, borderRadius: 4, background: C.live }} />
        </div>
        <div style={{ marginTop: 10 }}>{slide(220)}</div>
      </div>
      <div style={{ width: 270, background: C.surface2, padding: '30px 24px', fontFamily: ui }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, color: C.text }}>
          <Palette size={16} weight="fill" color={C.pink} /> Scripture theme
        </div>
        {[
          ['Text size', slider],
          ['Line height', 0.42],
          ['Margin', 0.3],
        ].map(([label, v], i) => (
          <div key={i} style={{ marginTop: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.fg400 }}>
              <span>{label as string}</span>
              <span style={{ fontFamily: mono, fontSize: 12 }}>{i === 0 ? Math.round(52 + (v as number) * 16) : i === 1 ? '1.25' : '280'}</span>
            </div>
            <div style={{ marginTop: 10, height: 4, borderRadius: 2, background: C.elevated, position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, height: 4, borderRadius: 2, width: `${30 + (v as number) * 60}%`, background: C.accent }} />
              <div style={{ position: 'absolute', top: -6, left: `calc(${30 + (v as number) * 60}% - 8px)`, width: 16, height: 16, borderRadius: 8, background: '#fff' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Outputs({ t }: { t: number }): React.ReactElement {
  const targets = [
    { label: 'Main Screen', sub: '1920 × 1080', Icon: Television },
    { label: 'Stage display', sub: 'Confidence monitor', Icon: Television },
    { label: 'NDI · Kairo Main', sub: 'to the stream', Icon: Broadcast },
    { label: 'Capture', sub: 'Recording to a movie file', Icon: RecordFill },
  ]
  const ox = 120
  const oy = 260
  return (
    <svg width={820} height={520} style={{ position: 'absolute', inset: 0 }}>
      {targets.map((tg, i) => {
        const y = 70 + i * 116
        const p = io(seg(t, 0.4 + i * 0.22, 1.1 + i * 0.22))
        return (
          <path key={i} d={`M${ox + 44} ${oy} C${ox + 220} ${oy}, ${ox + 220} ${y}, ${430} ${y}`} pathLength={1} fill="none" stroke={C.border} strokeWidth={2} strokeDasharray={1} strokeDashoffset={1 - p} />
        )
      })}
      <foreignObject x={0} y={0} width={820} height={520}>
        <div style={{ position: 'relative', width: 820, height: 520, fontFamily: ui }}>
          <div style={{ position: 'absolute', left: ox - 44, top: oy - 44, width: 88, height: 88, borderRadius: 22, background: C.accent, display: 'grid', placeItems: 'center' }}>
            <svg width={44} height={44} viewBox="0 0 20 20">
              <path d="M4.2 1.5h4.6v7.6H1.5V4.2a2.7 2.7 0 0 1 2.7-2.7Z M10.9 1.5h6.2c.8 0 1.4.6 1.4 1.4 0 3.4-2.8 6.2-6.2 6.2h-1.4Z M1.5 10.9h7.3v7.6H4.2a2.7 2.7 0 0 1-2.7-2.7Z M10.9 10.9h1.4c3.4 0 6.2 2.8 6.2 6.2 0 .8-.6 1.4-1.4 1.4h-6.2Z" fill="#FDF8F2" />
            </svg>
          </div>
          {targets.map(({ label, sub, Icon }, i) => {
            const p = spring(t, 0.9 + i * 0.22, SNAPPY)
            return (
              <div key={label} style={{ position: 'absolute', left: 440, top: 70 + i * 116 - 36, width: 340, height: 72, borderRadius: 12, background: C.surface2, border: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px', opacity: p, transform: `translateX(${(1 - p) * 24}px)` }}>
                <Icon size={22} weight="fill" color={i === 3 ? C.live : C.cyan} />
                <div>
                  <div style={{ fontSize: 17, fontWeight: 600, color: C.text }}>{label}</div>
                  <div style={{ fontSize: 13, color: C.fg500 }}>{sub}</div>
                </div>
              </div>
            )
          })}
        </div>
      </foreignObject>
    </svg>
  )
}

export function Follow({ t }: { t: number }): React.ReactElement {
  const words = 'The woman saith unto him, Sir, give me this water'.split(' ')
  const shown = Math.floor(seg(t, 0.6, 2.4) * words.length)
  const moved = spring(t, 2.5, SNAPPY)
  return (
    <div style={{ padding: '28px 32px', fontFamily: ui }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 17, fontWeight: 600, color: 'rgb(244 244 245)' }}>John 4:14-15</span>
        <span style={{ fontSize: 13, color: C.fg400 }}>KJV</span>
        <span style={{ position: 'relative', marginLeft: 6, height: 22 }}>
          {['Reading v14', 'Reading v15'].map((label, i) => (
            <span key={label} style={{ position: 'absolute', whiteSpace: 'nowrap', borderRadius: 11, background: C.accent, color: '#fff', fontSize: 12, fontWeight: 600, padding: '3px 10px', opacity: i === 0 ? 1 - moved : moved, transform: `translateY(${(i === 0 ? -moved : 1 - moved) * 8}px)` }}>
              {label}
            </span>
          ))}
        </span>
      </div>
      <div style={{ marginTop: 22, display: 'flex', gap: 22 }}>
        {(['John 4:14', 'John 4:15'] as const).map((r, i) => (
          <div key={r}>
            <VerseCard reference={r} width={350} border={i === 0 ? 1 : 0} live={i === 0 ? 1 : 0} />
            <div style={{ height: 28 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -20 }}>
              {i === 1 && (
                <span style={{ position: 'relative', height: 20 }}>
                  <span style={{ position: 'absolute', right: 0, whiteSpace: 'nowrap', borderRadius: 10, border: `1px solid ${C.border}`, color: C.fg300, fontSize: 12, padding: '1px 9px', opacity: 1 - moved }}>Up next</span>
                  <span style={{ position: 'absolute', right: 0, whiteSpace: 'nowrap', borderRadius: 10, background: C.accent, color: '#fff', fontSize: 12, fontWeight: 600, padding: '2px 9px', opacity: moved }}>Reading</span>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 18, fontSize: 18, color: C.fg300 }}>
        <span style={{ color: C.fg500, marginRight: 10 }}>Heard</span>
        {words.slice(0, shown).join(' ')}
        <span style={{ display: 'inline-block', width: 2, height: 18, marginLeft: 4, verticalAlign: 'middle', background: C.accent, opacity: Math.floor(t * 2.4) % 2 }} />
      </p>
    </div>
  )
}

export function Sunday(): React.ReactElement {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const i = STARTS.reduce((k, s, j) => (t >= s ? j : k), 0)
  const local = t - STARTS[i]
  const beat = (STARTS[i + 1] ?? END) - STARTS[i]
  // The panel reshapes between beats on one spring.
  const prev = PANELS[Math.max(0, i - 1)]
  const cur = PANELS[i]
  const morph = i === 0 ? 1 : spring(local, 0, SOFT)
  const w = lerp(prev.w, cur.w, morph)
  const h = lerp(prev.h, cur.h, morph)
  const enter = spring(t, 0, HEAVY)
  // Content: out with the old (masked up), in with the new.
  const contentIn = i === 0 ? spring(local, 0.15, SOFT) : spring(local, 0.25, SOFT)
  const contentOut = i === 4 ? 0 : seg(local, beat - 0.3, beat)
  const views = [Notes, Songs, Theme, Outputs, Follow]
  const View = views[i]
  return (
    <AbsoluteFill>
      <Backdrop />
      <div style={{ position: 'absolute', left: 120, top: 476, width: 860 }}>
        <span style={{ display: 'block', width: 12, height: 12, borderRadius: 6, background: HUES[i], marginBottom: 26, opacity: spring(local, 0, SNAPPY) }} />
        <div key={i} style={{ fontFamily: display, fontWeight: 700, fontSize: 54, lineHeight: 1.06, whiteSpace: 'nowrap', letterSpacing: '-0.035em', color: '#F9FAFB' }}>
          <Words text={TITLES[i]} t={local} start={0.05} exitAt={i === 4 ? undefined : beat - 0.35} />
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 1800 - w,
          top: 540 - h / 2 + (1 - enter) * 40,
          width: w,
          height: h,
          borderRadius: 18,
          background: C.surface,
          border: `1px solid ${C.line}`,
          overflow: 'hidden',
          opacity: enter,
        }}
      >
        <div style={{ position: 'relative', width: '100%', height: '100%', opacity: clamp01(contentIn) * (1 - contentOut), transform: `translateY(${(1 - contentIn) * 18 - contentOut * 18}px)` }}>
          <View t={local} />
        </div>
      </div>
    </AbsoluteFill>
  )
}
