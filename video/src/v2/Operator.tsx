import {
  BookmarkSimple,
  BookOpen,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChatCircleText,
  Clock,
  Eraser,
  FileText,
  Gauge,
  GearSix,
  Globe,
  ImagesSquare,
  Keyboard,
  MagnifyingGlass,
  Microphone,
  MonitorPlay,
  MusicNotes,
  Palette,
  Pause,
  Broadcast,
  Stack,
  TextAlignCenter,
  VideoCamera,
  X,
  Image as ImageIcon,
  Television,
} from '@phosphor-icons/react'
import { mono, ui } from './fonts'
import { clamp01 } from './motion'
import { Slide, type Ref } from './Slide'

/**
 * Operator, rebuilt element by element from the 2× captures of the running
 * app (captures/reference/op-*.png, captures/operator-metrics.json). Layout pixels
 * at 1600×960. Every prop is a state the real screen reached in capture.
 */

export const OP_W = 1600
export const OP_H = 960

// Tokens sampled from the captures (dark theme, src/renderer/src/index.css).
const C = {
  rail: 'rgb(28 31 40)',
  surface: 'rgb(17 19 25)',
  surface2: 'rgb(24 27 35)',
  surface3: 'rgb(33 37 48)',
  elevated: 'rgb(42 46 59)',
  border: 'rgb(56 61 76)',
  line: 'rgb(38 42 54)',
  text: 'rgb(238 238 242)',
  fg200: 'rgb(246 243 235)',
  fg300: 'rgb(214 217 226)',
  fg400: 'rgb(186 190 204)',
  fg500: 'rgb(157 163 182)',
  fg600: 'rgb(125 131 153)',
  accent: 'rgb(59 107 255)',
  accent200: 'rgb(176 202 255)',
  tintTeal: 'rgb(36 44 66)',
  chip: 'rgb(39 39 42)',
  live: 'rgb(240 68 56)',
  tintLive: 'rgb(92 38 40)',
  liveBtn: 'rgb(122 36 36)',
  green: 'rgb(94 204 140)',
  orange: 'rgb(240 152 84)',
  pink: 'rgb(236 120 178)',
  cyan: 'rgb(72 194 216)',
} as const

export const OP_REGIONS = {
  transcript: { x: 57, y: 61, w: 280, h: 899 },
  detected: { x: 337, y: 61, w: 803, h: 899 },
  live: { x: 1140, y: 61, w: 460, h: 899 },
  card: { x: 353, y: 145, w: 182, h: 126 },
  preview: { x: 1140, y: 89, w: 420, h: 237 },
  meter: { x: 321, y: 163, w: 6, h: 760 },
  header: { x: 0, y: 0, w: 1600, h: 60 },
} as const
export type Region = keyof typeof OP_REGIONS

export type OperatorState = {
  /** Scene time in seconds, for the meter's living motion. */
  t: number
  clock: string
  /** Earlier transcript lines. */
  segs: string[]
  /** The line arriving now. */
  line?: {
    text: string
    /** 0→1: words arrived. */
    typed: number
    /** Matched phrase and the passage it resolved to. */
    match?: { phrase: string; ref: Ref; lit: number; chip: number }
    /** 0→1: the phrase lifting out (shown elsewhere as a shared element). */
    lifted?: number
  }
  /** 0→1 input level, already eased by the caller. */
  level: number
  /** Detected group + card arriving. */
  staged?: number
  /** 0→1: the red border drawing round the card. */
  border?: number
  /** 0→1: on screen (preview, tally, label). */
  live?: number
  /** Card pressed (0→1→0). */
  press?: number
  focus?: Region[]
  focusAmount?: number
  /** Rows staged in the queue under the live output, each 0→1 as it arrives. */
  queue?: { ref: string; in: number }[]
}

function KairoMark({ size = 20, color = '#fff' }: { size?: number; color?: string }): React.ReactElement {
  // The four-part mark from website/public/brand/kairo-icon.png, redrawn as vector.
  return (
    <svg width={size} height={size} viewBox="0 0 20 20">
      <path d="M4.2 1.5h4.6v7.6H1.5V4.2a2.7 2.7 0 0 1 2.7-2.7Z M10.9 1.5h6.2c.8 0 1.4.6 1.4 1.4 0 3.4-2.8 6.2-6.2 6.2h-1.4Z M1.5 10.9h7.3v7.6H4.2a2.7 2.7 0 0 1-2.7-2.7Z M10.9 10.9h1.4c3.4 0 6.2 2.8 6.2 6.2 0 .8-.6 1.4-1.4 1.4h-6.2Z" fill={color} />
    </svg>
  )
}

function ToolbarButton({ x, label, icon, tint, color, dot }: { x: number; label: string; icon: React.ReactNode; tint?: string; color?: string; dot?: boolean }): React.ReactElement {
  return (
    <div style={{ position: 'absolute', left: x - 36, top: 9, width: 72, height: 42, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <div style={{ position: 'relative', width: 44, height: 28, borderRadius: 14, background: tint ?? 'rgb(33 37 48 / 0.55)', display: 'grid', placeItems: 'center' }}>
        {icon}
        {dot && <span style={{ position: 'absolute', right: 12, top: 4, width: 7, height: 7, borderRadius: 4, background: C.accent }} />}
      </div>
      <span style={{ fontSize: 11, fontWeight: 500, color: color ?? C.fg300, whiteSpace: 'nowrap', lineHeight: 1 }}>{label}</span>
    </div>
  )
}

function Header({ live }: { live: number }): React.ReactElement {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: OP_W, height: 60, background: C.rail }}>
      <div style={{ position: 'absolute', left: 18, top: 20 }}>
        <KairoMark />
      </div>
      <div style={{ position: 'absolute', left: 92, top: 19, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Gauge size={18} weight="fill" color={C.green} />
        <span style={{ fontSize: 15, fontWeight: 600, color: 'rgb(249 250 251)' }}>Operator</span>
        <Keyboard size={14} color={C.fg600} style={{ marginLeft: 12 }} />
      </div>
      <ToolbarButton x={1288} label="Media" icon={<ImagesSquare size={14} weight="fill" color={C.orange} />} />
      <ToolbarButton x={1360} label="Screen Themes" icon={<MonitorPlay size={14} weight="fill" color={C.pink} />} />
      <ToolbarButton x={1432} label="Screens" icon={<Television size={14} weight="fill" color={C.cyan} />} dot />
      <div style={{ position: 'absolute', inset: 0 }}>
        <div style={{ opacity: 1 - live }}>
          <ToolbarButton x={1503} label="Listening" icon={<Broadcast size={14} color={C.live} />} tint="rgb(92 38 40 / 0.55)" color={C.live} />
        </div>
        <div style={{ opacity: live }}>
          <ToolbarButton x={1503} label="John 4:14" icon={<Broadcast size={14} color={C.live} />} tint={C.tintLive} color={C.live} />
        </div>
      </div>
      <ToolbarButton x={1562} label="Clear" icon={<Eraser size={14} color={C.pink} />} />
    </div>
  )
}

function Rail(): React.ReactElement {
  const items = [Gauge, BookOpen, MusicNotes, FileText, Globe, Palette]
  const ys = [92, 136, 180, 224, 268, 312]
  return (
    <div style={{ position: 'absolute', left: 0, top: 60, width: 56, height: 900, background: C.rail }}>
      <div style={{ position: 'absolute', left: 8, top: 12, width: 40, height: 40, borderRadius: 10, background: C.surface3 }} />
      {items.map((Icon, i) => (
        <div key={i} style={{ position: 'absolute', left: 18, top: ys[i] - 60 - 10 }}>
          <Icon size={20} weight={i === 0 ? 'fill' : 'regular'} color={i === 0 ? C.green : C.fg500} />
        </div>
      ))}
      <div style={{ position: 'absolute', left: 18, top: 795 }}>
        <Microphone size={20} color={C.fg500} />
        <span style={{ position: 'absolute', right: -2, bottom: -2, width: 7, height: 7, borderRadius: 4, background: C.green }} />
      </div>
      <div style={{ position: 'absolute', left: 18, top: 840 }}>
        <GearSix size={20} color={C.fg500} />
      </div>
    </div>
  )
}

function Meter({ t, level }: { t: number; level: number }): React.ReactElement {
  const bars = 24
  // A living level: the caller's envelope times a deterministic flicker.
  const flicker = 0.75 + 0.25 * Math.abs(Math.sin(t * 13.1)) * Math.abs(Math.sin(t * 5.3 + 1))
  const lit = Math.round(clamp01(level * flicker) * bars * 0.62)
  return (
    <div style={{ position: 'absolute', left: 264, top: 99, width: 6, height: 780 }}>
      <span style={{ position: 'absolute', left: 0, top: 0, width: 6, height: 6, borderRadius: 3, background: C.elevated }} />
      {Array.from({ length: bars }, (_, i) => {
        const fromBottom = bars - 1 - i
        const on = fromBottom < lit
        return (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              top: 16 + i * 31.4,
              width: 6,
              height: 28,
              borderRadius: 3,
              background: on ? (fromBottom > bars * 0.82 ? C.live : fromBottom > bars * 0.66 ? 'rgb(240 190 84)' : C.green) : C.surface3,
            }}
          />
        )
      })}
    </div>
  )
}

function Line({ s }: { s: NonNullable<OperatorState['line']> }): React.ReactElement {
  const words = s.text.split(' ')
  const shown = Math.floor(clamp01(s.typed) * words.length + 1e-6)
  const m = s.match
  const pStart = m ? s.text.indexOf(m.phrase) : -1
  const pEnd = pStart + (m?.phrase.length ?? 0)
  const phraseWords = m ? m.phrase.split(' ').length : 0
  // Split the words into before / phrase / after, keeping each word's state.
  let pos = 0
  const parts = words.map((w, i) => {
    const at = pos
    pos += w.length + 1
    const inPhrase = !!m && at >= pStart && at < pEnd
    const k = inPhrase ? s.text.slice(pStart, at).split(' ').length - 1 : 0
    return { w, i, inPhrase, k }
  })
  const word = ({ w, i, inPhrase, k }: (typeof parts)[number]): React.ReactElement => {
    const hidden = i >= shown
    const arriving = i === shown - 1 && s.typed < 1
    // The light sweeps across the phrase word by word.
    const lit = inPhrase && m ? clamp01(m.lit * phraseWords - k) : 0
    return (
      <span
        key={i}
        style={{
          opacity: hidden ? 0 : arriving ? 0.6 : 1,
          color: lit > 0 ? `color-mix(in srgb, ${C.accent200} ${lit * 100}%, ${C.text})` : undefined,
        }}
      >
        {w}
        {i < words.length - 1 ? ' ' : ''}
      </span>
    )
  }
  const before = parts.filter((p) => !p.inPhrase && p.i < (parts.find((q) => q.inPhrase)?.i ?? Infinity))
  const phrase = parts.filter((p) => p.inPhrase)
  const after = parts.filter((p) => !p.inPhrase && !before.includes(p))
  const markOn = m && m.lit > 0 ? clamp01(m.lit * 4) : 0
  return (
    <p style={{ margin: 0, color: C.text }}>
      {before.map(word)}
      {phrase.length > 0 && (
        <mark style={{ background: `rgb(36 44 66 / ${markOn})`, color: 'inherit', paddingBottom: 2, opacity: 1 - (s.lifted ?? 0) * 0.85 }}>{phrase.map(word)}</mark>
      )}
      {after.map(word)}
      {m && m.chip > 0 && (
        <span
          style={{
            marginLeft: 5,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            padding: '2px 5px',
            borderRadius: 4,
            background: C.chip,
            fontSize: 10,
            lineHeight: 1.2,
            color: C.fg300,
            verticalAlign: 'middle',
            opacity: m.chip,
            transform: `translateY(${(1 - m.chip) * 3}px) scale(${0.9 + m.chip * 0.1})`,
          }}
        >
          <BookOpen size={9} />
          {m.ref}
        </span>
      )}
    </p>
  )
}

function Transcript({ s }: { s: OperatorState }): React.ReactElement {
  return (
    <div style={{ position: 'absolute', left: 57, top: 61, width: 280, height: 899, background: C.surface2 }}>
      <span style={{ position: 'absolute', left: 16, top: 13, fontSize: 12, fontWeight: 600, color: C.fg200 }}>Transcript</span>
      <BookmarkSimple size={13} color={C.fg500} style={{ position: 'absolute', left: 186, top: 16 }} />
      <div style={{ position: 'absolute', left: 201, top: 7, width: 68, height: 27, borderRadius: 8, background: C.surface3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: C.text }}>
        <Pause size={10} weight="fill" /> Pause
      </div>
      <div style={{ position: 'absolute', left: 16, top: 44, width: 248, height: 36, borderRadius: 10, background: C.surface3 }}>
        <span style={{ position: 'absolute', left: 12, top: 14, width: 8, height: 8, borderRadius: 4, background: C.live }} />
        <span style={{ position: 'absolute', left: 30, top: 9, fontFamily: mono, fontSize: 13, color: C.text }}>{s.clock}</span>
        <span style={{ position: 'absolute', left: 103, top: 9, fontSize: 12, color: C.fg400 }}>Living Water</span>
        <span style={{ position: 'absolute', right: 5, top: 4, width: 40, height: 28, borderRadius: 7, background: C.elevated, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600, color: C.text }}>End</span>
      </div>
      <div style={{ position: 'absolute', left: 16, top: 108, width: 180, fontSize: 14, lineHeight: '24.5px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {s.segs.map((seg, i) => (
          <p key={i} style={{ margin: 0, color: C.fg300 }}>
            {seg}
          </p>
        ))}
        {s.line && <Line s={s.line} />}
      </div>
      <Meter t={s.t} level={s.level} />
      <Microphone size={11} color={C.fg600} style={{ position: 'absolute', left: 262, top: 880 }} />
    </div>
  )
}

/** The verse card exactly as captured: 182×126, 2 px border, 22 px footer. */
export function VerseCard({ reference, border = 0, live = 0, width = 182, press = 0 }: { reference: Ref; border?: number; live?: number; width?: number; press?: number }): React.ReactElement {
  const k = width / 182
  const w = 182
  const h = 126
  const perim = 2 * (w + h)
  return (
    <div style={{ width: w * k, height: h * k, position: 'relative', fontFamily: ui }}>
      <div style={{ width: w, height: h, transform: `scale(${k * (1 - press * 0.02)})`, transformOrigin: '0 0', position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 6, border: `2px solid ${C.border}`, overflow: 'hidden', background: C.surface3 }}>
          <Slide reference={reference} width={178} />
          <div style={{ height: 22, display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 12, fontWeight: 500, color: C.fg300 }}>
            <span style={{ flex: 1 }}>{reference}</span>
            <span style={{ opacity: 0.8 }}>1</span>
          </div>
        </div>
        {border > 0 && (
          <svg width={w} height={h} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            <rect x={1} y={1} width={w - 2} height={h - 2} rx={6} fill="none" stroke={C.live} strokeWidth={2} strokeDasharray={perim} strokeDashoffset={perim * (1 - clamp01(border))} />
          </svg>
        )}
      </div>
      {live > 0 && (
        <span style={{ position: 'absolute', right: 0, top: h * k + 9, display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 * k, fontWeight: 600, color: C.live, opacity: live, whiteSpace: 'nowrap' }}>
          <span style={{ width: 6 * k, height: 6 * k, borderRadius: 3 * k, background: C.live }} />
          On screen
        </span>
      )}
    </div>
  )
}

function Detected({ s, hideCard }: { s: OperatorState; hideCard?: boolean }): React.ReactElement {
  const staged = s.staged ?? 0
  return (
    <div style={{ position: 'absolute', left: 337, top: 61, width: 803, height: 899, background: C.surface }}>
      <span style={{ position: 'absolute', left: 16, top: 9, fontSize: 11, fontWeight: 500, color: C.fg400 }}>
        Detected <span style={{ color: C.fg600, marginLeft: 6, opacity: staged > 0.5 ? 1 : 0 }}>1</span>
      </span>
      <span style={{ position: 'absolute', left: 646, top: 9, fontSize: 11, fontWeight: 500, color: C.fg400 }}>Automation</span>
      <span style={{ position: 'absolute', left: 708, top: 8, width: 30, height: 17, borderRadius: 9, background: C.elevated }}>
        <span style={{ position: 'absolute', left: 2, top: 2, width: 13, height: 13, borderRadius: 7, background: C.text }} />
      </span>
      <span style={{ position: 'absolute', left: 752, top: 10, fontSize: 10, fontWeight: 600, color: C.fg600, opacity: staged > 0.5 ? 1 : 0 }}>Clear</span>
      {staged < 0.5 && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: 410, textAlign: 'center', opacity: 1 - staged * 2 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: C.fg400 }}>Listening for scripture</p>
          <p style={{ margin: '4px auto 0', width: 260, fontSize: 11, lineHeight: 1.5, color: C.fg600 }}>Quoted verses land here as slides. Click one to send it live.</p>
        </div>
      )}
      {staged > 0 && (
        <div style={{ opacity: clamp01(staged * 1.6), transform: `translateY(${(1 - staged) * -8}px)` }}>
          <div style={{ position: 'absolute', left: 16, top: 41, display: 'flex', alignItems: 'baseline', gap: 9 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgb(244 244 245)' }}>John 4:14</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 500, color: C.fg400 }}>
              KJV <CaretDown size={10} />
            </span>
          </div>
          <CaretLeft size={14} color={C.fg500} style={{ position: 'absolute', left: 742, top: 52 }} />
          <CaretRight size={14} color={C.fg500} style={{ position: 'absolute', left: 768, top: 52 }} />
          {!hideCard && (
            <div style={{ position: 'absolute', left: 16, top: 84, transform: `scale(${0.97 + staged * 0.03})`, transformOrigin: '0 0' }}>
              <VerseCard reference="John 4:14" border={s.border} live={s.live} press={s.press} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LiveRail({ s }: { s: OperatorState }): React.ReactElement {
  const live = s.live ?? 0
  const sideIcons = [MusicNotes, ChatCircleText, Stack, TextAlignCenter, ImageIcon, VideoCamera]
  const tabs: [string, typeof BookOpen][] = [
    ['Scripture', BookOpen],
    ['Audio', MusicNotes],
    ['Timers', Clock],
    ['Messages', ChatCircleText],
    ['Props', Stack],
    ['Camera', VideoCamera],
  ]
  return (
    <div style={{ position: 'absolute', left: 1140, top: 61, width: 460, height: 899, background: C.surface2 }}>
      <span style={{ position: 'absolute', left: 12, top: 6, fontSize: 11, fontWeight: 500, color: C.fg400 }}>Live</span>
      <div style={{ position: 'absolute', left: 0, top: 28, width: 420, height: 237, background: '#000', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 1 - live }}>
          <BookOpen size={18} color={C.fg500} />
          <span style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: C.fg500 }}>Nothing is live</span>
          <span style={{ marginTop: 2, fontSize: 10, color: C.fg600 }}>Send a verse or click a background</span>
        </div>
        <div style={{ position: 'absolute', inset: 0, opacity: live }}>
          <Slide reference="John 4:14" width={420} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 424, top: 32, width: 32, height: 32, borderRadius: 8, background: live > 0.5 ? C.liveBtn : 'transparent', display: 'grid', placeItems: 'center' }}>
        <X size={14} color={live > 0.5 ? '#fff' : C.fg500} />
      </div>
      {sideIcons.map((Icon, i) => (
        <div key={i} style={{ position: 'absolute', left: 424, top: 68 + i * 36, width: 32, height: 32, borderRadius: 8, background: i === 3 && live > 0.5 ? C.surface3 : 'transparent', display: 'grid', placeItems: 'center' }}>
          <Icon size={14} color={C.fg500} />
        </div>
      ))}
      <div style={{ position: 'absolute', left: 12, top: 273, width: 396, height: 32, borderRadius: 8, background: C.elevated, display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 13, fontWeight: 600, color: C.text }}>
        <span style={{ flex: 1 }}>Main Screen</span>
        <CaretDown size={12} color={C.fg400} />
      </div>
      <div style={{ position: 'absolute', left: 0, top: 313, width: 460, height: 44, display: 'flex' }}>
        {tabs.map(([label, Icon], i) => (
          <div key={label} style={{ flex: 1, background: i === 0 ? C.accent : C.surface3, borderLeft: i > 0 ? `1px solid ${C.surface2}` : undefined, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, color: i === 0 ? '#fff' : C.fg400 }}>
            <Icon size={14} />
            <span style={{ fontSize: 10, fontWeight: 500 }}>{label}</span>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 16, top: 369, width: 428, height: 32, borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface2, display: 'flex', alignItems: 'center', gap: 9, padding: '0 12px', fontSize: 13, color: C.fg500 }}>
        <MagnifyingGlass size={13} />
        John 3:16 · or “love is patient”
      </div>
      <span style={{ position: 'absolute', left: 12, top: 415, fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', color: C.fg500 }}>QUEUE</span>
      {s.queue && s.queue.length > 0 ? (
        s.queue.map((q, i) => (
          <div key={q.ref} style={{ position: 'absolute', left: 8, right: 8, top: 438 + i * 40, height: 34, borderRadius: 8, background: C.surface3, display: 'flex', alignItems: 'center', gap: 9, padding: '0 10px', fontSize: 13, fontWeight: 600, color: C.text, opacity: q.in, transform: `translateY(${(1 - q.in) * -6}px)` }}>
            <BookOpen size={13} weight="fill" color="rgb(110 172 255)" />
            <span style={{ flex: 1 }}>{q.ref}</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: C.fg500 }}>KJV</span>
          </div>
        ))
      ) : (
        <span style={{ position: 'absolute', left: 0, right: 0, top: 462, textAlign: 'center', fontSize: 10.5, color: C.fg600 }}>
          Stage verses here with + on a detection, or search above. Click a row to put it on screen.
        </span>
      )}
    </div>
  )
}

export function Operator({ s, hideCard }: { s: OperatorState; hideCard?: boolean }): React.ReactElement {
  const dim = (r: Region): React.CSSProperties => {
    const a = s.focus && !s.focus.includes(r) ? s.focusAmount ?? 1 : 0
    return a > 0 ? { filter: `blur(${a * 2}px) brightness(${1 - a * 0.55}) saturate(${1 - a * 0.4})` } : {}
  }
  return (
    <div style={{ position: 'relative', width: OP_W, height: OP_H, background: C.rail, borderRadius: 12, overflow: 'hidden', fontFamily: ui, color: C.text, WebkitFontSmoothing: 'antialiased' }}>
      <div style={dim('header')}>
        <Header live={s.live ?? 0} />
      </div>
      <Rail />
      <div style={{ position: 'absolute', left: 56, top: 60, width: 1544, height: 900, borderTopLeftRadius: 16, overflow: 'hidden', background: C.surface }}>
        <div style={{ position: 'absolute', left: -56, top: -60, width: OP_W, height: OP_H }}>
          <div style={dim('transcript')}>
            <Transcript s={s} />
          </div>
          <div style={dim('detected')}>
            <Detected s={s} hideCard={hideCard} />
          </div>
          <div style={dim('live')}>
            <LiveRail s={s} />
          </div>
        </div>
      </div>
    </div>
  )
}

export { C as OP_COLORS }
