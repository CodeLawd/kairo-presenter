import { AppShot } from './AppShot'
import { IconArrow } from './icons'
import { STRIP } from './content'
import { Reveal } from './Reveal'
import { btn, btnGhost, btnPrimary, cx, wrap } from './primitives'

export function Hero(): React.ReactElement {
  return (
    <>
      <section className={cx(wrap, 'relative pt-[clamp(72px,9vw,116px)] text-center')}>
        <div
          className="starfield pointer-events-none absolute inset-x-[-10%] top-[-10%] z-0 h-[900px]"
          aria-hidden="true"
        />

        <div className="relative z-10">
          <h1 className="mx-auto max-w-[17ch] font-display text-[clamp(40px,6.2vw,80px)] font-extrabold leading-[1.02] tracking-[-0.045em]">
            <span className="font-light text-[#8d918f]">Your pastor says the verse.</span> It&rsquo;s
            already on screen.
          </h1>
          <p className="mx-auto mt-4 max-w-[34ch] font-display text-[clamp(17px,2.1vw,24px)] font-light tracking-[-0.02em] text-[#8d918f]">
            Kairo listens to the sermon and finds the passage{' '}
            <b className="font-bold text-paper">before you can type it</b>.
          </p>
          <p className="mx-auto mt-[26px] max-w-[58ch] text-[16.5px] leading-[1.62] text-dim">
            It picks up verses that are read out and verses that are only quoted. The match lands in
            your queue with the text ready, in your translation. You check it and send it to the
            screen.
          </p>
          <div className="mt-[30px] flex flex-wrap justify-center gap-3">
            <a className={cx(btn, btnPrimary)} href="#get">
              Get early access <IconArrow />
            </a>
            <a className={cx(btn, btnGhost)} href="#features">
              See how it works
            </a>
          </div>
          <p className="mt-[22px] font-mono text-[11px] tracking-[0.04em] text-faint">
            <span className="whitespace-nowrap">Runs on your machine</span>
            <i className="mx-[0.6em] not-italic text-[#2f3332]">·</i>
            <span className="whitespace-nowrap">Works offline</span>
            <i className="mx-[0.6em] not-italic text-[#2f3332]">·</i>
            <span className="whitespace-nowrap">ProPresenter 7 and NDI</span>
            <i className="mx-[0.6em] not-italic text-[#2f3332]">·</i>
            <span className="whitespace-nowrap">Your keys stay local</span>
          </p>
        </div>

        <div className="relative z-10 mt-[clamp(48px,7vw,84px)]">
          <Reveal>
            <AppShot
              eager
              glow
              src="/shots/operator.png"
              alt="The Kairo operator view: a live transcript on the left, detected scripture rendered as themed slides in the centre, and the live output and staging queue on the right."
              caption="The operator view — live transcript, detected scripture, and what is on screen right now"
            />
          </Reveal>
        </div>
      </section>

      <div
        className="mt-[clamp(48px,6vw,72px)] overflow-hidden border-y border-line-soft py-[15px]"
        aria-hidden="true"
      >
        <div className="flex w-max animate-drift gap-11 motion-reduce:animate-none">
          {[...STRIP, ...STRIP].map((item, i) => (
            <span
              key={`${item}-${i}`}
              className="inline-flex items-center gap-3 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.18em] text-faint before:block before:h-1 before:w-1 before:rounded-full before:bg-accent-dim before:opacity-80"
            >
              {item}
            </span>
          ))}
        </div>
      </div>
    </>
  )
}
