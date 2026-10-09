import { Frame } from './Frame'
import { cx } from '../primitives'

/** Stage three: what is on screen, what is next, and the operator's decision. */
export function QueuePanel({ live }: { live: boolean }): React.ReactElement {
  return (
    <Frame label="Output">
      <p className="m-0 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
        On screen
      </p>
      <div className="mt-2 rounded-lg border border-accent/30 bg-accent/[0.07] px-4 py-3">
        <span className="font-display text-[14px] font-bold tracking-[-0.02em] text-paper">
          John 3:16
        </span>
      </div>

      <p className="m-0 mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
        Staged
      </p>
      <ul className="m-0 mt-2 grid list-none gap-2 pl-0">
        {['Ephesians 3:16', 'Ephesians 3:17'].map((ref, i) => (
          <li
            key={ref}
            className={cx(
              'flex items-center justify-between gap-3 rounded-lg border border-line-soft px-4 py-3',
              'transition-opacity duration-500 motion-reduce:transition-none',
              live ? 'opacity-100' : 'opacity-0',
            )}
            style={{ transitionDelay: `${160 + i * 160}ms` }}
          >
            <span className="text-[13.5px] text-dim">{ref}</span>
            {i === 0 ? (
              <span className="rounded-full bg-accent px-3 py-1 font-display text-[11px] font-semibold text-[#11120D]">
                Send
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </Frame>
  )
}
