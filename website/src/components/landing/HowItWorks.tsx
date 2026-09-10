'use client'

import { STEPS } from './content'
import { STAGE_PANELS } from './panels'
import { StageRail } from './StageRail'
import { usePinnedStages } from './usePinnedStages'
import { cx, display, lede, section, wrap } from './primitives'

/**
 * The walkthrough: a pinned panel holding a schematic of the app while the copy
 * and the schematic advance together.
 *
 * This is the page's one pinned section. Every reference implementation of the
 * pattern pins a *visual* and changes text against it — pinning text and
 * swapping text charges the reader three viewports of scroll to deliver three
 * sentences. The three panels are what make the height worth it, and they are
 * why the feature blocks below went back to plain stacked sections: two pinned
 * sections in a row is six viewports of held scroll, and both were describing
 * the same three ideas.
 */
export function HowItWorks(): React.ReactElement {
  const { ref, active, enhanced, goTo, travel } = usePinnedStages(STEPS.length)

  const heading = (
    <div className="grid items-end gap-x-[clamp(32px,5vw,80px)] gap-y-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <h2 className={cx(display, 'max-w-[16ch] text-[clamp(30px,3.4vw,44px)]')}>
        The verse gets quoted. Then you start typing.
      </h2>
      <p className={cx(lede, 'lg:pb-1')}>
        You guess the book, search it, pick the right result, check the translation, and send.
        Thirty seconds gone, and the room watched it happen.
      </p>
    </div>
  )

  // Below lg, or under reduced motion: every step and panel stacked, in order,
  // with nothing hidden and nothing pinned.
  if (!enhanced) {
    return (
      <section id="how" ref={ref} className={cx(section, wrap)}>
        {heading}
        <ol className="m-0 mt-[clamp(36px,5vw,56px)] grid list-none gap-y-[clamp(32px,5vw,48px)] pl-0">
          {STEPS.map((step, i) => {
            const Panel = STAGE_PANELS[i]
            return (
              <li key={step.verb} className="grid gap-5">
                <p className="m-0 max-w-[46ch] text-[clamp(19px,2.4vw,24px)] leading-[1.35] tracking-[-0.02em] text-dim">
                  <b className="font-display font-bold text-paper">{step.verb}</b> {step.body}
                </p>
                <Panel live />
              </li>
            )
          })}
        </ol>
      </section>
    )
  }

  return (
    <section id="how" ref={ref} className="relative" style={{ height: travel }}>
      <div className="sticky top-0 flex h-screen items-center">
        <div className={wrap}>
          {heading}

          <hr className="hairline my-[clamp(32px,3.6vw,52px)] h-px border-0" />

          <div className="grid items-center gap-x-[clamp(40px,5vw,80px)] gap-y-10 lg:grid-cols-[minmax(0,150px)_minmax(0,1fr)_minmax(0,420px)]">
            <StageRail labels={STEPS.map((s) => s.verb)} active={active} onSelect={goTo} />

            <div className="grid">
              {STEPS.map((step, i) => (
                <p
                  key={step.verb}
                  aria-hidden={i !== active}
                  className={cx(
                    'col-start-1 row-start-1 m-0 max-w-[22ch] font-display',
                    'text-[clamp(26px,2.9vw,38px)] font-light leading-[1.2] tracking-[-0.03em] text-dim',
                    'transition-all ease-out motion-reduce:transition-none',
                    i === active
                      ? 'translate-y-0 opacity-100 delay-100 duration-500'
                      : 'pointer-events-none translate-y-2 opacity-0 duration-200',
                  )}
                >
                  <b className="font-extrabold text-paper">{step.verb}</b> {step.body}
                </p>
              ))}
            </div>

            {/* The schematic. All three stack in one cell so the panel never
                resizes as the stages change. */}
            <div className="grid">
              {STAGE_PANELS.map((Panel, i) => (
                <div
                  key={i}
                  aria-hidden={i !== active}
                  className={cx(
                    'col-start-1 row-start-1 transition-all ease-out motion-reduce:transition-none',
                    i === active
                      ? 'translate-y-0 opacity-100 delay-100 duration-500'
                      : 'pointer-events-none translate-y-3 opacity-0 duration-200',
                  )}
                >
                  <Panel live={i === active} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
