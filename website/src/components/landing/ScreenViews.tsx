"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Monitor, Projector, Radio, Tv } from "lucide-react";

/**
 * The screens section: what each output is for on the left, and on the right a
 * drawing of all four at once — the room, the stage, the lobby and the stream —
 * each showing what that screen would show. The section pins while you scroll
 * through it and each row takes its turn; where it can't pin (small or short
 * screens) the rows still advance as the section passes. A row scrolls to its turn.
 */

const VIEWS = [
  {
    title: "In the room",
    body: "Lyrics, Scripture, slides and media on the projector or TV.",
    Icon: Projector,
  },
  {
    title: "On the stage",
    body: "The current and next line, the clock, a countdown and notes for the team.",
    Icon: Monitor,
  },
  {
    title: "In the lobby",
    body: "Its own playlist of images and video, apart from what the room sees.",
    Icon: Tv,
  },
  {
    title: "On the stream",
    body: "Up to four NDI feeds, with lower thirds while the room sees full slides.",
    Icon: Radio,
  },
] as const;

export function ScreenViews({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [progress, setProgress] = useState(0); // 0..1 through the section
  const rootRef = useRef<HTMLDivElement>(null);

  const active = Math.min(
    VIEWS.length - 1,
    Math.floor(progress * VIEWS.length),
  );
  const step = progress * VIEWS.length - active; // 0..1 through the active row

  // A pinned section is much taller than the screen; otherwise it just passes through.
  const measure = (
    section: HTMLElement,
  ): { top: number; run: number; pinned: boolean } => {
    const rect = section.getBoundingClientRect();
    const vh = window.innerHeight;
    const run = rect.height - vh;
    return { top: rect.top, run, pinned: run > vh * 0.5 };
  };

  useEffect(() => {
    const section = rootRef.current?.closest("section");
    if (!section) return;
    let frame = 0;
    const update = (): void => {
      frame = 0;
      const { top, run, pinned } = measure(section);
      const vh = window.innerHeight;
      const p = pinned
        ? -top / run
        : (vh * 0.6 - top) / (section.offsetHeight + vh * 0.2);
      setProgress(Math.min(0.9999, Math.max(0, p)));
    };
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const goTo = (index: number): void => {
    const section = rootRef.current?.closest("section");
    if (!section) return;
    const { top, run, pinned } = measure(section);
    if (!pinned) {
      setProgress((index + 0.5) / VIEWS.length);
      return;
    }
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.scrollTo({
      top: window.scrollY + top + run * ((index + 0.5) / VIEWS.length),
      behavior: reduce ? "auto" : "smooth",
    });
  };

  const frame = (index: number): string =>
    `landing-view relative overflow-hidden rounded-lg border bg-black transition-[opacity,transform,border-color] duration-500 motion-reduce:transition-none ${
      active === index
        ? "border-[#8AB4FF]/70 opacity-100"
        : "scale-[.98] border-white/10 opacity-45"
    }`;

  return (
    <div
      ref={rootRef}
      className="grid w-full items-center gap-12 min-[1001px]:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)] min-[1001px]:gap-16"
    >
      <div>
        {children}
        <ul className="mt-10 grid gap-2">
          {VIEWS.map(({ title, body, Icon }, i) => (
            <li key={title}>
              <button
                type="button"
                className={`relative flex w-full items-start gap-4 overflow-hidden rounded-xl p-3.5 text-left transition-colors duration-300 ${
                  active === i ? "bg-white/[.07]" : "hover:bg-white/[.04]"
                }`}
                onClick={() => goTo(i)}
                aria-pressed={active === i}
              >
                {active === i && (
                  <span
                    className="absolute bottom-0 left-0 h-0.5 bg-[#8AB4FF]/70"
                    style={{ width: `${(step * 100).toFixed(1)}%` }}
                    aria-hidden="true"
                  />
                )}
                <span
                  className={`grid size-9 shrink-0 place-items-center rounded-lg transition-colors duration-300 [&_svg]:size-[18px] ${
                    active === i
                      ? "bg-[#3B6BFF] text-white"
                      : "bg-white/[.06] text-[#B9C3E6]"
                  }`}
                >
                  <Icon aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-[17px] font-medium tracking-[-.02em] text-[#F6F3EB]">
                    {title}
                  </span>
                  <span
                    className={`mt-1 block text-[15px] leading-[1.5] transition-colors duration-300 ${
                      active === i ? "text-[#C9CFE6]" : "text-[#8D93AD]"
                    }`}
                  >
                    {body}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div
        className="rounded-[22px] bg-white/[.05] p-3 min-[701px]:p-5"
        aria-label="The room, stage, lobby and stream screens, each showing its own output"
        role="img"
      >
        <div className="grid grid-cols-[2fr_1fr] gap-2.5 min-[701px]:gap-3.5">
          <div className="grid gap-2.5 min-[701px]:gap-3.5">
            {/* Room: the full slide */}
            <div className={`${frame(0)} aspect-video`}>
              <Image
                src="/images/kairo-worship-hero.webp"
                alt=""
                fill
                sizes="(min-width: 1001px) 40vw, 70vw"
                className="object-cover brightness-[.32] blur-[2px]"
              />
              <div className="absolute inset-0 grid place-items-center text-center text-[5.2cqw] leading-[1.25] font-medium tracking-[-.02em] text-white">
                <p>
                  Amazing grace, how sweet the sound
                  <br />
                  That saved a wretch like me
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5 min-[701px]:gap-3.5">
              {/* Stage: current and next, clock and countdown */}
              <div className={`${frame(1)} aspect-video text-white`}>
                <div className="absolute inset-0 p-[5cqw]">
                  <div className="flex justify-between text-[6cqw] font-semibold tabular-nums">
                    <span>10:42</span>
                    <span className="text-[#8AB4FF]">04:59</span>
                  </div>
                  <p className="mt-[5cqw] text-[8cqw] leading-[1.1] font-medium tracking-[-.02em]">
                    Amazing grace, how sweet the sound
                  </p>
                  <p className="mt-[3cqw] text-[6cqw] leading-[1.15] text-white/45">
                    That saved a wretch like me
                  </p>
                </div>
              </div>
              {/* Stream: the room's picture with a lower third */}
              <div className={`${frame(3)} aspect-video`}>
                <Image
                  src="/images/kairo-worship-hero.webp"
                  alt=""
                  fill
                  sizes="(min-width: 1001px) 20vw, 35vw"
                  className="object-cover object-[60%_30%] brightness-[.8]"
                />
                <span className="absolute top-[4cqw] right-[4cqw] rounded-[1.5cqw] bg-black/60 px-[2.5cqw] py-[1cqw] text-[4.5cqw] font-semibold text-white">
                  NDI
                </span>
                <div className="absolute inset-x-[5cqw] bottom-[5cqw] rounded-[2cqw] bg-black/70 px-[4cqw] py-[2.5cqw] text-white">
                  <p className="text-[6cqw] font-semibold leading-tight">
                    Amazing grace
                  </p>
                  <p className="text-[5cqw] leading-tight text-white/70">
                    How sweet the sound
                  </p>
                </div>
              </div>
            </div>
          </div>
          {/* Lobby: a portrait screen with its own playlist */}
          <div
            className={`${frame(2)} bg-[linear-gradient(160deg,#1D3FB8_0%,#5B3FD6_55%,#A63DC4_100%)] text-white`}
          >
            <div className="absolute inset-0 flex flex-col justify-end p-[9cqw]">
              <p className="text-[6cqw] font-semibold tracking-[.14em] text-white/70 uppercase">
                Today
              </p>
              <p className="mt-[3cqw] text-[15cqw] leading-[1] font-medium tracking-[-.04em]">
                Welcome home.
              </p>
              <p className="mt-[5cqw] text-[7cqw] leading-[1.35] text-white/80">
                Coffee in the foyer after the service.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
