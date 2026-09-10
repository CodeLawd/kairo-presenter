'use client'

import { FEATURES } from './content'
import { Bullets } from './Bullets'
import { FEATURE_PANELS } from './panels'
import { SplitFeature } from './SplitFeature'
import { StageRail } from './StageRail'
import { usePinnedStages } from './usePinnedStages'
import { cx, display, wrap } from './primitives'

/**
 * The three feature blocks, as a pinned panel that swaps its copy and its
 * schematic together.
 *
 * Each feature carries a headline, a standfirst and four points, so they are
 * shown one at a time rather than dimmed, with an index rail down the left
 * saying which of the three you are on. The panels are different surfaces from
 * the walkthrough's above: both sections cover the same three areas of the app,
 * and showing the same schematics twice would read as a repeat.
 *
 * Below `lg`, or under a reduced-motion preference, this falls back to three
 * plain stacked sections — see `usePinnedStages`.
 */
export function Features(): React.ReactElement {
  const { ref, active, enhanced, goTo, travel } = usePinnedStages(FEATURES.length)

  if (!enhanced) {
    return (
      <div id="features" ref={ref as React.RefObject<HTMLDivElement>}>
        {FEATURES.map((f, i) => {
          const Panel = FEATURE_PANELS[i]
          return (
            <div key={f.title}>
              {i > 0 ? <hr className="hairline m-0 h-px border-0" /> : null}
              <SplitFeature title={f.title} lede={f.lede} bullets={f.bullets}>
                <Panel live />
              </SplitFeature>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <section id="features" ref={ref} className="relative" style={{ height: travel }}>
      <div className="sticky top-0 flex h-screen items-center">
        <div
          className={cx(
            wrap,
            'grid items-center gap-x-[clamp(40px,5vw,80px)] gap-y-10',
            'lg:grid-cols-[minmax(0,150px)_minmax(0,1fr)_minmax(0,400px)]',
          )}
        >
          <StageRail labels={FEATURES.map((f) => f.label)} active={active} onSelect={goTo} />

          {/* Copy and schematic each stack all three stages in one grid cell,
              so neither column resizes as the stages change. */}
          <div className="grid">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                aria-hidden={i !== active}
                className={cx(
                  'col-start-1 row-start-1 transition-all ease-out motion-reduce:transition-none',
                  i === active
                    ? 'translate-y-0 opacity-100 delay-100 duration-500'
                    : 'pointer-events-none translate-y-2 opacity-0 duration-200',
                )}
              >
                <h2 className={cx(display, 'max-w-[14ch] text-[clamp(30px,3.4vw,46px)]')}>
                  {f.title}
                </h2>
                <p className="m-0 mt-4 max-w-[46ch] text-[clamp(16px,1.5vw,18px)] leading-[1.55] text-dim">
                  {f.lede}
                </p>
                <hr className="hairline my-[clamp(22px,2.4vw,34px)] h-px border-0" />
                <Bullets items={f.bullets} single />
              </div>
            ))}
          </div>

          <div className="grid">
            {FEATURE_PANELS.map((Panel, i) => (
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
    </section>
  )
}
