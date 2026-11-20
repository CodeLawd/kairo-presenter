import { LandingFooter } from "@/components/landing/LandingFooter";
import { StretchyFooter } from "@/components/landing/StretchyFooter";
import { SiteNav } from "@/components/landing/SiteNav";
import "@/app/landing.css";

/**
 * The frame for the site's pages beyond the homepage (changelog, privacy,
 * terms): the dark page, the shared site header, the shared footer and its
 * stretchy aurora. Pages supply only their `<main>` content.
 */

export const subpageContainer =
  "mx-auto w-[calc(100%-40px)] max-w-[1440px] md:w-[calc(100%-48px)] xl:w-[calc(100%-80px)]";

export function SubpageShell({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <>
      <a
        className="absolute -top-20 left-6 z-[100] rounded-lg bg-white px-[18px] py-3 text-[#11120D] focus:top-3"
        href="#main"
      >
        Skip to content
      </a>
      <SiteNav />
      <div
        className="landing relative z-10 min-h-screen bg-[#0A0B10] font-[var(--font-manrope)] text-[#F6F3EB]"
        id="top"
        data-stretchy-page=""
      >
        {/* Room for the fixed header, which is out of flow. */}
        <main id="main" className="pt-[72px] min-[701px]:pt-[88px]">{children}</main>

        <LandingFooter />
      </div>
      <StretchyFooter />
    </>
  );
}
