import { Logo } from "@/components/brand/Logo";
import type { ReactNode } from "react";

/**
 * The frame every auth and onboarding page renders inside: one calm, centred
 * column — logo, title, form — and nothing competing with it. (The name is
 * historical; it used to be a two-column split with a brand panel.)
 */
export function AuthSplit({
  title,
  blurb,
  header,
  footer,
  children,
}: {
  title: string;
  blurb?: ReactNode;
  /** Rendered above the title — the onboarding progress rail uses this. */
  header?: ReactNode;
  /** Rendered under the form, centred. */
  footer?: ReactNode;
  children: ReactNode;
}): React.ReactElement {
  return (
    <div className="flex min-h-dvh flex-col bg-ink px-6 py-8">
      <main className="mx-auto flex w-full max-w-[22.5rem] flex-1 flex-col justify-center py-10">
        <div className="mb-10 flex justify-center">
          <Logo priority height={24} />
        </div>

        {header ? <div className="mb-8">{header}</div> : null}

        <div className="text-center">
          <h1 className="m-0 font-display text-[26px] font-semibold leading-[1.2] tracking-[-0.025em] text-paper">
            {title}
          </h1>
          {blurb ? (
            <p className="m-0 mx-auto mt-2.5 max-w-[34ch] text-[14.5px] leading-relaxed text-mute">{blurb}</p>
          ) : null}
        </div>

        <div className="mt-8 empty:hidden">{children}</div>

        {footer ? <div className="mt-8 text-center text-[13.5px] leading-relaxed text-mute">{footer}</div> : null}
      </main>

      <p className="m-0 text-center text-[12px] text-faint">
        Need a hand?{" "}
        <a className="text-mute underline-offset-2 hover:text-paper hover:underline" href="mailto:hello@kairo.app">
          hello@kairo.app
        </a>
      </p>
    </div>
  );
}
