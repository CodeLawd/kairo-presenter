import Link from 'next/link'
import { PLATFORMS } from './content'
import { ICONS, IconArrow } from './icons'
import { Kicker } from './Kicker'
import { Reveal } from './Reveal'
import { btn, btnGhost, btnPrimary, cx, display, lede, section, thin, wrap } from './primitives'

/**
 * The original page ended in an email capture that only ever called
 * `setSent(true)` — nothing was stored and no endpoint existed for it. Now that
 * the site carries real accounts, creating one is the actual early-access path,
 * so the CTA points at signup instead of collecting an address it cannot keep.
 */
export function GetKairo(): React.ReactElement {
  return (
    <section id="get" className={cx(section, wrap, 'text-center')}>
      <Reveal>
        <Kicker n="11" label="Get Kairo" />
        <h2 className={cx(display, 'mx-auto mt-[22px] max-w-[16ch] text-[clamp(32px,4.4vw,58px)]')}>
          <span className={thin}>Put it in the booth</span> this Sunday.
        </h2>
        <p className={cx(lede, 'mx-auto mt-5 max-w-[54ch]')}>
          Kairo is in development and going out to church tech teams first. Create an account and we
          will send a build when it is ready for your setup.
        </p>

        <div className="mt-[clamp(36px,5vw,56px)] grid gap-4 text-left min-[860px]:grid-cols-3">
          {PLATFORMS.map((p) => {
            const Icon = ICONS[p.icon]
            const className = cx(btn, btnGhost, 'w-full justify-center')
            return (
              <div
                key={p.name}
                className="flex flex-col gap-3 rounded-[13px] border border-line bg-gradient-to-b from-paper/[0.026] to-transparent p-[26px]"
              >
                <div className="flex items-center gap-2.5 [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:text-dim">
                  <Icon />
                  <h3 className="m-0 font-display text-[17px] font-bold tracking-[-0.02em]">
                    {p.name}
                  </h3>
                </div>
                <p className="m-0 flex-1 text-[13.5px] leading-[1.55] text-mute">{p.body}</p>
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
                  {p.meta}
                </span>
                {p.href.startsWith('/') ? (
                  <Link className={className} href={p.href}>
                    {p.cta}
                  </Link>
                ) : (
                  <a className={className} href={p.href}>
                    {p.cta}
                  </a>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-[34px] flex flex-wrap items-center justify-center gap-3">
          <Link className={cx(btn, btnPrimary)} href="/signup">
            Create an account <IconArrow />
          </Link>
          <Link className={cx(btn, btnGhost)} href="/login">
            Sign in
          </Link>
        </div>
        <p className="mt-4 font-mono text-[11px] text-faint">
          Build announcements only. No newsletter.
        </p>
      </Reveal>
    </section>
  )
}
