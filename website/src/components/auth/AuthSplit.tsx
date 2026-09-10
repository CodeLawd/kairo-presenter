import Image from 'next/image'
import type { ReactNode } from 'react'
import { Wordmark } from '@/components/brand/Wordmark'

/**
 * What fills the right-hand column. A screenshot when the page benefits from
 * showing the product, a pull-quote when it does not.
 */
export type BrandPanel =
  | { kind: 'shot'; src: string; alt: string; caption: string }
  | { kind: 'quote'; quote: ReactNode; attribution: string }

/**
 * The two-column frame every auth and onboarding page renders inside: the form
 * on the left, the brand on the right.
 *
 * Below `lg` the right column is dropped rather than stacked. The screenshots
 * are 2200px captures — illegible on a phone and a megabyte to download — and
 * the left column already carries the mark.
 */
export function AuthSplit({
  title,
  blurb,
  brand,
  header,
  footer,
  children,
}: {
  title: string
  blurb?: ReactNode
  brand: BrandPanel
  /** Rendered above the title — the onboarding progress rail uses this. */
  header?: ReactNode
  /** Rendered under a hairline below the form. */
  footer?: ReactNode
  children: ReactNode
}): React.ReactElement {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col justify-center bg-panel px-[clamp(24px,6vw,72px)] py-[clamp(40px,8vh,88px)]">
        <div className="mx-auto w-full max-w-[27rem]">
          <Wordmark />

          {header ? <div className="mt-8">{header}</div> : null}

          <h1
            className={`m-0 font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.03em] text-paper ${
              header ? 'mt-5' : 'mt-9'
            }`}
          >
            {title}
          </h1>
          {blurb ? (
            <p className="mt-2.5 max-w-[46ch] text-[14px] leading-relaxed text-mute">{blurb}</p>
          ) : null}

          <div className="mt-8">{children}</div>

          {footer ? (
            <div className="mt-7 border-t border-line-soft pt-6 text-[13px] leading-relaxed text-mute">
              {footer}
            </div>
          ) : null}
        </div>
      </div>

      <aside className="relative hidden overflow-hidden border-l border-line bg-ink lg:flex lg:flex-col lg:justify-center">
        <div
          className="starfield pointer-events-none absolute inset-x-[-10%] top-[-10%] h-[900px]"
          aria-hidden="true"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[22%] h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,158,11,0.14),transparent_70%)] blur-3xl"
        />

        <div className="relative z-10 px-[clamp(32px,4vw,64px)]">
          {brand.kind === 'shot' ? (
            <figure className="m-0">
              <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-[0_40px_80px_-40px_rgba(0,0,0,0.9)]">
                <Image
                  src={brand.src}
                  alt={brand.alt}
                  width={2200}
                  height={1365}
                  className="block h-auto w-full"
                  sizes="50vw"
                />
              </div>
              <figcaption className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint">
                {brand.caption}
              </figcaption>
            </figure>
          ) : (
            <blockquote className="m-0 max-w-[30ch]">
              <p className="m-0 font-display text-[clamp(24px,2.4vw,34px)] font-light leading-[1.25] tracking-[-0.03em] text-paper">
                {brand.quote}
              </p>
              <footer className="mt-5 font-mono text-[11px] uppercase tracking-[0.16em] text-faint">
                {brand.attribution}
              </footer>
            </blockquote>
          )}
        </div>
      </aside>
    </div>
  )
}
