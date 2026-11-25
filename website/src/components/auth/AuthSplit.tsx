import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import type { ReactNode } from "react";
import "@/app/landing.css";

/**
 * Shared frame for auth and onboarding routes: the sanctuary worship photograph
 * layered inside the midnight-navy-to-electric-blue architectural grid on the
 * left, and a clean form column on the right.
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
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}): React.ReactElement {
  return (
    <div className="grid min-h-dvh bg-ink text-paper lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <aside
        className="mc-auth-panel relative isolate hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16"
        aria-hidden="true"
      >
        {/* Blended sanctuary photograph + architectural blue wash */}
        <Image
          src="/images/kairo-worship-hero.webp"
          alt=""
          fill
          priority
          sizes="50vw"
          className="-z-2 object-cover opacity-35 mix-blend-luminosity"
        />
        <div
          className="pointer-events-none absolute inset-0 -z-1 bg-[linear-gradient(180deg,rgba(4,9,32,0.72)_0%,rgba(9,27,86,0.52)_52%,rgba(20,86,246,0.82)_100%)]"
        />

        <Logo href="/" height={23} tone="light" priority />

        <div className="relative z-1 max-w-[460px]">
          <p className="text-[clamp(36px,3.4vw,54px)] leading-[1.06] font-medium tracking-[-.036em] text-white">
            Every screen in sync.
            <br />
            Every verse on cue.
          </p>
          <p className="mt-5 max-w-[38ch] text-[16px] leading-[1.6] text-white/85">
            Live Scripture detection, multi-screen outputs, Imagine visuals, and
            browser Q&amp;A from one booth computer.
          </p>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col bg-ink px-5 py-6 in-data-[dash-theme=light]:bg-white min-[701px]:px-10">
        <header className="flex h-12 items-center justify-between gap-6">
          <span className="lg:invisible">
            <Logo priority height={22} />
          </span>
          <Link
            className="inline-flex h-9 items-center rounded-[10px] border border-line bg-panel px-4 text-[14px] font-medium text-paper transition-colors hover:bg-panel-2 in-data-[dash-theme=light]:border-[#EAECEF] in-data-[dash-theme=light]:bg-[#F8F9FB] in-data-[dash-theme=light]:text-[#141518] in-data-[dash-theme=light]:hover:bg-[#EFF1F5]"
            href="/#get"
          >
            Download
          </Link>
        </header>

        <main className="mx-auto flex w-full max-w-[24rem] flex-1 flex-col justify-center py-12">
          {header ? <div className="mb-10">{header}</div> : null}

          <h1 className="m-0 text-[clamp(30px,3.6vw,40px)] leading-[1.08] font-medium tracking-[-.035em] text-paper">
            {title}
          </h1>
          {blurb ? (
            <p className="m-0 mt-3.5 max-w-[38ch] text-[15.5px] leading-[1.58] text-mute">
              {blurb}
            </p>
          ) : null}

          <div className="mt-8 empty:hidden">{children}</div>

          {footer ? <div className="mt-8 text-[14px] leading-relaxed text-mute">{footer}</div> : null}
        </main>

        <p className="m-0 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-faint">
          <a className={footerLink} href="mailto:hello@kairopresenter.com">
            Help
          </a>
          <Link className={footerLink} href="/privacy">
            Privacy
          </Link>
          <Link className={footerLink} href="/terms">
            Terms
          </Link>
        </p>
      </div>
    </div>
  );
}
