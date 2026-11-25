"use client";

import { useState } from "react";
import Image from "next/image";
import { usePinnedStages } from "@/components/landing/usePinnedStages";

const VIEWS = [
  {
    title: "In the room",
    body: "Lyrics, Scripture, slides and media on the projector or TV.",
  },
  {
    title: "On the stage",
    body: "The current and next line, the clock, a countdown and notes for the team.",
  },
  {
    title: "In the lobby",
    body: "Its own playlist of images and video, apart from what the room sees.",
  },
  {
    title: "On the stream",
    body: "Up to four NDI feeds, with lower thirds while the room sees full slides.",
  },
] as const;

const container =
  "mx-auto w-[calc(100%-40px)] max-w-[1200px] md:w-[calc(100%-64px)] xl:w-[calc(100%-96px)]";

export function ScreenViews({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const {
    ref,
    active: pinnedActive,
    stageProgress,
    enhanced,
    travel,
    goTo,
  } = usePinnedStages(VIEWS.length);
  const [manualActive, setManualActive] = useState(0);

  const active = enhanced ? pinnedActive : manualActive;
  const select = (i: number): void => {
    if (enhanced) goTo(i);
    else setManualActive(i);
  };

  const frame = (index: number): string =>
    `landing-view relative cursor-pointer overflow-hidden rounded-2xl bg-[#0D0F14] text-left ring-1 transition-[opacity,transform,box-shadow] duration-500 ease-[var(--ease-out)] motion-reduce:transition-none ${
      active === index
        ? "scale-100 opacity-100 ring-[#1655F8] shadow-[0_28px_64px_-22px_rgba(20,86,246,0.32)]"
        : "scale-[.985] opacity-45 ring-black/10 hover:opacity-80"
    }`;

  return (
    <section
      ref={ref}
      id="screens"
      aria-labelledby="screens-title"
      className="relative bg-white"
      style={enhanced ? { minHeight: travel } : undefined}
    >
      <div
        className={
          enhanced
            ? "sticky top-0 flex min-h-screen items-center py-20"
            : "py-[clamp(80px,9vw,124px)]"
        }
      >
        <div
          className={`${container} grid w-full items-center gap-12 min-[1024px]:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] min-[1024px]:gap-16`}
        >
          <div>
            {children}
            <ul className="mt-9 divide-y divide-[#EAECEF] border-y border-[#EAECEF]">
              {VIEWS.map(({ title, body }, i) => {
                const on = active === i;
                const fill = enhanced
                  ? i < active
                    ? 1
                    : on
                      ? Math.max(0.08, stageProgress)
                      : 0
                  : on
                    ? 1
                    : 0;
                return (
                  <li key={title} className="relative">
                    <button
                      type="button"
                      className={`landing-press landing-press-soft relative w-full px-4 py-4 text-left transition-colors duration-300 ${
                        on ? "bg-[#F7F9FC]" : "hover:bg-[#FAFAFC]"
                      }`}
                      onClick={() => select(i)}
                      aria-current={on ? "step" : undefined}
                    >
                      {/* Fluid vertical progress rail on the left edge */}
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-0 left-0 w-[2.5px] origin-top bg-[#1655F8] transition-opacity duration-300"
                        style={{
                          transform: `scaleY(${fill.toFixed(3)})`,
                          opacity: on ? 1 : 0,
                        }}
                      />
                      <span
                        className={`block text-[16px] font-medium tracking-[-.015em] transition-colors duration-300 ${
                          on ? "text-[#141518]" : "text-[#6B707C] hover:text-[#141518]"
                        }`}
                      >
                        {title}
                      </span>
                      <span
                        className={`mt-1 block text-[15px] leading-[1.55] transition-colors duration-300 ${
                          on ? "text-[#585D69]" : "text-[#8A8F9B]"
                        }`}
                      >
                        {body}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div
            className="grid grid-cols-[2fr_1fr] gap-3 min-[701px]:gap-4"
            aria-label="The room, stage, lobby and stream screens, each showing its own output"
          >
            <div className="grid gap-3 min-[701px]:gap-4">
              <button
                type="button"
                onClick={() => select(0)}
                className={`${frame(0)} aspect-video`}
                aria-label="Preview room screen"
              >
                <Image
                  src="/images/kairo-worship-hero.webp"
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 40vw, 70vw"
                  className="object-cover brightness-[.34] blur-[1.5px]"
                />
                <div className="absolute inset-0 grid place-items-center px-[8%] text-center text-[5.2cqw] leading-[1.28] font-medium tracking-[-.02em] text-white">
                  <p>
                    Amazing grace, how sweet the sound
                    <br />
                    That saved a wretch like me
                  </p>
                </div>
              </button>

              <div className="grid grid-cols-2 gap-3 min-[701px]:gap-4">
                <button
                  type="button"
                  onClick={() => select(1)}
                  className={`${frame(1)} aspect-video bg-[#111216] text-white`}
                  aria-label="Preview stage screen"
                >
                  <div className="absolute inset-0 flex flex-col justify-between p-[6cqw]">
                    <div className="flex justify-between text-[6cqw] font-medium tabular-nums">
                      <span>10:42</span>
                      <span className="text-[#72A7FF]">04:59</span>
                    </div>
                    <div>
                      <p className="text-[7.5cqw] leading-[1.14] font-medium tracking-[-.02em]">
                        Amazing grace, how sweet the sound
                      </p>
                      <p className="mt-[2.5cqw] text-[5.8cqw] leading-[1.18] text-white/45">
                        That saved a wretch like me
                      </p>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => select(3)}
                  className={`${frame(3)} aspect-video`}
                  aria-label="Preview stream output"
                >
                  <Image
                    src="/images/kairo-worship-hero.webp"
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 20vw, 35vw"
                    className="object-cover object-[60%_30%] brightness-[.8]"
                  />
                  <span className="absolute top-[4cqw] right-[4cqw] rounded-[1.4cqw] bg-black/65 px-[2.4cqw] py-[0.8cqw] text-[4.2cqw] font-medium text-white">
                    NDI
                  </span>
                  <div className="absolute inset-x-[4.5cqw] bottom-[4.5cqw] rounded-[1.8cqw] bg-black/72 px-[4cqw] py-[2.4cqw] text-white backdrop-blur-xs">
                    <p className="text-[6cqw] leading-tight font-medium">Amazing grace</p>
                    <p className="mt-[0.5cqw] text-[4.8cqw] leading-tight text-white/70">
                      How sweet the sound
                    </p>
                  </div>
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => select(2)}
              className={`${frame(2)} bg-[linear-gradient(165deg,#0B1A4B_0%,#1655F8_62%,#4B8BFF_100%)] text-white`}
              aria-label="Preview lobby display"
            >
              <div className="absolute inset-0 flex flex-col justify-end p-[9cqw]">
                <p className="text-[6cqw] font-medium text-white/70">Today</p>
                <p className="mt-[2.5cqw] text-[15cqw] leading-[1.02] font-medium tracking-[-.04em]">
                  Welcome home.
                </p>
                <p className="mt-[4.5cqw] text-[7cqw] leading-[1.35] text-white/80">
                  Coffee in the foyer after the service.
                </p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
