import { FAQ } from './content'
import { cx, display, section, wrap } from './primitives'
import { Reveal } from './Reveal'

/**
 * Native <details>, so the whole accordion works with JavaScript disabled and
 * ships no client code of its own.
 */
export function Faq(): React.ReactElement {
  return (
    <section id="faq" className={cx(section, wrap)}>
      <Reveal>
        <h2
          className={cx(display, 'mx-auto max-w-[18ch] text-center text-[clamp(30px,3.7vw,48px)]')}
        >
          Questions a tech director asks
        </h2>
        <div className="mx-auto mt-[clamp(32px,4vw,52px)] max-w-[820px] border-t border-line-soft">
          {FAQ.map((item) => (
            <details key={item.q} className="group border-b border-line-soft">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-[18px] px-0.5 py-5 font-display text-[17px] font-semibold tracking-[-0.02em] transition-colors after:flex-none after:font-mono after:text-[19px] after:font-normal after:text-mute after:transition-transform after:duration-200 after:content-['+'] hover:text-accent group-open:after:rotate-45 group-open:after:text-accent [&::-webkit-details-marker]:hidden">
                {item.q}
              </summary>
              <p className="m-0 max-w-[68ch] px-0.5 pb-[22px] text-[15px] leading-[1.68] text-mute">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </Reveal>
    </section>
  )
}
