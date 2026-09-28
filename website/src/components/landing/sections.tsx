import { MORE } from './content'
import { Reveal } from './Reveal'
import { card, cx, display, section, wrap } from './primitives'

/** Everything else, one line each, instead of six more full sections. */
export function MoreFeatures(): React.ReactElement {
  return (
    <section className={cx(section, wrap)}>
      <Reveal>
        <h2 className={cx(display, 'max-w-[18ch] text-[clamp(30px,3.7vw,48px)]')}>
          Everything else your team needs
        </h2>
        <div className="mt-[clamp(32px,4vw,52px)] grid gap-4 min-[720px]:grid-cols-2 min-[1080px]:grid-cols-3">
          {MORE.map((item) => (
            <div key={item.title} className={card}>
              <h3 className="m-0 font-display text-[17px] font-bold tracking-[-0.025em]">
                {item.title}
              </h3>
              <p className="m-0 mt-2 text-[14.5px] leading-[1.6] text-mute">{item.body}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  )
}
