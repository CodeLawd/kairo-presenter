import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import type { ReactNode } from "react";
import "@/app/landing.css";

/**
 * The frame every auth and onboarding page renders inside, in the landing
 * page's language. Wide screens split in two: the landing hero's worship photo
 * and headline on the left, the form column on the right. Phones get the form
 * column alone, on a plain page (white in the light theme).
 */

const footerLink = "text-mute hover:text-paper hover:underline hover:underline-offset-[5px]";

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
    <div className="grid min-h-dvh bg-ink text-paper lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <aside
        className="relative isolate hidden overflow-hidden bg-[#08060b] lg:flex lg:flex-col lg:justify-end"
        aria-hidden="true"
      >
        <Image
          src="/images/kairo-worship-hero.webp"
          alt=""
          fill
          priority
          sizes="50vw"
          className="landing-hero-photo object-cover"
        />
        <div className="landing-hero-shade absolute inset-0" />
        <div className="relative z-1 p-12 xl:p-16">
          <p className="text-[11px] font-bold tracking-[.18em] text-[#C3BFB7] uppercase">
            The future of presentations
          </p>
          <p className="mt-5 max-w-[14ch] text-[clamp(40px,3.6vw,60px)] leading-[1] font-medium tracking-[-.06em] text-[#F6F3EB]">
            Church Presentations, Reimagined With <span className="text-[#8AB4FF]">AI.</span>
          </p>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col bg-ink px-5 py-6 in-data-[dash-theme=light]:bg-white min-[701px]:px-10">
        <header className="flex h-12 items-center justify-between gap-6">
          <Logo priority height={22} />
          <Link
            className="inline-flex h-9 items-center rounded-lg bg-paper px-4 text-sm font-semibold text-ink transition-opacity hover:opacity-85"
            href="/#get"
          >
            Download
          </Link>
        </header>

        <main className="mx-auto flex w-full max-w-[24rem] flex-1 flex-col justify-center py-12">
          {header ? <div className="mb-10">{header}</div> : null}

          <h1 className="m-0 text-[clamp(32px,4vw,44px)] leading-[1.05] font-medium tracking-[-.05em] text-paper">
            {title}
          </h1>
          {blurb ? (
            <p className="m-0 mt-4 max-w-[38ch] text-[16px] leading-[1.55] text-mute">{blurb}</p>
          ) : null}

          <div className="mt-9 empty:hidden">{children}</div>

          {footer ? <div className="mt-8 text-[14px] leading-relaxed text-mute">{footer}</div> : null}
        </main>

        <p className="m-0 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] tracking-[.16em] text-faint">
          <a className={footerLink} href="mailto:hello@kairopresenter.com">
            Help
          </a>
          <span aria-hidden="true">·</span>
          <Link className={footerLink} href="/privacy">
            Privacy
          </Link>
          <span aria-hidden="true">·</span>
          <Link className={footerLink} href="/terms">
            Terms
          </Link>
        </p>
      </div>
    </div>
  );
}
