"use client";

import Image from "next/image";
import { usePinnedStages } from "@/components/landing/usePinnedStages";

/**
 * MindCloud-inspired asymmetric bento showcase ("Pastors focus on the message.
 * Operators rely on Kairo.") with subtle outer edge-peeking ghost cards and a
 * fluid sticky-scroll spotlight progression across the 5 booth pillars.
 */

const container =
  "mx-auto w-[calc(100%-40px)] max-w-[1200px] md:w-[calc(100%-64px)] xl:w-[calc(100%-96px)]";

export function SundayBento(): React.ReactElement {
  const { ref, active, progress, enhanced, travel, goTo } = usePinnedStages(3);

  // Subtle fluid vertical parallax for the bento grid as you scroll through it.
  const drift = enhanced ? (0.5 - progress) * 14 : 0;

  const cardTone = (group: number): string => {
    if (!enhanced) return "border-[#EAECEF] bg-[#FAFAFC]";
    return active === group
      ? "border-[#1655F8]/35 bg-white shadow-[0_22px_50px_-24px_rgba(20,86,246,0.22)]"
      : "border-[#EAECEF] bg-[#FAFAFC] opacity-85";
  };

  return (
    <section
      ref={ref}
      className="relative overflow-x-clip border-t border-[#EAECEF] bg-white"
      aria-labelledby="features-title"
      style={enhanced ? { minHeight: travel } : undefined}
    >
      <div
        className={
          enhanced
            ? "sticky top-0 flex min-h-screen flex-col justify-center py-16"
            : "py-[clamp(80px,9vw,124px)]"
        }
      >
        {/* Centered MindCloud two-tone heading */}
        <div className={`${container} text-center`}>
          <h2
            className="text-[clamp(30px,3.8vw,46px)] leading-[1.1] font-medium tracking-[-.035em] text-[#141518] text-balance"
            id="features-title"
          >
            Everything else Sunday needs.{" "}
            <span className="text-[#787D8A]">Built for the booth.</span>
          </h2>
        </div>

        {/* Asymmetric 3-column bento flanked by faint edge-peeking ghost cards */}
        <div className="relative mt-12">
          {/* Faint left/right edge-peeking architectural cards (MindCloud signature) */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-4 bottom-4 -left-44 hidden w-48 rounded-2xl border border-[#EAECEF] bg-[#FAFAFC]/70 xl:block"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-4 bottom-4 -right-44 hidden w-48 rounded-2xl border border-[#EAECEF] bg-[#FAFAFC]/70 xl:block"
          />

          <div
            className={container}
            style={
              enhanced
                ? { transform: `translate3d(0, ${drift.toFixed(1)}px, 0)` }
                : undefined
            }
          >
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              {/* Row 1 Left: Light card (Bilingual lyrics + offline Bibles) */}
              <article
                onClick={() => enhanced && goTo(0)}
                className={`flex flex-col justify-between rounded-2xl border p-7 transition-[border-color,background-color,box-shadow,opacity] duration-500 ${cardTone(0)} ${enhanced ? "cursor-pointer" : ""}`}
              >
                <div>
                  <p className="text-[14px] font-semibold tracking-[-.01em] text-[#141518]">
                    Bilingual &amp; Offline Bibles
                  </p>
                  <p className="mt-4 text-[16px] leading-[1.6] text-[#3F4450]">
                    Show a translated line under every lyric slide automatically.
                    KJV, BBE, and BSB are built right in for offline services,
                    with more translations via API.Bible.
                  </p>
                </div>
                <div className="mt-8 border-t border-[#EAECEF] pt-4 text-[13.5px]">
                  <span className="font-medium text-[#141518]">Lyrics &amp; Scripture</span>
                  <span className="ml-2 text-[#787D8A]">Zero internet needed</span>
                </div>
              </article>

              {/* Row 1 Wide Right (2 cols): Dark photographic hero card */}
              <article
                onClick={() => enhanced && goTo(1)}
                className={`relative isolate flex min-h-[290px] flex-col justify-between overflow-hidden rounded-2xl bg-[#111319] p-8 text-white transition-[box-shadow,transform] duration-500 lg:col-span-2 ${
                  enhanced && active === 1
                    ? "ring-2 ring-[#1655F8] shadow-[0_28px_70px_-24px_rgba(20,86,246,0.38)]"
                    : "ring-1 ring-black/10 shadow-[0_24px_60px_-28px_rgba(10,12,24,0.45)]"
                } ${enhanced ? "cursor-pointer" : ""}`}
              >
                <Image
                  src="/images/kairo-worship-hero.webp"
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 60vw, 95vw"
                  className="-z-2 object-cover object-center"
                />
                <div
                  className="pointer-events-none absolute inset-0 -z-1 bg-[linear-gradient(105deg,rgba(12,14,22,0.88)_0%,rgba(12,14,22,0.72)_55%,rgba(12,14,22,0.52)_100%)]"
                  aria-hidden="true"
                />

                <p className="text-[14px] font-semibold tracking-[-.01em] text-white/85">
                  Kairo 2.0 Native Engine
                </p>

                <p className="my-6 max-w-[38ch] text-[clamp(20px,2vw,26px)] leading-[1.35] font-medium tracking-[-.02em] text-white">
                  Run looping motion backgrounds, live camera inputs, and your
                  entire slide library smoothly offline—rebuilt natively for
                  Mac, Windows, and Linux.
                </p>

                <div className="flex items-center justify-between border-t border-white/15 pt-4 text-[13.5px] text-white/75">
                  <span>Offline media &amp; live cameras</span>
                  <span className="font-medium text-white">macOS · Windows · Linux</span>
                </div>
              </article>

              {/* Row 2: Three crisp light cards */}
              <article
                onClick={() => enhanced && goTo(2)}
                className={`flex flex-col justify-between rounded-2xl border p-7 transition-[border-color,background-color,box-shadow,opacity] duration-500 ${cardTone(2)} ${enhanced ? "cursor-pointer" : ""}`}
              >
                <div>
                  <p className="text-[14px] font-semibold tracking-[-.01em] text-[#141518]">
                    PowerPoint &amp; PDF Decks
                  </p>
                  <p className="mt-4 text-[15.5px] leading-[1.6] text-[#4E5360]">
                    Import sermon decks on Saturday and step cleanly through
                    every slide on Sunday morning with a standard clicker.
                  </p>
                </div>
                <p className="mt-7 border-t border-[#EAECEF] pt-4 text-[13.5px] text-[#787D8A]">
                  <span className="font-medium text-[#141518]">Sermon import</span> · Ready in seconds
                </p>
              </article>

              <article
                onClick={() => enhanced && goTo(2)}
                className={`flex flex-col justify-between rounded-2xl border p-7 transition-[border-color,background-color,box-shadow,opacity] duration-500 ${cardTone(2)} ${enhanced ? "cursor-pointer" : ""}`}
              >
                <div>
                  <p className="text-[14px] font-semibold tracking-[-.01em] text-[#141518]">
                    Stage Confidence Timers
                  </p>
                  <p className="mt-4 text-[15.5px] leading-[1.6] text-[#4E5360]">
                    Show countdowns, service clocks, next lyric lines, and team
                    notes exclusively on stage displays—never on the room screen.
                  </p>
                </div>
                <p className="mt-7 border-t border-[#EAECEF] pt-4 text-[13.5px] text-[#787D8A]">
                  <span className="font-medium text-[#141518]">Stage view</span> · Always in sync
                </p>
              </article>

              <article
                onClick={() => enhanced && goTo(2)}
                className={`flex flex-col justify-between rounded-2xl border p-7 transition-[border-color,background-color,box-shadow,opacity] duration-500 ${cardTone(2)} ${enhanced ? "cursor-pointer" : ""}`}
              >
                <div>
                  <p className="text-[14px] font-semibold tracking-[-.01em] text-[#141518]">
                    CCLI Song Reports
                  </p>
                  <p className="mt-4 text-[15.5px] leading-[1.6] text-[#4E5360]">
                    Every worship song shown during service is logged
                    automatically so quarterly CCLI reporting takes seconds.
                  </p>
                </div>
                <p className="mt-7 border-t border-[#EAECEF] pt-4 text-[13.5px] text-[#787D8A]">
                  <span className="font-medium text-[#141518]">Automatic logging</span> · Export ready
                </p>
              </article>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
