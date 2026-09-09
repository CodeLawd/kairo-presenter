import type { ReactNode } from 'react'
import { Bullets } from './Bullets'
import { Kicker } from './Kicker'
import { Reveal } from './Reveal'
import { cx, display, feature, lede, wrap } from './primitives'

/** Copy on one side, a screenshot on the other. `flipped` swaps the sides. */
export function SplitFeature({
  n,
  label,
  title,
  lede: ledeText,
  bullets,
  visual,
  flipped,
}: {
  n: string
  label: string
  title: ReactNode
  lede: ReactNode
  bullets?: { lead: string; rest: string }[]
  visual: ReactNode
  flipped?: boolean
}): React.ReactElement {
  return (
    <section className={cx(feature, wrap)}>
      <Reveal>
        <div
          className={cx(
            'grid items-center gap-[clamp(32px,5vw,80px)]',
            // The screenshot always takes the wider column, whichever side it sits on.
            flipped
              ? 'lg:grid-cols-[minmax(0,1.18fr)_minmax(0,0.82fr)]'
              : 'lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]',
          )}
        >
          <div className={cx(flipped && 'lg:order-2')}>
            <Kicker n={n} label={label} />
            <h2 className={cx(display, 'mt-[22px] max-w-[15ch] text-[clamp(30px,3.6vw,48px)]')}>
              {title}
            </h2>
            <p className={cx(lede, 'mt-5 max-w-[46ch]')}>{ledeText}</p>
            {bullets ? <Bullets items={bullets} /> : null}
          </div>
          <div>{visual}</div>
        </div>
      </Reveal>
    </section>
  )
}
