import { PRIVACY } from './content'
import { ICONS } from './icons'
import { Reveal } from './Reveal'
import { card, cx, display, iconTile, lede, section, wrap } from './primitives'

/**
 * Three plain claims. The mechanics behind them — AES-256-GCM, the OS keychain,
 * which Electron process holds a key — are true and worth publishing, but they
 * are the wrong altitude for a landing page, so they belong on a security page
 * rather than here.
 */
export function Privacy(): React.ReactElement {
  return (
    <section id="privacy" className={cx(section, wrap)}>
      <div
        aria-hidden="true"
        className="arc pointer-events-none absolute left-1/2 top-0 z-0 aspect-[2.6/1] w-[160%] max-w-[1900px] -translate-x-1/2"
      />
      <Reveal>
        <h2 className={cx(display, 'max-w-[18ch] text-[clamp(30px,3.7vw,48px)]')}>
          Your service stays on your machine
        </h2>
        <p className={cx(lede, 'mt-5')}>
          Kairo is a desktop app, not a service you upload your Sunday to.
        </p>

        <div className="mt-[clamp(32px,4vw,52px)] grid gap-4 min-[860px]:grid-cols-3">
          {PRIVACY.map((item) => {
            const Icon = ICONS[item.icon]
            return (
              <div key={item.title} className={card}>
                <div className={iconTile}>
                  <Icon />
                </div>
                <h3 className="mb-2 mt-4 font-display text-[17px] font-bold tracking-[-0.025em]">
                  {item.title}
                </h3>
                <p className="m-0 text-[14.5px] leading-[1.6] text-mute">{item.body}</p>
              </div>
            )
          })}
        </div>
      </Reveal>
    </section>
  )
}
