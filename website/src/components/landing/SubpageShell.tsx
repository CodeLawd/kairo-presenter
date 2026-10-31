import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { StretchyFooter } from "@/components/landing/StretchyFooter";
import { SessionNavLink } from "@/components/landing/SessionNavLink";
import "@/app/landing.css";

/**
 * The frame for the site's pages beyond the homepage (changelog, privacy,
 * terms): the dark page, a slim header back to the homepage and downloads, the
 * shared footer and its stretchy aurora. Pages supply only their `<main>` content.
 */

export const subpageContainer =
  "mx-auto w-[calc(100%-40px)] max-w-[1440px] md:w-[calc(100%-48px)] xl:w-[calc(100%-80px)]";

export function SubpageShell({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <>
      <div
        className="landing min-h-screen bg-[#0A0B10] font-[var(--font-manrope)] text-[#F6F3EB]"
        id="top"
        data-stretchy-page=""
      >
        <header className={`${subpageContainer} flex h-[72px] items-center gap-3 min-[701px]:h-[88px]`}>
          <Logo href="/" priority className="shrink-0" />
          <nav className="ml-auto flex items-center gap-3 sm:gap-5" aria-label="Main navigation">
            <SessionNavLink variant="text" />
            <Link
              className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-md px-1 text-sm font-semibold text-[#11120D] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F4F0E9] group"
              href="/#get"
            >
              <span className="inline-flex h-8 items-center rounded-md bg-[#F4F0E9] px-3 transition-colors group-hover:bg-[#E9E5DE]">Download</span>
            </Link>
          </nav>
        </header>

        <main id="main">{children}</main>

        <LandingFooter />
      </div>
      <StretchyFooter />
    </>
  );
}
