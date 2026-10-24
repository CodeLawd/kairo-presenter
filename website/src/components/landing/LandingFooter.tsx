import Image from "next/image";
import Link from "next/link";

/**
 * The footer shared by the homepage and the changelog: one centred column over
 * the KAIRO wordmark. Links point at the homepage's sections by path, so they
 * jump in place on the homepage and still land there from other pages.
 */

const LINKS = [
  ["Product", "/#product"],
  ["Screens", "/#screens"],
  ["Questions", "/#questions"],
  ["Download", "/#get"],
  ["Changelog", "/changelog"],
  ["Sign in", "/login"],
] as const;

const container =
  "mx-auto w-[calc(100%-40px)] max-w-[1440px] md:w-[calc(100%-48px)] xl:w-[calc(100%-80px)]";

export function LandingFooter(): React.ReactElement {
  return (
    <footer className="relative isolate overflow-hidden bg-[#06070A] pt-[90px] min-[701px]:pt-[120px]">
      <div
        className="landing-footer-wordmark pointer-events-none absolute inset-x-0 bottom-[-.08em] z-0 select-none whitespace-nowrap text-center text-[23vw] leading-none font-bold tracking-[-.09em] text-[#12141A] opacity-[0.28]"
        aria-hidden="true"
      >
        <span className="inline-block scale-x-[1.4]">KAIRO</span>
      </div>
      <div className={`${container} relative z-10 flex flex-col items-center text-center`}>
        <Image src="/brand/Stacked-Off-white.png" alt="Kairo" width={72} height={72} />
        <p className="mt-5 max-w-[30ch] text-[15px] leading-[1.55] text-[#A4A197]">
          For the people who put Sunday on screen.
        </p>
        <nav
          className="mt-10 flex flex-wrap justify-center gap-x-8 gap-y-3"
          aria-label="Footer navigation"
        >
          {LINKS.map(([text, href]) => (
            <Link
              className="text-sm text-[#DBD7D0] hover:underline hover:underline-offset-[5px]"
              href={href}
              key={href}
            >
              {text}
            </Link>
          ))}
        </nav>
        <div className="mt-[90px] flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pb-8 text-[11px] tracking-[.16em] text-[#98958C] min-[701px]:mt-[150px]">
          <small className="text-[11px] tracking-[.16em]">
            © {new Date().getFullYear()} Kairo
          </small>
          <span aria-hidden="true">·</span>
          <Link className="text-[#B0ACA4] hover:underline hover:underline-offset-[5px]" href="/privacy">
            Privacy
          </Link>
          <span aria-hidden="true">·</span>
          <Link className="text-[#B0ACA4] hover:underline hover:underline-offset-[5px]" href="/terms">
            Terms
          </Link>
          <span aria-hidden="true">·</span>
          <a
            className="text-[#B0ACA4] hover:underline hover:underline-offset-[5px]"
            href="#top"
          >
            Back to top ↑
          </a>
        </div>
      </div>
    </footer>
  );
}
