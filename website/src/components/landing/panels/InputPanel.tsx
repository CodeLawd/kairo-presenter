import { Frame } from './Frame'
import { cx } from '../primitives'

const ROWS = [
  { k: 'Source', v: 'Sound desk · USB' },
  { k: 'Engine', v: 'Deepgram · cloud' },
]

/** "Hear every word": where the audio comes from, and what is transcribing it. */
export function InputPanel({ live }: { live: boolean }): React.ReactElement {
  return (
    <Frame label="Audio input">
      <dl className="m-0 grid gap-2">
        {ROWS.map((row) => (
          <div
            key={row.k}
            className="flex items-baseline justify-between gap-4 rounded-lg border border-line-soft px-4 py-3"
          >
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              {row.k}
            </dt>
            <dd className="m-0 text-[13.5px] text-dim">{row.v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex items-center gap-3 rounded-lg border border-line-soft px-4 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Level</span>
        <span className="flex flex-1 items-end justify-end gap-[3px]" aria-hidden="true">
          {[10, 18, 24, 14, 28, 19, 12, 22, 16, 9, 20, 13].map((h, i) => (
            <i
              key={i}
              className={cx(
                'block w-[3px] origin-bottom rounded-full bg-accent-dim/70',
                live && 'animate-bounce-bar motion-reduce:animate-none',
              )}
              style={{ height: `${h}px`, animationDelay: `${i * 80}ms` }}
            />
          ))}
        </span>
      </div>
    </Frame>
  )
}
