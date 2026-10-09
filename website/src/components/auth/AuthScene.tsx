'use client'

import { Fragment, useEffect, useRef, useState } from 'react'

/**
 * The picture on the right of every auth page: the whole product, running.
 *
 * A sermon line is heard word by word, Kairo matches it to a passage, and the
 * verse goes up on the projection screen — then the next one. The screen holds
 * the previous verse while the next is heard, as it would in a real service.
 *
 * KJV throughout because it is public domain — a modern translation would be a
 * licensing question for a marketing illustration. The heard lines are
 * paraphrases with no reference spoken; that is the point being made.
 */
const MOMENTS = [
  {
    ref: 'Ephesians 3:16',
    heard: 'that God would strengthen you with power, through his Spirit, deep inside',
    verse:
      'That he would grant you, according to the riches of his glory, to be strengthened with might by his Spirit in the inner man.',
    confidence: 94,
  },
  {
    ref: 'Isaiah 40:31',
    heard: 'if you wait on the Lord, he renews your strength — you’ll rise up like an eagle',
    verse:
      'But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles.',
    confidence: 91,
  },
  {
    ref: 'Philippians 4:13',
    heard: 'there is nothing you can’t face when Christ is the one giving you strength',
    verse: 'I can do all things through Christ which strengtheneth me.',
    confidence: 88,
  },
  {
    ref: 'Psalm 46:10',
    heard: 'sometimes the word for this week is simply: be still, and know he is God',
    verse: 'Be still, and know that I am God: I will be exalted among the heathen.',
    confidence: 97,
  },
] as const

type Phase = 'hearing' | 'matched' | 'live'

const WORD_MS = 120
const MATCH_DELAY_MS = 450
const SEND_DELAY_MS = 1700
const HOLD_MS = 3800

const STEPS: { phase: Phase; label: string }[] = [
  { phase: 'hearing', label: 'Heard' },
  { phase: 'matched', label: 'Matched' },
  { phase: 'live', label: 'On screen' },
]

/** Counts up to `to` once on mount — the confidence settling as it is scored. */
function Count({ to }: { to: number }): React.ReactElement {
  const [value, setValue] = useState(0)
  useEffect(() => {
    let frame = 0
    const start = performance.now()
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / 700)
      setValue(Math.round(to * (1 - Math.pow(1 - t, 3))))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [to])
  return <>{value}%</>
}

export function AuthScene(): React.ReactElement {
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('hearing')
  const [words, setWords] = useState(0)
  /** What is on the projection screen — lags `index` until the send. */
  const [onScreen, setOnScreen] = useState<number | null>(null)
  /** Bumped on every send so the outline flare replays. */
  const [sends, setSends] = useState(0)
  const [still, setStill] = useState(false)
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const sceneRef = useRef<HTMLDivElement>(null)

  const moment = MOMENTS[index]
  const heardWords = moment.heard.split(' ')

  // Reduced motion: show one finished moment and stop.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStill(true)
      setWords(MOMENTS[0].heard.split(' ').length)
      setPhase('live')
      setOnScreen(0)
    }
  }, [])

  // The timeline. One timer at a time, keyed on where we are in it.
  useEffect(() => {
    if (still) return
    let timer: ReturnType<typeof setTimeout>
    if (phase === 'hearing') {
      timer =
        words < heardWords.length
          ? setTimeout(() => setWords((w) => w + 1), WORD_MS)
          : setTimeout(() => setPhase('matched'), MATCH_DELAY_MS)
    } else if (phase === 'matched') {
      timer = setTimeout(() => send(), SEND_DELAY_MS)
    } else {
      timer = setTimeout(() => {
        setIndex((i) => (i + 1) % MOMENTS.length)
        setWords(0)
        setPhase('hearing')
      }, HOLD_MS)
    }
    return () => clearTimeout(timer)
    // `send` only reads `index`, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, words, index, still, heardWords.length])

  function send(): void {
    setOnScreen(index)
    setSends((n) => n + 1)
    setPhase('live')
  }

  // Depth on hover: each layer drifts by a different amount, so the stack
  // reads as three surfaces rather than one picture.
  const onPointerMove = (event: React.PointerEvent): void => {
    if (still || event.pointerType !== 'mouse') return
    const box = sceneRef.current?.getBoundingClientRect()
    if (!box) return
    setTilt({
      x: (event.clientX - box.left) / box.width - 0.5,
      y: (event.clientY - box.top) / box.height - 0.5,
    })
  }
  const drift = (depth: number): React.CSSProperties => ({
    transform: `translate3d(${tilt.x * depth}px, ${tilt.y * depth}px, 0)`,
  })

  const shown = onScreen === null ? null : MOMENTS[onScreen]
  const stepAt = STEPS.findIndex((s) => s.phase === phase)

  return (
    <div
      ref={sceneRef}
      className="relative mx-auto w-full max-w-[540px] select-none"
      aria-hidden="true"
      onPointerMove={onPointerMove}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
    >
      <div className="relative pb-14 pt-6 [perspective:1400px]">
        {/* The projection screen. Outlined in the live colour, as the app
            outlines whatever is on screen. */}
        <div
          className="animate-scene-rise transition-transform duration-500 ease-out"
          style={{
            ...drift(10),
            transform: `${drift(10).transform} rotateX(${-tilt.y * 4}deg) rotateY(${tilt.x * 5}deg)`,
          }}
        >
          <div className="relative grid aspect-video place-items-center overflow-hidden rounded-xl border border-accent/40 bg-ink px-[9%]">
            {shown ? (
              <div key={onScreen} className="animate-verse-in text-center">
                <p
                  className={`m-0 font-display font-medium leading-[1.45] tracking-[-0.01em] text-paper ${
                    shown.verse.length > 110 ? 'text-[clamp(14px,1.35vw,19px)]' : 'text-[clamp(16px,1.6vw,23px)]'
                  }`}
                >
                  {shown.verse}
                </p>
                <p className="m-0 mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-mute">
                  {shown.ref} · KJV
                </p>
              </div>
            ) : (
              <p className="m-0 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
                <i className="block h-[5px] w-[5px] rounded-full bg-faint animate-pulse-dot" />
                Waiting for the next verse
              </p>
            )}

            {/* Flares on every send, then settles back to the resting outline. */}
            {sends > 0 ? (
              <i
                key={sends}
                className="pointer-events-none absolute inset-0 rounded-xl border-2 border-accent bg-accent/[0.06] animate-live-flash"
              />
            ) : null}
          </div>
        </div>

        {/* The match. Appears once Kairo is sure enough to offer it. */}
        <div className="absolute right-[-4%] top-0 transition-transform duration-500 ease-out" style={drift(22)}>
          {phase !== 'hearing' ? (
            <div
              key={`chip-${index}`}
              className="flex items-center gap-3 rounded-full border border-line bg-panel-2 py-1.5 pl-3 pr-1.5 animate-chip-in"
            >
              <i className="block h-[6px] w-[6px] rounded-full bg-accent" />
              <span className="text-[12.5px] font-medium text-paper">{moment.ref}</span>
              <span className="w-[30px] font-mono text-[11px] text-accent">
                {still ? `${moment.confidence}%` : <Count to={moment.confidence} />}
              </span>
              {phase === 'matched' ? (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={send}
                  className="cursor-pointer rounded-full bg-accent px-3 py-1 font-display text-[11px] font-semibold text-ink transition hover:scale-105 hover:bg-paper active:scale-95"
                >
                  Send
                </button>
              ) : (
                <span className="px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                  Sent
                </span>
              )}
            </div>
          ) : null}
        </div>

        {/* What was actually said, arriving as it is spoken. */}
        <div
          className="absolute bottom-0 left-[-5%] w-[68%] transition-transform duration-500 ease-out"
          style={drift(28)}
        >
          <div className="animate-scene-rise rounded-xl border border-line bg-panel-2 px-4 py-3.5 transition-colors duration-300 hover:border-paper/15 [animation-delay:150ms]">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">Heard</span>
              <span className="flex h-[13px] items-end gap-[3px]">
                {[6, 11, 8, 13, 7, 10].map((h, i) => (
                  <i
                    key={i}
                    className={`block w-[2px] origin-bottom rounded-full transition-all duration-300 ${
                      phase === 'hearing' && !still
                        ? 'bg-accent animate-bounce-bar'
                        : 'scale-y-[0.35] bg-accent-dim'
                    }`}
                    style={{ height: `${h}px`, animationDelay: `${i * 110}ms` }}
                  />
                ))}
              </span>
            </div>
            <p key={index} className="m-0 mt-2 min-h-[3.2em] text-[13px] leading-[1.6] text-dim">
              &hellip;
              {heardWords.slice(0, words).map((word, i) => (
                <Fragment key={i}>
                  <span className={still ? undefined : 'inline-block animate-word-in'}>{word}</span>{' '}
                </Fragment>
              ))}
              {phase === 'hearing' && !still ? (
                <i className="inline-block h-[1.05em] w-[2px] translate-y-[0.2em] bg-accent animate-caret" />
              ) : null}
            </p>
          </div>
        </div>
      </div>

      {/* Where the moment is: heard, matched, on screen. */}
      <ol className="m-0 mt-10 flex list-none items-center gap-3 pl-0">
        {STEPS.map((step, i) => (
          <li key={step.phase} className="flex flex-1 items-center gap-3">
            <span
              className={`font-mono text-[10px] uppercase tracking-[0.16em] transition-colors duration-300 ${
                i <= stepAt ? 'text-paper' : 'text-faint'
              }`}
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 ? (
              <span className="relative h-px flex-1 overflow-hidden bg-line">
                <i
                  className={`absolute inset-y-0 left-0 bg-accent transition-[width] duration-500 ease-out ${
                    i < stepAt ? 'w-full' : 'w-0'
                  }`}
                />
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  )
}
