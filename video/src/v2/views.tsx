import {
  BookOpen,
  CaretDown,
  FileArrowDown,
  FilePdf,
  Globe,
  ImagesSquare,
  Lock,
  MagnifyingGlass,
  MusicNotes,
  Play,
  Record,
  Television,
} from '@phosphor-icons/react'
import { display, mono, ui } from './fonts'
import { SNAPPY, SOFT, camera, clamp01, io, lerp, seg, spring, type CamKey } from './motion'
import { OP_COLORS as C, OP_H, OP_W, Operator, VerseCard, type OperatorState } from './Operator'
import { KJV, Slide, type Ref } from './Slide'

/**
 * Walkthrough views. Each is a state the app has, drawn in the app's own
 * tokens and type (see Operator.tsx). All take scene time `t` in seconds.
 */

const label: React.CSSProperties = { fontFamily: ui, fontSize: 12, fontWeight: 600, letterSpacing: '0.12em', color: C.fg500 }

/** The Operator filmed whole or in part: a camera over a fixed state. */
export function OperatorShot({ t, s, cam }: { t: number; s: Omit<OperatorState, 't'>; cam: CamKey[] }): React.ReactElement {
  const c = camera(t, cam)
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: OP_W, height: OP_H, transformOrigin: '0 0', transform: `translate(960px, 540px) scale(${c.zoom}) translate(${-c.x}px, ${-c.y}px)` }}>
        <Operator s={{ ...s, t }} />
      </div>
    </div>
  )
}

const SEGS = [
  'Good morning, church. It’s good to be together.',
  'If you’ve got your Bibles, keep them close. We’ll be in one place today.',
  'I want to start with a question this morning.',
  'When was the last time you felt really tired?',
]
const LINE = 'Jesus said, drink the water I give, and you’ll never be thirsty again.'
const PHRASE = 'drink the water I give, and you’ll never be thirsty again'
export const OP_LIVE: Omit<OperatorState, 't'> = {
  clock: '00:15:02',
  segs: SEGS,
  line: { text: LINE, typed: 1, match: { phrase: PHRASE, ref: 'John 4:14', lit: 1, chip: 1 } },
  level: 0.4,
  staged: 1,
  border: 1,
  live: 1,
}

/** Establishing shot: the whole app, slowly drifting. */
export function WideOperator({ t }: { t: number }): React.ReactElement {
  return <OperatorShot t={t} s={{ ...OP_LIVE }} cam={[[0, 1.02, 800, 500], [8, 1.1, 820, 490]]} />
}

/** Live output on top, the queue below: the rail. */
export function LiveAndQueue({ t }: { t: number }): React.ReactElement {
  return <OperatorShot t={t} s={{ ...OP_LIVE, focus: ['live'], focusAmount: 0.85 }} cam={[[0, 1.5, 1000, 360], [5.4, 1.58, 1010, 350]]} />
}

/** Stage the next verse while this one is live. */
export function StageNext({ t }: { t: number }): React.ReactElement {
  const q = spring(t, 1.2, SNAPPY)
  return <OperatorShot t={t} s={{ ...OP_LIVE, queue: [{ ref: 'John 4:15', in: q }], focus: ['live'], focusAmount: 0.85 }} cam={[[0, 1.58, 1010, 350], [5.4, 1.66, 1020, 380]]} />
}

/** The screens dialog: displays arranged on a canvas. */
export function Screens({ t }: { t: number }): React.ReactElement {
  const a = spring(t, 0.5, SOFT)
  const b = spring(t, 1.1, SOFT)
  const screen = (x: number, y: number, w: number, n: number, name: string, on: number, picked?: boolean): React.ReactElement => (
    <div style={{ position: 'absolute', left: x, top: y + (1 - on) * 16, width: w, height: (w * 9) / 16, borderRadius: 6, background: 'rgb(76 81 98)', border: picked ? `2px solid ${C.accent}` : '2px solid transparent', opacity: on, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
      <div>
        <div style={{ fontFamily: ui, fontSize: 26, fontWeight: 700, color: '#fff' }}>{n}</div>
        <div style={{ fontFamily: ui, fontSize: 12, color: 'rgb(238 238 242 / 0.8)' }}>{name}</div>
      </div>
    </div>
  )
  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: ui }}>
      <div style={{ width: 230, background: 'rgb(22 24 31)', padding: '20px 14px' }}>
        <div style={{ display: 'flex', gap: 7, marginBottom: 22 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 11, height: 11, borderRadius: 6, background: C.fg600 }} />
          ))}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, padding: '0 8px 10px' }}>Audience</div>
        <div style={{ borderRadius: 8, background: C.accent, padding: '9px 10px', color: '#fff' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Main Screen</div>
          <div style={{ fontSize: 11, opacity: 0.8 }}>Projector · HDMI</div>
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text, padding: '20px 8px 10px' }}>Stage</div>
        <div style={{ borderRadius: 8, padding: '9px 10px', color: C.fg300, opacity: b }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Stage display</div>
          <div style={{ fontSize: 11, color: C.fg500 }}>Confidence monitor</div>
        </div>
      </div>
      <div style={{ flex: 1, padding: '22px 26px' }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: C.text }}>Main Screen</div>
        <div style={{ fontSize: 12, color: C.fg500, marginTop: 2 }}>Projector · 1920 × 1080</div>
        <div style={{ position: 'relative', marginTop: 18, height: 250, borderRadius: 10, background: 'rgb(10 11 16)' }}>
          {screen(60, 50, 250, 1, 'Projector', a, true)}
          {screen(340, 95, 150, 2, 'Stage display', b)}
        </div>
        <div style={{ marginTop: 18, display: 'flex', gap: 14 }}>
          {['Output', 'Content'].map((k, i) => (
            <div key={k} style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: C.fg400, marginBottom: 6 }}>{k}</div>
              <div style={{ height: 34, borderRadius: 8, background: C.elevated, display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 13, color: C.text }}>
                <span style={{ flex: 1 }}>{i === 0 ? 'Projector (HDMI)' : 'Follows the service'}</span>
                <CaretDown size={12} color={C.fg400} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Translations: three built in, the rest through the church's licence. */
export function Translations({ t }: { t: number }): React.ReactElement {
  const rows: [string, string, boolean][] = [
    ['KJV', 'King James Version', true],
    ['BSB', 'Berean Standard Bible', true],
    ['BBE', 'Bible in Basic English', true],
    ['NIV', 'New International Version', false],
    ['NLT', 'New Living Translation', false],
    ['NKJV', 'New King James Version', false],
  ]
  const lit = io(seg(t, 5.5, 6.4))
  return (
    <div style={{ padding: '26px 30px', fontFamily: ui }}>
      <div style={{ fontSize: 17, fontWeight: 600, color: C.text }}>Translations</div>
      <div style={{ marginTop: 18, borderRadius: 12, background: C.surface2 }}>
        {rows.map(([id, name, built], i) => {
          const p = spring(t, 0.3 + i * 0.12, SNAPPY)
          const on = built ? 1 - lit * 0.5 : 0.5 + lit * 0.5
          return (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', borderTop: i ? `1px solid ${C.line}` : undefined, opacity: p * on }}>
              <span style={{ width: 54, fontWeight: 700, fontSize: 15, color: C.text }}>{id}</span>
              <span style={{ flex: 1, fontSize: 15, color: C.fg300 }}>{name}</span>
              {built ? (
                <span style={{ fontSize: 12, fontWeight: 600, color: C.green }}>Built in · offline</span>
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: C.fg400 }}>
                  <Lock size={12} /> Church license
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The notes document on its own (before import). */
export function NotesDoc({ t }: { t: number }): React.ReactElement {
  const lines = [
    'Living Water',
    'The woman at the well comes alone, at noon.',
    'John 4:13–14: water that ends thirst.',
    'The Lord is the one who supplies: Psalm 23:1.',
    'Those who wait on him are renewed: Isaiah 40:31.',
  ]
  return (
    <div style={{ padding: '34px 40px', fontFamily: ui }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600, color: C.fg400 }}>
        <FileArrowDown size={16} /> notes.docx · Saturday 8:14 PM
      </div>
      {lines.map((l, i) => {
        const p = spring(t, 0.4 + i * 0.25, SOFT)
        return (
          <p key={i} style={{ margin: i === 0 ? '26px 0 10px' : '10px 0', fontFamily: i === 0 ? display : ui, fontWeight: i === 0 ? 700 : 400, fontSize: i === 0 ? 34 : 21, color: i === 0 ? C.text : C.fg400, opacity: p, transform: `translateY(${(1 - p) * 10}px)` }}>
            {l}
          </p>
        )
      })}
    </div>
  )
}

/** The playlist the notes became, with previews in the church's theme. */
export function Playlist({ t }: { t: number }): React.ReactElement {
  const items: Ref[] = ['John 4:13', 'Psalm 23:1', 'Isaiah 40:31']
  const pick = Math.min(2, Math.floor(seg(t, 1.6, 5.2) * 3))
  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: ui }}>
      <div style={{ width: 300, background: C.surface2, padding: '26px 16px' }}>
        <div style={{ ...label, padding: '0 10px' }}>PLAYLIST</div>
        <div style={{ fontSize: 17, fontWeight: 600, color: C.text, padding: '10px 10px 14px' }}>Living Water</div>
        {['John 4:13–14', 'Psalm 23:1', 'Isaiah 40:31'].map((r, i) => (
          <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 10px', borderRadius: 8, background: i === pick ? C.surface3 : 'transparent' }}>
            <BookOpen size={15} weight="fill" color="rgb(110 172 255)" />
            <span style={{ flex: 1, fontSize: 16, fontWeight: 600, color: C.text }}>{r}</span>
            <span style={{ fontSize: 12, color: C.fg500 }}>KJV</span>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, padding: 28 }}>
        <div style={label}>PREVIEW</div>
        <div style={{ marginTop: 12, borderRadius: 6, overflow: 'hidden' }}>
          <Slide reference={items[pick]} width={480} />
        </div>
      </div>
    </div>
  )
}

/** Import a song: the text comes in, and its sections are found. */
export function ImportSong({ t }: { t: number }): React.ReactElement {
  const sections = ['Verse 1', 'Verse 2', 'Verse 3', 'Verse 4']
  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: ui }}>
      <div style={{ flex: 1, padding: '28px 30px', borderRight: `1px solid ${C.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600, color: C.fg400 }}>
          <FileArrowDown size={16} /> Amazing Grace.txt
        </div>
        <pre style={{ marginTop: 18, fontFamily: mono, fontSize: 15, lineHeight: 1.7, color: C.fg400, whiteSpace: 'pre-wrap' }}>
          {`Verse 1\nAmazing grace! How sweet the sound\nThat saved a wretch like me!\nI once was lost, but now am found;\nWas blind, but now I see.\n\nVerse 2\n’Twas grace that taught my heart to fear,`}
        </pre>
      </div>
      <div style={{ width: 300, padding: '28px 20px', background: C.surface2 }}>
        <div style={label}>SECTIONS</div>
        {sections.map((s, i) => {
          const p = spring(t, 1.2 + i * 0.35, SNAPPY)
          return (
            <div key={s} style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, opacity: p, transform: `translateX(${(1 - p) * -24}px)` }}>
              <span style={{ width: 90, height: 30, borderRadius: 6, background: '#3B63D9', color: '#F9FAFB', fontSize: 13, fontWeight: 600, display: 'grid', placeItems: 'center' }}>{s}</span>
              <span style={{ fontSize: 13, color: C.fg500 }}>2 slides</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The song set, presented in order. Public-domain hymns. */
export function Setlist({ t }: { t: number }): React.ReactElement {
  const songs: [string, string][] = [
    ['Holy, Holy, Holy', 'Reginald Heber'],
    ['Come Thou Fount', 'Robert Robinson'],
    ['Amazing Grace', 'John Newton'],
    ['It Is Well with My Soul', 'Horatio Spafford'],
  ]
  const now = Math.min(3, Math.floor(seg(t, 1.5, 8) * 4))
  return (
    <div style={{ padding: '26px 28px', fontFamily: ui }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 17, fontWeight: 600, color: C.text }}>
        <MusicNotes size={17} weight="fill" color="rgb(167 139 245)" /> Sunday set
      </div>
      <div style={{ marginTop: 18 }}>
        {songs.map(([title, by], i) => {
          const p = spring(t, 0.3 + i * 0.12, SNAPPY)
          return (
            <div key={title} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 18px', borderRadius: 10, background: i === now ? C.surface3 : 'transparent', opacity: p }}>
              <span style={{ width: 22, fontFamily: mono, fontSize: 14, color: C.fg500 }}>{i + 1}</span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 17, fontWeight: 600, color: C.text }}>{title}</span>
                <span style={{ fontSize: 12, color: C.fg500 }}>{by} · Public domain</span>
              </span>
              {i === now && <Play size={16} weight="fill" color={C.accent200} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Matching on meaning, at panel scale. */
export function Meaning({ t }: { t: number }): React.ReactElement {
  const lit = io(seg(t, 1.2, 2.0))
  const key = (on: number): React.CSSProperties => ({ color: `color-mix(in srgb, rgb(176 202 255) ${on * 100}%, rgb(214 217 226))`, background: `rgb(59 107 255 / ${on * 0.18})`, borderRadius: 5 })
  return (
    <div style={{ padding: '30px 34px', fontFamily: ui }}>
      <div style={label}>HEARD</div>
      <p style={{ margin: '10px 0 0', fontFamily: display, fontWeight: 600, fontSize: 30, lineHeight: 1.35, color: C.text }}>
        Jesus said, <span style={key(lit)}>drink the water I give</span>, and <span style={key(lit)}>you’ll never be thirsty</span> again.
      </p>
      <div style={{ ...label, marginTop: 30 }}>FOUND</div>
      <p style={{ margin: '10px 0 0', fontSize: 19, lineHeight: 1.6, color: C.fg300, opacity: spring(t, 0.8, SOFT) }}>
        But whosoever <span style={key(lit)}>drinketh of the water that I shall give</span> him <span style={key(lit)}>shall never thirst</span>; but the water that I shall give him shall be in him a well of water springing up into everlasting life.
      </p>
      <div style={{ marginTop: 16, fontFamily: mono, fontSize: 18, color: C.text, opacity: spring(t, 2.1, SNAPPY) }}>John 4:14 · KJV</div>
    </div>
  )
}

/** A range comes through as slides, in order. */
export function Range({ t }: { t: number }): React.ReactElement {
  const refs = ['John 4:7', 'John 4:8', 'John 4:9', 'John 4:10', 'John 4:11', 'John 4:12', 'John 4:13', 'John 4:14'] as Ref[]
  return (
    <div style={{ padding: '24px 26px', fontFamily: ui }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 17, fontWeight: 600, color: 'rgb(244 244 245)' }}>John 4:7-14</span>
        <span style={{ fontSize: 13, color: C.fg400 }}>KJV</span>
      </div>
      <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(4, 182px)', gap: 14 }}>
        {refs.map((r, i) => {
          const p = spring(t, 0.3 + i * 0.07, SNAPPY)
          return (
            <div key={r} style={{ opacity: p, transform: `translateY(${(1 - p) * -8}px) scale(${0.97 + p * 0.03})` }}>
              <VerseCard reference={r} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Search by a phrase you half remember. */
export function Search({ t }: { t: number }): React.ReactElement {
  const q = 'living water'
  const chars = Math.floor(seg(t, 0.5, 1.4) * q.length)
  const results: Ref[] = ['John 4:10', 'John 7:38', 'Jeremiah 2:13']
  return (
    <div style={{ padding: '26px 28px', fontFamily: ui }}>
      <div style={{ height: 46, borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface2, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', fontSize: 18, color: C.text }}>
        <MagnifyingGlass size={17} color={C.fg500} />
        {chars > 0 ? q.slice(0, chars) : <span style={{ color: C.fg500 }}>John 3:16 · or “love is patient”</span>}
      </div>
      <div style={{ marginTop: 14 }}>
        {results.map((r, i) => {
          const p = spring(t, 1.6 + i * 0.12, SNAPPY)
          const text = KJV[r]
          const at = text.indexOf('living water')
          return (
            <div key={r} style={{ padding: '14px 16px', borderRadius: 10, background: i === 0 ? C.surface3 : 'transparent', opacity: p, transform: `translateY(${(1 - p) * -6}px)` }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
                {r} <span style={{ fontWeight: 500, fontSize: 12, color: C.fg500 }}>KJV</span>
              </div>
              <div style={{ marginTop: 4, fontSize: 15, lineHeight: 1.45, color: C.fg400 }}>
                {text.slice(0, at)}
                <span style={{ color: C.accent200, fontWeight: 600 }}>{text.slice(at, at + 12)}</span>
                {text.slice(at + 12)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** A document's pages and a web page, both ready for the screen. */
export function DocsWeb({ t }: { t: number }): React.ReactElement {
  const a = spring(t, 0.3, SOFT)
  const b = spring(t, 0.9, SOFT)
  return (
    <div style={{ display: 'flex', gap: 22, padding: 26, fontFamily: ui, height: '100%' }}>
      <div style={{ flex: 1, opacity: a, transform: `translateY(${(1 - a) * 14}px)` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: C.fg300 }}>
          <FilePdf size={16} weight="fill" color={C.cyan} /> Announcements.pdf
        </div>
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {['Welcome', 'Youth night · Friday 7 PM', 'Baptism class', 'Give'].map((p, i) => (
            <div key={p} style={{ borderRadius: 6, border: `2px solid ${i === 0 ? '#fff' : C.border}`, overflow: 'hidden' }}>
              <div style={{ aspectRatio: '16 / 9', background: 'linear-gradient(135deg, #f2efe8, #e3ddd0)', display: 'grid', placeItems: 'center', fontFamily: display, fontWeight: 700, fontSize: 14, color: '#1d2433', padding: 8, textAlign: 'center' }}>{p}</div>
              <div style={{ height: 22, background: C.surface3, fontSize: 11, color: C.fg400, display: 'flex', alignItems: 'center', padding: '0 8px' }}>Page {i + 1}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ width: 330, opacity: b, transform: `translateY(${(1 - b) * 14}px)` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: C.fg300 }}>
          <Globe size={16} weight="fill" color="rgb(138 146 245)" /> Web
        </div>
        <div style={{ marginTop: 14, height: 30, borderRadius: 8, background: C.surface3, display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 13, color: C.fg300 }}>kairopresenter.com</div>
        <div style={{ marginTop: 10, aspectRatio: '16 / 10', borderRadius: 8, overflow: 'hidden', background: '#0C111D', border: `1px solid ${C.line}`, display: 'grid', placeItems: 'center' }}>
          <div style={{ textAlign: 'center', fontFamily: display, fontWeight: 700, fontSize: 20, color: '#F9FAFB', lineHeight: 1.2 }}>
            Because every
            <br />
            moment matters.
          </div>
        </div>
        <div style={{ marginTop: 12, height: 34, borderRadius: 8, background: C.accent, color: '#fff', fontSize: 13, fontWeight: 600, display: 'grid', placeItems: 'center' }}>Show on screens</div>
      </div>
    </div>
  )
}

/** Backgrounds from the media folder. */
export function Media({ t }: { t: number }): React.ReactElement {
  const fills = [
    'linear-gradient(140deg, #1b2a4a, #0b1222)',
    'linear-gradient(160deg, #3b2a1e, #120d0a)',
    'radial-gradient(circle at 30% 30%, #2f4d62, #0a1219)',
    'linear-gradient(120deg, #233b2f, #0b1410)',
    'radial-gradient(circle at 70% 60%, #4a2c4f, #120b14)',
    'linear-gradient(180deg, #2c3446, #0d1018)',
    'linear-gradient(135deg, #483a20, #120f08)',
    'radial-gradient(circle at 50% 80%, #1f4a5a, #071116)',
  ]
  const live = spring(t, 2.4, SOFT)
  return (
    <div style={{ padding: '24px 26px', fontFamily: ui }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 17, fontWeight: 600, color: C.text }}>
        <ImagesSquare size={17} weight="fill" color={C.orange} /> Media
        <span style={{ fontSize: 13, fontWeight: 500, color: C.fg500 }}>Kairo Presenter / Media</span>
      </div>
      <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {fills.map((f, i) => {
          const p = spring(t, 0.3 + i * 0.06, SNAPPY)
          const isLive = i === 2
          return (
            <div key={i} style={{ aspectRatio: '16 / 9', borderRadius: 6, background: f, border: `2px solid ${isLive && live > 0.5 ? C.live : 'transparent'}`, opacity: p, transform: `scale(${0.96 + p * 0.04})` }} />
          )
        })}
      </div>
      <div style={{ marginTop: 14, height: 18, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: C.live, opacity: live }}>
        <span style={{ width: 6, height: 6, borderRadius: 3, background: C.live }} />
        On screen
      </div>
    </div>
  )
}

/** Capture (Mac): record any output to a movie file. */
export function Capture({ t }: { t: number }): React.ReactElement {
  const rec = t > 1.6
  const secs = Math.max(0, Math.floor((t - 1.6) * 1)) + 1834
  const clock = `${String(Math.floor(secs / 3600)).padStart(2, '0')}:${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
  const press = spring(t, 1.5, SNAPPY)
  return (
    <div style={{ display: 'flex', gap: 24, padding: 28, fontFamily: ui }}>
      <div style={{ flex: 1 }}>
        <div style={label}>SOURCE</div>
        <div style={{ marginTop: 8, height: 38, borderRadius: 8, background: C.elevated, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', fontSize: 14, color: C.text }}>
          <Television size={15} weight="fill" color={C.cyan} />
          <span style={{ flex: 1 }}>Main Screen</span>
          <CaretDown size={12} color={C.fg400} />
        </div>
        <div style={{ ...label, marginTop: 20 }}>FILE</div>
        <div style={{ marginTop: 8, fontSize: 15, color: C.fg300 }}>Sunday 10.30.mov</div>
        <div style={{ marginTop: 4, fontSize: 13, color: C.fg500 }}>1920 × 1080 · H.264</div>
        <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 54, height: 54, borderRadius: 27, background: rec ? C.liveBtn : C.elevated, display: 'grid', placeItems: 'center', transform: `scale(${1 - (press - spring(t, 1.6, SNAPPY)) * 0.06})` }}>
            <Record size={26} weight="fill" color={C.live} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: rec ? C.live : C.fg400 }}>{rec ? 'Recording' : 'Ready'}</div>
            <div style={{ fontFamily: mono, fontSize: 18, color: C.text }}>{rec ? clock : '00:00:00'}</div>
          </div>
        </div>
      </div>
      <div style={{ width: 360 }}>
        <div style={label}>MAIN SCREEN</div>
        <div style={{ marginTop: 8, borderRadius: 6, overflow: 'hidden', border: `2px solid ${rec ? C.live : 'transparent'}` }}>
          <Slide reference="John 4:14" width={356} />
        </div>
      </div>
    </div>
  )
}

/** The send: a card, the press, the border, on screen. */
export function SendCard({ t }: { t: number }): React.ReactElement {
  const arrive = spring(t, 0.4, { k: 60, d: 15 })
  const pressAt = 1.9
  const press = spring(t, pressAt, SNAPPY) - spring(t, pressAt + 0.1, SNAPPY)
  const border = io(seg(t, pressAt + 0.08, pressAt + 0.62))
  const live = spring(t, pressAt + 0.28, SOFT)
  const x = 660
  const y = 330
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div style={{ position: 'absolute', left: x, top: y }}>
        <VerseCard reference="John 4:14" width={600} border={border} live={live} press={press} />
      </div>
      <svg width={28} height={34} viewBox="0 0 28 34" style={{ position: 'absolute', left: lerp(1600, x + 330, arrive), top: lerp(1000, y + 250, arrive), transform: `scale(${1.6 * (1 - press * 0.12)})`, transformOrigin: '4px 3px', overflow: 'visible', opacity: clamp01(t * 4) }}>
        <path d="M4 3 L4 26 L10 20.5 L14.5 30.5 L18.5 28.8 L14.2 19 L22 19 Z" fill="#fff" stroke="#000" strokeWidth={1.4} strokeLinejoin="round" />
      </svg>
    </div>
  )
}
