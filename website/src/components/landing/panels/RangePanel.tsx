import { Frame } from './Frame'
import { cx } from '../primitives'

const SLIDES = ['Ephesians 3:14', '3:15', '3:16', '3:17', '3:18', '3:19']

/** "Catch verses nobody announced": a range arriving as ordered slides. */
export function RangePanel({ live }: { live: boolean }): React.ReactElement {
  return (
    <Frame label="Detected">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-display text-[15px] font-bold tracking-[-0.02em] text-paper">
          Ephesians 3:14&ndash;19
        </span>
        <span className="font-mono text-[11px] text-accent">6 slides</span>
      </div>

      <ul className="m-0 mt-4 grid list-none grid-cols-3 gap-2 pl-0">
        {SLIDES.map((ref, i) => (
          <li
            key={ref}
            className={cx(
              'rounded-md border px-3 py-4 text-center text-[11.5px]',
              'transition-all duration-500 motion-reduce:transition-none',
              i === 0 ? 'border-accent/35 bg-accent/[0.07] text-paper' : 'border-line-soft text-mute',
              live ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
            )}
            style={{ transitionDelay: `${i * 90}ms` }}
          >
            {ref}
          </li>
        ))}
      </ul>

      <p className="m-0 mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
        In order &middot; not one wall of text
      </p>
    </Frame>
  )
}
