import { Frame } from './Frame'
import { cx } from '../primitives'

const LINES = [
  'and Paul writes to the church at Ephesus',
  'that we would be strengthened with power',
  'through his Spirit in the inner being',
]

/** Stage one: audio arriving and turning into text. */
export function TranscriptPanel({ live }: { live: boolean }): React.ReactElement {
  return (
    <Frame label="Transcript">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
          <i
            aria-hidden="true"
            className={cx(
              'block h-[6px] w-[6px] rounded-full bg-accent',
              live && 'animate-pulse-dot motion-reduce:animate-none',
            )}
          />
          Live
        </span>

        {/* Input meter. Heights and delays are staggered so the bars read as a
            signal rather than a row of identical bouncing sticks. */}
        <span className="flex flex-1 items-end gap-[3px]" aria-hidden="true">
          {[9, 15, 22, 12, 26, 17, 11, 20, 14, 8].map((h, i) => (
            <i
              key={i}
              className={cx(
                'block w-[3px] origin-bottom rounded-full bg-accent-dim/70',
                live && 'animate-bounce-bar motion-reduce:animate-none',
              )}
              style={{ height: `${h}px`, animationDelay: `${i * 90}ms` }}
            />
          ))}
        </span>

        <span className="font-mono text-[10px] text-faint">0:42</span>
      </div>

      <p className="m-0 mt-4 space-y-1 text-[13.5px] leading-[1.75] text-dim">
        {LINES.map((line, i) => (
          <span
            key={line}
            className={cx(
              'block transition-opacity duration-500 motion-reduce:transition-none',
              live ? 'opacity-100' : 'opacity-0',
            )}
            style={{ transitionDelay: `${i * 220}ms` }}
          >
            {line}
            {i === LINES.length - 1 ? (
              <i
                aria-hidden="true"
                className={cx(
                  'ml-1 inline-block h-[1.05em] w-[2px] translate-y-[0.2em] bg-accent',
                  live && 'animate-caret motion-reduce:animate-none',
                )}
              />
            ) : null}
          </span>
        ))}
      </p>
    </Frame>
  )
}
