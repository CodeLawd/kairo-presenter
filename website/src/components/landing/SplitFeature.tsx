import type { ReactNode } from 'react'
import { Kicker } from './Kicker'
import { Reveal } from './Reveal'
import { cx, display, feature, wrap } from './primitives'

/**
 * A text feature laid out like an editorial spread: a full-width headline with
 * a standfirst, a giant ghosted index numeral behind it for depth, and the
 * points as a two-column ledger of hairline rows.
 *
 * Screenshots used to sit beside the copy; they read poorly, so the sections
 * are text-only and lean on typography instead.
 */
export function SplitFeature({
  n,
  label,
  title,
  lede: ledeText,
  bullets,
}: {
  n: string
  label: string
  title: ReactNode
  lede: ReactNode
  bullets?: { lead: string; rest: string }[]
}): React.ReactElement {
  return (
    <section className={cx(feature, wrap, 'relative overflow-hidden')}>
      <Reveal>
        {/* Oversized index numeral, barely there — a page mark, not a label. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-6 right-0 select-none font-display text-[clamp(140px,22vw,320px)] font-extrabold leading-none tracking-[-0.05em] text-paper/[0.035]"
        >
          {n}
        </span>

        <div className="relative">
          <Kicker n={n} label={label} />
          <div className="mt-[22px] grid items-end gap-x-[clamp(32px,5vw,80px)] gap-y-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <h2 className={cx(display, 'max-w-[16ch] text-[clamp(34px,4.6vw,60px)]')}>{title}</h2>
            <p className="m-0 max-w-[48ch] text-[clamp(16px,1.5vw,19px)] leading-[1.6] text-dim lg:pb-2">
              {ledeText}
            </p>
          </div>

          {bullets ? (
            <dl className="mt-[clamp(40px,5vw,68px)] grid gap-x-[clamp(32px,5vw,80px)] gap-y-0 sm:grid-cols-2">
              {bullets.map((b) => (
                <div
                  key={b.lead}
                  className="border-t border-line py-5 transition-colors duration-200 hover:border-accent/40"
                >
                  <dt className="font-display text-[15.5px] font-bold tracking-[-0.015em] text-paper">
                    <span className="mr-2.5 text-accent">—</span>
                    {b.lead}
                  </dt>
                  <dd className="m-0 mt-1.5 pl-[1.75rem] text-[14.5px] leading-[1.6] text-mute">
                    {b.rest}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </Reveal>
    </section>
  )
}
