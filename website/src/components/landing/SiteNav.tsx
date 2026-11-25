"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { SessionLink, useSignedIn } from "@/components/landing/SessionNavLink";

/**
 * The site's one header, on the homepage and every subpage. It sits clear over
 * the hero, then turns into a translucent bar once the page scrolls, so the
 * sections and Download stay one tap away. On the homepage the link for the
 * section in view is marked. Below 701px the links move into a menu that grows
 * from its button and closes on Escape, a link, or a tap outside.
 *
 * Rendered outside `[data-stretchy-page]`: that element is transformed during
 * the footer's overscroll, which would turn this fixed bar into a scrolling one.
 */

const SECTIONS = [
  ["Product", "product"],
  ["Screens", "screens"],
  ["Imagine", "imagine"],
  ["Engage", "engage"],
  ["Questions", "questions"],
] as const;

const container =
  "mx-auto w-[calc(100%-40px)] max-w-[1440px] md:w-[calc(100%-48px)] xl:w-[calc(100%-80px)]";

export function SiteNav({ home = false }: { home?: boolean }): React.ReactElement {
  const signedIn = useSignedIn();
  const [scrolled, setScrolled] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  // Material on once the page leaves the very top.
  useEffect(() => {
    let frame = 0;
    const update = (): void => {
      frame = 0;
      setScrolled(window.scrollY > 8);
    };
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Where am I: the section crossing the middle of the screen.
  useEffect(() => {
    if (!home) return;
    const targets = SECTIONS.map(([, id]) => document.getElementById(id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setCurrent(entry.target.id);
          else setCurrent((id) => (id === entry.target.id ? null : id));
        }
      },
      { rootMargin: "-50% 0px -50% 0px" },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [home]);

  // The menu closes on Escape (focus back to its button), a tap outside, or a wider window.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      setOpen(false);
      menuButton.current?.focus();
    };
    const onPointer = (e: PointerEvent): void => {
      if (!headerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const wide = window.matchMedia("(min-width: 701px)");
    const onWide = (): void => {
      if (wide.matches) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  const href = (id: string): string => (home ? `#${id}` : `/#${id}`);
  const close = (): void => setOpen(false);

  return (
    <header
      ref={headerRef}
      className="landing-nav fixed inset-x-0 top-0 z-50 text-[#F6F3EB]"
      data-scrolled={scrolled || open}
    >
      <div className={`${container} flex h-full items-center gap-3 min-[701px]:gap-10`}>
        <Logo href={home ? "#top" : "/"} height={23} tone="light" priority className="shrink-0" />

        <nav className="m-auto hidden items-center gap-6 min-[701px]:flex" aria-label="Main navigation">
          {SECTIONS.map(([text, id]) => (
            <Link
              className="landing-press landing-nav-link py-2 text-[14px] font-medium"
              aria-current={current === id ? "location" : undefined}
              href={href(id)}
              key={id}
            >
              {text}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 min-[701px]:ml-0 min-[701px]:gap-5">
          <span className="hidden min-[701px]:contents">
            <SessionLink signedIn={signedIn} variant="text" />
          </span>
          {!home && (
            <Link
              className="landing-press inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-white/10 px-3.5 text-[14px] font-medium text-white ring-1 ring-white/15 hover:bg-white/18 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
              href="/#get"
              onClick={close}
            >
              Download
              <span aria-hidden="true" className="text-white/70">›</span>
            </Link>
          )}
          <button
            ref={menuButton}
            type="button"
            className="landing-press landing-menu-button -mr-2.5 grid size-11 place-items-center rounded-full min-[701px]:hidden"
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        id="site-menu"
        className="landing-menu min-[701px]:hidden"
        data-open={open}
        inert={!open}
      >
        <nav className={`${container} pt-2 pb-6`} aria-label="Menu">
          <ul>
            {SECTIONS.map(([text, id], i) => (
              <li key={id} style={{ "--i": i } as React.CSSProperties}>
                <Link
                  className="landing-press flex min-h-12 items-center text-[26px] font-medium tracking-[-.03em] text-[#F6F3EB]"
                  aria-current={current === id ? "location" : undefined}
                  href={href(id)}
                  onClick={close}
                >
                  {text}
                </Link>
              </li>
            ))}
            <li style={{ "--i": SECTIONS.length } as React.CSSProperties}>
              <Link
                className="landing-press flex min-h-12 items-center text-[26px] font-medium tracking-[-.03em] text-[#F6F3EB]"
                href="/changelog"
                onClick={close}
              >
                Changelog
              </Link>
            </li>
          </ul>
          <div className="mt-5 border-t border-white/10 pt-4" style={{ "--i": SECTIONS.length + 1 } as React.CSSProperties}>
            <SessionLink signedIn={signedIn} variant="text" className="!justify-start" onClick={close} />
          </div>
        </nav>
      </div>
    </header>
  );
}
