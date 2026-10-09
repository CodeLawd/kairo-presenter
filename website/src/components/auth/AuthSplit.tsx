import { Logo } from "@/components/brand/Logo";
import type { ReactNode } from "react";
import { AuthScene } from "@/components/auth/AuthScene";

/** The line of brand copy over the right-hand column. Varies per page. */
export type BrandPanel = { quote: ReactNode };

/**
 * The two-column frame every auth and onboarding page renders inside: the form
 * on the left, the brand on the right.
 *
 * Below `lg` the right column is dropped rather than stacked — on a phone the
 * scene is illegible and pushes the form below the fold, and the left column
 * already carries the mark.
 */
export function AuthSplit({
  title,
  blurb,
  brand,
  header,
  footer,
  children,
}: {
  title: string;
  blurb?: ReactNode;
  brand: BrandPanel;
  /** Rendered above the title — the onboarding progress rail uses this. */
  header?: ReactNode;
  /** Rendered under a hairline below the form. */
  footer?: ReactNode;
  children: ReactNode;
}): React.ReactElement {
  return (
    <div className="grid min-h-dvh bg-ink lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex min-h-dvh flex-col px-[clamp(24px,6vw,72px)] py-8">
        <Logo priority />

        <main className="mx-auto flex w-full max-w-[24rem] flex-1 flex-col justify-center py-12">
          {header ? <div className="mb-8">{header}</div> : null}

          <h1 className="m-0 font-display text-[28px] font-semibold leading-[1.15] tracking-[-0.03em] text-paper">
            {title}
          </h1>
          {blurb ? (
            <p className="m-0 mt-3 max-w-[42ch] text-[14.5px] leading-relaxed text-mute">{blurb}</p>
          ) : null}

          <div className="mt-8 empty:hidden">{children}</div>

          {footer ? (
            <div className="mt-8 border-t border-line-soft pt-6 text-[13.5px] leading-relaxed text-mute">
              {footer}
            </div>
          ) : null}
        </main>

        <p className="m-0 text-[12px] text-faint">
          Need a hand?{" "}
          <a className="text-mute underline-offset-2 hover:text-paper hover:underline" href="mailto:hello@kairo.app">
            hello@kairo.app
          </a>
        </p>
      </div>

      <aside className="relative m-3 hidden overflow-hidden rounded-2xl bg-panel lg:flex lg:flex-col">
        {/* One soft pool of the accent behind the scene — the old full-panel
            field graded blue into grey and read as muddy. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[58%] h-[560px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(108,145,194,0.16),transparent)]"
        />
        <div aria-hidden="true" className="grain pointer-events-none absolute inset-0" />

        <div className="relative z-10 flex flex-1 flex-col px-[clamp(40px,5vw,80px)] py-[clamp(48px,8vh,88px)]">
          <p className="m-0 max-w-[20ch] font-display text-[clamp(28px,2.6vw,40px)] font-light leading-[1.15] tracking-[-0.03em] text-paper">
            {brand.quote}
          </p>

          <div className="flex flex-1 items-center py-10">
            <AuthScene />
          </div>
        </div>
      </aside>
    </div>
  );
}
