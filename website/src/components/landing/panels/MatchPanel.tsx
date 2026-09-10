import { Frame } from './Frame'
import { cx } from '../primitives'

/** Stage two: the passage recognised, with how sure it is. */
export function MatchPanel({ live }: { live: boolean }): React.ReactElement {
  return (
    <Frame label="Detected">
      <div className="rounded-lg border border-line-soft bg-inset/60 p-4">
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-display text-[16px] font-bold tracking-[-0.02em] text-paper">
            Ephesians 3:16
          </span>
          <span className="font-mono text-[11px] text-accent">94%</span>
        </div>

        {/* Confidence. Width is a transition rather than a timer, so it fills
            when the stage becomes live and needs no JavaScript of its own. */}
        <span
          aria-hidden="true"
          className="mt-3 block h-[3px] overflow-hidden rounded-full bg-line"
        >
          <i
            className={cx(
              'block h-full rounded-full bg-accent transition-[width] duration-700 ease-out',
              'motion-reduce:transition-none',
              live ? 'w-[94%]' : 'w-0',
            )}
          />
        </span>

        <p className="m-0 mt-4 text-[13.5px] leading-[1.6] text-mute">
          &ldquo;strengthened with power through his Spirit&rdquo;
        </p>
      </div>

      <p className="m-0 mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
        Matched on meaning &middot; no reference spoken
      </p>
    </Frame>
  )
}
