import Link from 'next/link'
import { IconArrow } from './icons'
import { Reveal } from './Reveal'
import { btn, btnGhost, btnPrimary, cx, display, lede, section, thin, wrap } from './primitives'

/**
 * The close. This used to be a three-card platform grid with three separate
 * CTAs and two more buttons under it — a lot of structure to say "macOS,
 * Windows, and it talks to ProPresenter." That is one line now.
 */
export function GetKairo(): React.ReactElement {
  return (
    <section id="get" className="relative overflow-hidden">
      <div
        className="field-soft pointer-events-none absolute inset-x-[-10%] bottom-[-10%] z-0 h-[620px]"
        aria-hidden="true"
      />
      <div className={cx(section, wrap, 'relative z-10 text-center')}>
        <Reveal>
          <h2 className={cx(display, 'mx-auto max-w-[16ch] text-[clamp(32px,4.2vw,54px)]')}>
            <span className={thin}>Bring Kairo to your team</span>{' '}
            <span className="whitespace-nowrap">this Sunday</span>
          </h2>
          <p className={cx(lede, 'mx-auto mt-5')}>
            Kairo is free while it is in early access. Create an account and we will send you a
            build.
          </p>

          <div className="mt-[30px] flex flex-wrap items-center justify-center gap-3">
            <Link className={cx(btn, btnPrimary)} href="/signup">
              Create an account <IconArrow />
            </Link>
            <Link className={cx(btn, btnGhost)} href="/login">
              Sign in
            </Link>
          </div>

          <p className="mx-auto mt-[22px] max-w-[62ch] font-mono text-[11px] leading-[1.7] text-faint">
            macOS (Apple silicon and Intel) and Windows 10 and 11. Needs an audio input, and either
            ProPresenter 7 or an NDI switcher.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
