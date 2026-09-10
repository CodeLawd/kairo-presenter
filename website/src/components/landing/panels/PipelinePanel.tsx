import { Frame } from './Frame'
import { cx } from '../primitives'

const ROWS = [
  { k: 'ProPresenter', v: 'Connected' },
  { k: 'Transcription', v: 'Running' },
  { k: 'Detection', v: 'Running' },
  { k: 'NDI output', v: '1080p · transparent' },
]

/** "Nothing goes out without you": every leg of the chain, and its state. */
export function PipelinePanel({ live }: { live: boolean }): React.ReactElement {
  return (
    <Frame label="Pipeline">
      <ul className="m-0 grid list-none gap-2 pl-0">
        {ROWS.map((row, i) => (
          <li
            key={row.k}
            className={cx(
              'flex items-center justify-between gap-4 rounded-lg border border-line-soft px-4 py-3',
              'transition-opacity duration-500 motion-reduce:transition-none',
              live ? 'opacity-100' : 'opacity-0',
            )}
            style={{ transitionDelay: `${i * 120}ms` }}
          >
            <span className="flex items-center gap-2.5 text-[13.5px] text-dim">
              <i
                aria-hidden="true"
                className={cx(
                  'block h-[6px] w-[6px] flex-none rounded-full bg-accent',
                  live && 'animate-pulse-dot motion-reduce:animate-none',
                )}
                style={{ animationDelay: `${i * 240}ms` }}
              />
              {row.k}
            </span>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint">
              {row.v}
            </span>
          </li>
        ))}
      </ul>
    </Frame>
  )
}
