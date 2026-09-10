import { Bullets } from './Bullets'
import { Reveal } from './Reveal'
import { cx, display, feature, wrap } from './primitives'

/**
 * A feature block: a headline sat beside its standfirst, with the points below.
 *
 * There was a mono eyebrow above the headline — LISTENING, DETECTION — and a
 * giant ghosted index numeral behind it. Neither reference site labels its
 * feature sections, the headline already says what the block is about, and two
 * eyebrow systems were running within one screen of each other.
 */
export function SplitFeature({
  title,
  lede: ledeText,
  bullets,
  children,
}: {
  title: string
  lede: string
  bullets: string[]
  /** The stage schematic, shown under the points in the stacked fallback. */
  children?: React.ReactNode
}): React.ReactElement {
  return (
    <section className={cx(feature, wrap)}>
      <Reveal>
        <div className="grid items-end gap-x-[clamp(32px,5vw,80px)] gap-y-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <h2 className={cx(display, 'max-w-[16ch] text-[clamp(32px,4.2vw,54px)]')}>{title}</h2>
          <p className="m-0 max-w-[46ch] text-[clamp(16px,1.5vw,18px)] leading-[1.6] text-dim lg:pb-2">
            {ledeText}
          </p>
        </div>
        <div className="mt-[clamp(30px,3.6vw,46px)]">
          <Bullets items={bullets} />
        </div>
        {children ? <div className="mt-[clamp(30px,3.6vw,46px)] max-w-[440px]">{children}</div> : null}
      </Reveal>
    </section>
  )
}
