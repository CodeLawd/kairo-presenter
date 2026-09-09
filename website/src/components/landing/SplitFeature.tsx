import type { ReactNode } from 'react'
import { Bullets } from './Bullets'
import { Kicker } from './Kicker'
import { Reveal } from './Reveal'
import { cx, display, feature, lede, wrap } from './primitives'

/**
 * A text feature: the heading on the left, the prose and bullets on the right.
 *
 * Screenshots used to sit beside the copy, but they read poorly on the page, so
 * the sections are text-only for now.
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
    <section className={cx(feature, wrap)}>
      <Reveal>
        <div className="grid items-start gap-[clamp(24px,4vw,72px)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div>
            <Kicker n={n} label={label} />
            <h2 className={cx(display, 'mt-[22px] max-w-[15ch] text-[clamp(30px,3.6vw,48px)]')}>
              {title}
            </h2>
          </div>
          <div>
            <p className={cx(lede, 'max-w-[52ch]')}>{ledeText}</p>
            {bullets ? <Bullets items={bullets} /> : null}
          </div>
        </div>
      </Reveal>
    </section>
  )
}
