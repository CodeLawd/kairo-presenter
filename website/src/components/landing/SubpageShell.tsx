import { LandingFooter } from "@/components/landing/LandingFooter";
import { SiteNav } from "@/components/landing/SiteNav";
import "@/app/landing.css";

/**
 * Shared frame for public subpages (changelog, privacy, terms, download thanks):
 * crisp light canvas with the shared SiteNav bleeding over each page's
 * atmospheric blue top band, and the light editorial footer below.
 */

export const subpageContainer =
  "mx-auto w-[calc(100%-40px)] max-w-[1200px] md:w-[calc(100%-64px)] xl:w-[calc(100%-96px)]";

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
        className="landing relative z-10 flex min-h-screen flex-col bg-white font-[var(--font-manrope)] text-[#141518]"
        id="top"
      >
        <main id="main" className="flex-1">
          {children}
        </main>
        <LandingFooter light />
      </div>
    </>
  );
}
