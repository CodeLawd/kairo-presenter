import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

const LINKS = [
  ["Product", "/#product"],
  ["Screens", "/#screens"],
  ["Imagine", "/#imagine"],
  ["Engage", "/#engage"],
  ["Questions", "/#questions"],
  ["Download", "/#get"],
  ["Changelog", "/changelog"],
  ["Sign in", "/login"],
] as const;

const container =
  "mx-auto w-[calc(100%-40px)] max-w-[1200px] md:w-[calc(100%-64px)] xl:w-[calc(100%-96px)]";

export function LandingFooter({ light = false }: { light?: boolean }): React.ReactElement {
  if (light) {
    return (
      <footer className="border-t border-[#EAECEF] bg-white pt-16 pb-12 text-[#141518]">
        <div className={container}>
          <div className="flex flex-col justify-between gap-10 md:flex-row md:items-start">
            <div>
              <Logo href="/#top" height={22} tone="dark" />
              <p className="mt-4 max-w-[34ch] text-[15px] leading-[1.55] text-[#6B707C]">
                Listens to the sermon.
                <br />
                Puts Scripture on every screen.
              </p>
            </div>

            <nav
              className="flex flex-wrap gap-x-7 gap-y-2 md:justify-end"
              aria-label="Footer navigation"
            >
              {LINKS.map(([text, href]) => (
                <Link
                  className="inline-flex min-h-10 items-center text-[14px] font-medium text-[#565B68] transition-colors duration-150 hover:text-[#141518]"
                  href={href}
                  key={href}
                >
                  {text}
                </Link>
              ))}
            </nav>
          </div>

          <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-[#EAECEF] pt-7 text-[13.5px] text-[#6B707C]">
            <small className="text-[13.5px]">
              © {new Date().getFullYear()} Kairo Presenter. All rights reserved.
            </small>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <Link className="transition-colors hover:text-[#141518]" href="/privacy">
                Privacy
              </Link>
              <Link className="transition-colors hover:text-[#141518]" href="/terms">
                Terms
              </Link>
              <a className="transition-colors hover:text-[#141518]" href="#top">
                Back to top ↑
              </a>
            </div>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="relative isolate overflow-hidden border-t border-white/[.07] bg-[#06070A] pt-[80px] min-[701px]:pt-[104px]">
      <div
        className="landing-footer-wordmark pointer-events-none absolute inset-x-0 bottom-[-.08em] z-0 select-none whitespace-nowrap text-center text-[23vw] leading-none font-bold tracking-[-.09em] text-[#12141A] opacity-[0.28]"
        aria-hidden="true"
      >
        <span className="inline-block scale-x-[1.4]">KAIRO</span>
      </div>
      <div className={`${container} relative z-10 flex flex-col items-center text-center`}>
        <Image src="/brand/Stacked-Off-white.png" alt="Kairo" width={72} height={72} />
        <p className="mt-5 max-w-[40ch] text-[15px] leading-[1.55] text-[#A3A9BD]">
          Kairo Presenter · Native church presentation software for macOS, Windows, and Linux.
        </p>
        <nav
          className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-1"
          aria-label="Footer navigation"
        >
          {LINKS.map(([text, href]) => (
            <Link
              className="inline-flex min-h-11 items-center px-1 text-sm font-medium text-[#DBD7D0] transition-colors duration-200 hover:text-white hover:underline hover:underline-offset-[5px]"
              href={href}
              key={href}
            >
              {text}
            </Link>
          ))}
        </nav>
        <div className="mt-16 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pb-10 text-[12px] tracking-[.06em] text-[#A3A9BD] min-[701px]:mt-24">
          <small className="inline-flex min-h-11 items-center text-[12px] tracking-[.06em]">
            © {new Date().getFullYear()} Kairo
          </small>
          <span aria-hidden="true" className="text-white/25">·</span>
          <Link className="inline-flex min-h-11 items-center px-1 text-[#C9CEDF] transition-colors duration-200 hover:text-white hover:underline hover:underline-offset-[5px]" href="/privacy">
            Privacy
          </Link>
          <span aria-hidden="true" className="text-white/25">·</span>
          <Link className="inline-flex min-h-11 items-center px-1 text-[#C9CEDF] transition-colors duration-200 hover:text-white hover:underline hover:underline-offset-[5px]" href="/terms">
            Terms
          </Link>
          <span aria-hidden="true" className="text-white/25">·</span>
          <a
            className="inline-flex min-h-11 items-center px-1 text-[#C9CEDF] transition-colors duration-200 hover:text-white hover:underline hover:underline-offset-[5px]"
            href="#top"
          >
            Back to top ↑
          </a>
        </div>
      </div>
    </footer>
  );
}
