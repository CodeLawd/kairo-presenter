import { PRIVACY } from './content'
import { ICONS } from './icons'
import { Kicker } from './Kicker'
import { Reveal } from './Reveal'
import { card, cx, display, iconTile, lede, section, thin, wrap } from './primitives'

export function Privacy(): React.ReactElement {
  return (
    <section id="privacy" className={cx(section, wrap)}>
      <div
        aria-hidden="true"
        className="arc pointer-events-none absolute left-1/2 top-0 z-0 aspect-[2.6/1] w-[160%] max-w-[1900px] -translate-x-1/2"
      />
      <Reveal>
        <Kicker n="10" label="Privacy" />
        <h2 className={cx(display, 'mt-[22px] max-w-[18ch] text-[clamp(31px,3.9vw,52px)]')}>
          <span className={thin}>Your service stays</span> on your machine.
        </h2>
        <p className={cx(lede, 'mt-5 max-w-[56ch]')}>
          Kairo is a desktop app, not a service you upload your Sunday to. Nothing about the room is
          sent off for processing or storage.
        </p>

        <div className="mt-[clamp(34px,4vw,52px)] grid gap-4 min-[860px]:grid-cols-3">
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
