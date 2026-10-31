import { HEAVY, spring } from './motion'

/**
 * Masked word rise: each word slides up out of its own clip, 55 ms apart,
 * with a small rotation that settles. `exit` (0→1) lifts the words away the
 * same way, in the same order.
 */
export function Words({
  text,
  t,
  start,
  stagger = 0.055,
  exitAt,
  style,
  wordStyle,
}: {
  text: string
  /** Scene time, seconds. */
  t: number
  start: number
  stagger?: number
  exitAt?: number
  style?: React.CSSProperties
  /** Per-word style, e.g. to colour a key phrase. */
  wordStyle?: (word: string, index: number) => React.CSSProperties | undefined
}): React.ReactElement {
  const words = text.split(' ')
  return (
    <span style={{ display: 'inline', ...style }}>
      {words.map((w, i) => {
        const p = spring(t, start + i * stagger, HEAVY)
        const e = exitAt === undefined ? 0 : spring(t, exitAt + i * stagger * 0.6, HEAVY)
        const y = (1 - p) * 105 - e * 135
        const r = (1 - p) * 4 - e * 3
        return (
          <span key={i} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.12em', marginBottom: '-0.12em' }}>
            <span style={{ display: 'inline-block', transform: `translateY(${y}%) rotate(${r}deg)`, transformOrigin: '0 100%', ...wordStyle?.(w, i) }}>
              {w}
              {i < words.length - 1 ? ' ' : ''}
            </span>
          </span>
        )
      })}
    </span>
  )
}

/** How long a Words line takes to fully arrive. */
export const wordsDuration = (text: string, stagger = 0.055): number => text.split(' ').length * stagger + 0.6
