import { LOCKUP_VIEWBOX, MARK_TILES, WORDMARK } from './lockup-paths'

/**
 * The Kairo lockup, animated for the startup screen, in four beats:
 *
 * 1. Assemble — the mark starts alone in the centre; its four tiles fly in from
 *    their own corners, spun and shrunk, landing clockwise with an overshoot.
 * 2. Make room — the mark glides left to its place in the lockup while
 *    "Kairo" rises in letter by letter, out of a blur.
 * 3. Dot — the i's dot drops last and bounces into place.
 * 4. Alive while loading — a ripple runs clockwise round the tiles (each
 *    presses in, then springs back lit a lighter brand blue), the tiles
 *    breathe apart and back, and a light sheen sweeps across the whole lockup.
 *    The mark never leaves the brand colour.
 *
 * prefers-reduced-motion shows the plain lockup.
 */

// Timeline, ms.
const TILE_IN = 700
const TILE_STAGGER = 110
const SLIDE_AT = 850
const SLIDE_MS = 700
const LETTER_AT = 1200
const LETTER_STAGGER = 85
const DOT_AT = 1650
const LOOP_AT = 2100
const WAVE_MS = 2400
const SHEEN_MS = 3600

/**
 * When the intro has played out — the dot has landed. The splash waits for the
 * real animationend (onIntroDone); this is the fallback's yardstick.
 */
export const LOCKUP_INTRO_MS = DOT_AT + 900

// The mark sits at x 0–364; centred alone, it is shifted to the lockup's middle.
const CENTRE_SHIFT = LOCKUP_VIEWBOX.w / 2 - 182

const CSS = `
.klock { overflow: visible; }
.klock-mark {
  animation: klock-slide ${SLIDE_MS}ms cubic-bezier(0.65, 0, 0.35, 1) ${SLIDE_AT}ms both;
}
@keyframes klock-slide {
  from { translate: ${CENTRE_SHIFT}px 0; }
  to   { translate: 0 0; }
}
.klock-tile, .klock-glow {
  transform-box: fill-box;
  transform-origin: center;
}
.klock-tile {
  fill: rgb(var(--accent-500));
  animation:
    klock-tile-in ${TILE_IN}ms cubic-bezier(0.34, 1.56, 0.64, 1) var(--in-delay) both,
    klock-wave ${WAVE_MS}ms ease-in-out var(--wave-delay) infinite,
    klock-breathe ${WAVE_MS * 2}ms ease-in-out ${LOOP_AT}ms infinite;
}
.klock-glow {
  fill: rgb(var(--accent-400));
  opacity: 0;
  filter: blur(36px);
  animation:
    klock-glow ${WAVE_MS}ms ease-in-out var(--wave-delay) infinite,
    klock-breathe ${WAVE_MS * 2}ms ease-in-out ${LOOP_AT}ms infinite;
}
@keyframes klock-tile-in {
  0%   { opacity: 0; translate: calc(var(--dx) * 520px) calc(var(--dy) * 520px); rotate: calc(var(--dx) * var(--dy) * 90deg); scale: 0.3; }
  60%  { opacity: 1; }
  100% { opacity: 1; translate: 0 0; rotate: 0deg; scale: 1; }
}
/* Press in, spring back past rest, settle — lit a lighter blue at the top. */
@keyframes klock-wave {
  0%, 34%, 100% { fill: rgb(var(--accent-500)); scale: 1; rotate: 0deg; }
  6%            { fill: rgb(var(--accent-500)); scale: 0.88; rotate: calc(var(--dx) * var(--dy) * -4deg); }
  15%           { fill: rgb(var(--accent-300)); scale: 1.05; rotate: calc(var(--dx) * var(--dy) * 2deg); }
}
@keyframes klock-glow {
  0%, 6%, 34%, 100% { opacity: 0; }
  15%               { opacity: 0.45; }
}
@keyframes klock-breathe {
  0%, 100% { translate: 0 0; }
  50%      { translate: calc(var(--dx) * 10px) calc(var(--dy) * 10px); }
}
.klock-letter {
  fill: currentColor;
  transform-box: fill-box;
  transform-origin: 50% 100%;
  animation: klock-letter-in 650ms cubic-bezier(0.16, 1, 0.3, 1) var(--in-delay) both;
}
@keyframes klock-letter-in {
  from { opacity: 0; translate: 0 140px; scale: 0.85; filter: blur(24px); }
  to   { opacity: 1; translate: 0 0; scale: 1; filter: blur(0); }
}
.klock-dot {
  fill: rgb(var(--accent-500));
  transform-box: fill-box;
  transform-origin: 50% 100%;
  animation:
    klock-dot-in 900ms linear ${DOT_AT}ms both,
    klock-dot-settle 1200ms ease-out ${DOT_AT + 900}ms both;
}
/* A drop with two shrinking bounces, squashing on each landing. */
@keyframes klock-dot-in {
  0%   { opacity: 0; translate: 0 -420px; scale: 1; animation-timing-function: cubic-bezier(0.55, 0, 1, 0.45); }
  10%  { opacity: 1; }
  45%  { translate: 0 0; scale: 1.25 0.7; animation-timing-function: cubic-bezier(0, 0.55, 0.45, 1); }
  65%  { translate: 0 -110px; scale: 0.92 1.1; animation-timing-function: cubic-bezier(0.55, 0, 1, 0.45); }
  82%  { translate: 0 0; scale: 1.12 0.85; animation-timing-function: cubic-bezier(0, 0.55, 0.45, 1); }
  91%  { translate: 0 -30px; scale: 1; animation-timing-function: cubic-bezier(0.55, 0, 1, 0.45); }
  100% { opacity: 1; translate: 0 0; scale: 1; }
}
/* Lands in the accent, then cools to the wordmark colour. */
@keyframes klock-dot-settle {
  from { fill: rgb(var(--accent-500)); }
  to   { fill: currentColor; }
}
.klock-sheen {
  translate: -700px 0;
  animation: klock-sheen ${SHEEN_MS}ms ease-in-out ${LOOP_AT + 300}ms infinite;
}
@keyframes klock-sheen {
  0%        { translate: -700px 0; }
  45%, 100% { translate: ${LOCKUP_VIEWBOX.w + 200}px 0; }
}
.klock-still .klock-mark, .klock-still .klock-tile, .klock-still .klock-glow,
.klock-still .klock-letter, .klock-still .klock-dot, .klock-still .klock-sheen { animation: none; }
.klock-still .klock-dot { fill: currentColor; }
.klock-still .klock-glow, .klock-still .klock-sheen { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .klock-mark, .klock-tile, .klock-glow, .klock-letter, .klock-dot, .klock-sheen { animation: none; }
  .klock-dot { fill: currentColor; }
  .klock-glow, .klock-sheen { opacity: 0; }
}
`

const LETTERS = [
  { id: 'k', d: WORDMARK.k },
  { id: 'a', d: WORDMARK.a },
  { id: 'i', rect: WORDMARK.iStem },
  { id: 'r', d: WORDMARK.r },
  { id: 'o', d: WORDMARK.o },
] as const

/**
 * `still` draws the finished lockup with no motion — for the copy of the
 * splash that fades out over the app, which is a fresh mount and would
 * otherwise replay the intro as it fades.
 */
export function AnimatedMark({
  width = 300,
  label,
  still = false,
  onIntroDone,
}: {
  width?: number
  label: string
  still?: boolean
  /** Fires when the dot has landed — the intro's last beat. */
  onIntroDone?: () => void
}): React.ReactElement {
  const { w, h } = LOCKUP_VIEWBOX
  const letterNodes = LETTERS.map((l, i) => {
    const style = { '--in-delay': `${LETTER_AT + i * LETTER_STAGGER}ms` } as React.CSSProperties
    return 'rect' in l
      ? <rect key={l.id} className="klock-letter" style={style} {...l.rect} />
      : <path key={l.id} className="klock-letter" style={style} d={l.d} />
  })

  return (
    <>
      <style>{CSS}</style>
      <svg
        className={`klock text-zinc-100${still ? ' klock-still' : ''}`}
        width={width}
        height={(width * h) / w}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={label}
        onAnimationEnd={(e) => { if (e.animationName === 'klock-dot-in') onIntroDone?.() }}
      >
        <defs>
          <linearGradient id="klock-sheen-gradient" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="white" stopOpacity="0" />
            <stop offset="0.5" stopColor="white" stopOpacity="0.55" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <mask id="klock-word-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={w} height={h}>
            <g fill="white">
              {MARK_TILES.map((t) => <path key={t.id} d={t.d} />)}
              <path d={WORDMARK.k} />
              <path d={WORDMARK.a} />
              <rect {...WORDMARK.iStem} />
              <path d={WORDMARK.iDot} />
              <path d={WORDMARK.r} />
              <path d={WORDMARK.o} />
            </g>
          </mask>
        </defs>

        <g className="klock-mark">
          {MARK_TILES.map((t, i) => {
            const vars = {
              '--dx': t.dx,
              '--dy': t.dy,
              '--in-delay': `${i * TILE_STAGGER}ms`,
              '--wave-delay': `${LOOP_AT + (i * WAVE_MS) / 4}ms`,
            } as React.CSSProperties
            return (
              <g key={t.id} style={vars}>
                <path className="klock-glow" d={t.d} />
                <path className="klock-tile" d={t.d} />
              </g>
            )
          })}
        </g>

        <g>
          {letterNodes}
          <path className="klock-dot" d={WORDMARK.iDot} />
        </g>

        {/* One sheen across mark and word together. */}
        <g mask="url(#klock-word-mask)" aria-hidden="true">
          <rect className="klock-sheen" x="0" y="0" width="500" height={h} fill="url(#klock-sheen-gradient)" transform="skewX(-18)" />
        </g>
      </svg>
    </>
  )
}
