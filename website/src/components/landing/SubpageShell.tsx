import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { StretchyFooter } from "@/components/landing/StretchyFooter";
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
        <header className={`${subpageContainer} flex h-[72px] items-center gap-6 min-[701px]:h-[88px]`}>
          <Logo href="/" priority />
          <nav className="ml-auto flex items-center gap-6" aria-label="Main navigation">
            <Link
              className="hidden text-sm font-medium text-[#EBE8E0] hover:underline hover:underline-offset-[5px] min-[701px]:block"
              href="/login"
            >
              Sign in
            </Link>
            <Link
              className="inline-flex h-9 items-center rounded-lg bg-[#F4F0E9] px-4 text-sm font-semibold text-[#11120D] transition-colors hover:bg-[#E9E5DE]"
              href="/#get"
            >
              Download
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
