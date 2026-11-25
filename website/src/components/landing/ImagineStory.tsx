"use client";

import { useState } from "react";
import Image from "next/image";
import { usePinnedStages } from "@/components/landing/usePinnedStages";

/**
 * Kairo Imagine showcase: fluid sticky scroll on desktop (graceful click tabs
 * everywhere) with bespoke generated visuals for worship backgrounds, sermon
 * series graphics, and an authentic multi-slide presentation deck editor.
 */

const SCENES = [
  {
    tab: "Worship backgrounds",
    prompt: "Warm golden-hour sanctuary light rays, subtle haze, 16:9",
    body: "Generate widescreen motion-ready stills matched to your room lighting, then drop lyrics straight on top.",
    badge: "16:9 Background · Ready for lyrics",
  },
  {
    tab: "Sermon graphics",
    prompt: "Dawn breaking over a dark ocean horizon, warm gold light, sermon series title",
    body: "Create sermon series title cards and announcement visuals from a short prompt without leaving Kairo.",
    badge: "Series Artwork · Editable in Kairo",
  },
  {
    tab: "Slide decks",
    prompt: "Turn Sunday's Romans 8 sermon notes into a 4-slide presentation deck",
    body: "Draft a cohesive presentation deck from your sermon outline, then refine every slide and verse in your booth.",
    badge: "4 Slides · Presentation deck",
  },
] as const;

const DECK_SLIDES = [
  {
    num: "01",
    kicker: "Sunday Series · Romans 8",
    title: "More Than Conquerors",
    body: "Finding steady hope when life doesn't go to plan.",
    align: "left" as const,
  },
  {
    num: "02",
    kicker: "Romans 8:28 · KJV",
    title: "All things work together for good",
    body: "To them that love God, to them who are the called according to his purpose.",
    align: "center" as const,
  },
  {
    num: "03",
    kicker: "Point 1",
    title: "Hope holds when plans change",
    body: "God's faithfulness is not tied to our predictability.",
    align: "left" as const,
  },
  {
    num: "04",
    kicker: "Closing Prayer",
    title: "Nothing can separate us",
    body: "Romans 8:38–39 · Benediction & worship response",
    align: "center" as const,
  },
] as const;

const container =
  "mx-auto w-[calc(100%-40px)] max-w-[1200px] md:w-[calc(100%-64px)] xl:w-[calc(100%-96px)]";

export function ImagineStory(): React.ReactElement {
  const {
    ref,
    active: pinnedActive,
    stageProgress,
    enhanced,
    travel,
    goTo,
  } = usePinnedStages(SCENES.length);
  const [manualActive, setManualActive] = useState(0);
  const [selectedSlide, setSelectedSlide] = useState<number | null>(null);

  const active = enhanced ? pinnedActive : manualActive;
  const select = (i: number): void => {
    if (enhanced) goTo(i);
    else setManualActive(i);
  };

  // While scrolling through the Slide decks stage, advance through the slides smoothly
  // unless the user manually clicked a thumbnail.
  const deckSlideIdx =
    selectedSlide !== null
      ? selectedSlide
      : active === 2 && enhanced
        ? Math.min(3, Math.floor(stageProgress * 4))
        : 1;
  const currentSlide = DECK_SLIDES[deckSlideIdx];

  return (
    <section
      ref={ref}
      id="imagine"
      aria-labelledby="imagine-title"
      className="relative bg-[#16161A] text-white"
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
          className={`${container} grid w-full items-center gap-12 min-[1024px]:grid-cols-[minmax(0,.82fr)_minmax(0,1.18fr)] min-[1024px]:gap-16`}
        >
          {/* Left column: editorial copy + fluid gradient-underlined tabs */}
          <div>
            <h2
              className="text-[clamp(32px,4vw,52px)] leading-[1.08] font-medium tracking-[-.035em] text-white text-balance"
              id="imagine-title"
            >
              Describe Sunday&apos;s visual,
              <br />
              <span className="mc-gradient-text">Imagine builds it.</span>
            </h2>

            <p className="mt-5 max-w-[46ch] text-[16px] leading-[1.62] text-[#9EA2AC]">
              Generate worship backgrounds, sermon graphics, and slide decks
              from a prompt, then refine every detail right inside Kairo.
            </p>

            <ol
              className="mt-9 flex flex-wrap gap-x-6 gap-y-2 border-b border-white/[.09] text-[14px]"
              aria-label="Kairo Imagine examples"
            >
              {SCENES.map(({ tab }, i) => {
                const on = active === i;
                const fill = enhanced
                  ? on
                    ? Math.max(0.1, stageProgress)
                    : 0
                  : on
                    ? 1
                    : 0;
                return (
                  <li key={tab}>
                    <button
                      type="button"
                      onClick={() => select(i)}
                      aria-current={on ? "step" : undefined}
                      className={`landing-press relative pb-3 font-medium transition-colors duration-250 ${
                        on ? "text-white" : "text-[#8E929B] hover:text-white/85"
                      }`}
                    >
                      {tab}
                      <span
                        aria-hidden="true"
                        className="mc-tab-underline absolute inset-x-0 bottom-0 h-[2px] origin-left rounded-full transition-opacity duration-250"
                        style={{
                          transform: `scaleX(${fill.toFixed(3)})`,
                          opacity: on ? 1 : 0,
                        }}
                      />
                    </button>
                  </li>
                );
              })}
            </ol>

            <p className="mt-5 min-h-[3.2em] max-w-[46ch] text-[15px] leading-[1.6] text-[#B8BCC6]">
              {SCENES[active].body}
            </p>

            <p className="mt-6 text-[13.5px] text-[#7D818B]">
              Connect your own OpenAI API key in Kairo. Stored securely in your OS keychain.
            </p>
          </div>

          {/* Right column: Imagine studio canvas with bespoke generated imagery */}
          <div className="overflow-hidden rounded-[22px] border border-white/[.09] bg-[#1C1D22] shadow-[0_40px_100px_-32px_rgba(0,0,0,0.88),inset_0_1px_0_rgba(255,255,255,0.08)]">
            {/* Prompt bar */}
            <div className="border-b border-white/[.07] bg-[#212228] px-5 py-4">
              <div className="flex items-center justify-between gap-3 text-[12.5px] text-[#8E929B]">
                <span className="font-medium text-white/90">Kairo Imagine</span>
                <span>{SCENES[active].badge}</span>
              </div>
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/[.09] bg-[#16171C] px-4 py-3 text-[14px] text-[#E4E7EE]">
                <span className="size-2 shrink-0 rounded-full bg-[#5C9BFF]" />
                <span className="truncate">{SCENES[active].prompt}</span>
              </div>
            </div>

            {/* Output stage: 3 layered bespoke visual artifacts */}
            <div className="p-5">
              <div className="landing-view relative aspect-[16/10.5] w-full overflow-hidden rounded-xl bg-[#0D0F15] ring-1 ring-white/[.09]">
                {/* Artifact 0: Bespoke Worship Background + crisp overlaid lyrics */}
                <ArtifactLayer show={active === 0}>
                  <Image
                    src="/images/imagine-worship-bg.jpg"
                    alt="Generated golden-hour worship projection background"
                    fill
                    sizes="(min-width: 1024px) 48vw, 92vw"
                    className="object-cover"
                  />
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_65%_55%_at_50%_50%,rgba(6,8,16,0.32),rgba(6,8,16,0.62)_100%)]" />
                  <div className="absolute inset-0 flex flex-col items-center justify-center px-[10%] text-center">
                    <p className="text-[4.6cqw] leading-[1.26] font-medium tracking-[-.02em] text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.65)]">
                      Way maker, miracle worker,
                      <br />
                      promise keeper, light in the darkness
                    </p>
                  </div>
                </ArtifactLayer>

                {/* Artifact 1: Bespoke Sermon Series Artwork + editorial typography */}
                <ArtifactLayer show={active === 1}>
                  <Image
                    src="/images/imagine-sermon-graphic.jpg"
                    alt="Generated sermon series graphic over ocean dawn"
                    fill
                    sizes="(min-width: 1024px) 48vw, 92vw"
                    className="object-cover"
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,9,22,0.72)_0%,rgba(5,9,22,0.28)_55%,rgba(5,9,22,0.12)_100%)]" />
                  <div className="absolute inset-0 flex flex-col justify-between p-[7cqw] text-left">
                    <span className="text-[2.1cqw] font-medium tracking-[.16em] text-[#B9D4FF] uppercase">
                      Sunday Series · John 3
                    </span>
                    <div>
                      <p className="max-w-[12ch] text-[7.4cqw] leading-[1.02] font-medium tracking-[-.035em] text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.5)]">
                        The Heart of the Gospel.
                      </p>
                      <p className="mt-[2.2cqw] text-[2.3cqw] text-white/80">
                        Grace Community · 9:00 AM &amp; 11:00 AM
                      </p>
                    </div>
                  </div>
                </ArtifactLayer>

                {/* Artifact 2: Authentic 16:9 Presentation Slide Canvas + Bottom Filmstrip */}
                <ArtifactLayer show={active === 2}>
                  <div className="flex h-full flex-col justify-between bg-[#121319] p-[3.2cqw]">
                    {/* Active 16:9 presentation slide canvas */}
                    <div className="relative flex-1 overflow-hidden rounded-[1.4cqw] ring-1 ring-white/15 shadow-[0_18px_40px_-14px_rgba(0,0,0,0.8)]">
                      <Image
                        src="/images/imagine-slide-deck.jpg"
                        alt="Generated sermon slide deck background"
                        fill
                        sizes="(min-width: 1024px) 44vw, 88vw"
                        className="object-cover"
                      />
                      <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(10,12,18,0.68)_0%,rgba(10,12,18,0.42)_65%,rgba(10,12,18,0.28)_100%)]" />

                      <div
                        className={`relative z-1 flex h-full flex-col justify-center px-[7cqw] py-[5cqw] ${
                          currentSlide.align === "center" ? "items-center text-center" : "items-start text-left"
                        }`}
                      >
                        <span className="text-[2cqw] font-medium tracking-[.12em] text-[#E6C596] uppercase">
                          {currentSlide.kicker}
                        </span>
                        <p className="mt-[1.4cqw] max-w-[18ch] text-[5cqw] leading-[1.1] font-medium tracking-[-.025em] text-white">
                          {currentSlide.title}
                        </p>
                        <p className="mt-[1.6cqw] max-w-[38ch] text-[2.3cqw] leading-[1.45] text-white/80">
                          {currentSlide.body}
                        </p>
                      </div>

                      <span className="absolute right-[3cqw] bottom-[2.2cqw] z-1 text-[1.8cqw] font-medium tabular-nums text-white/55">
                        {currentSlide.num} / 04
                      </span>
                    </div>

                    {/* Interactive bottom filmstrip of 4 crisp 16:9 slide thumbnails */}
                    <div className="mt-[2.4cqw] grid grid-cols-4 gap-[2cqw]">
                      {DECK_SLIDES.map((slide, idx) => {
                        const isCurrent = deckSlideIdx === idx;
                        return (
                          <button
                            key={slide.num}
                            type="button"
                            onClick={() => setSelectedSlide(idx)}
                            className={`relative aspect-video overflow-hidden rounded-[1cqw] text-left transition-[opacity,box-shadow,transform] duration-200 ${
                              isCurrent
                                ? "opacity-100 ring-2 ring-[#5C9BFF]"
                                : "opacity-55 ring-1 ring-white/15 hover:opacity-85"
                            }`}
                          >
                            <Image
                              src="/images/imagine-slide-deck.jpg"
                              alt=""
                              fill
                              sizes="120px"
                              className="object-cover brightness-[.55]"
                            />
                            <div className="relative z-1 flex h-full flex-col justify-between p-[1.4cqw]">
                              <span className="text-[1.4cqw] font-medium tabular-nums text-[#E6C596]">
                                {slide.num}
                              </span>
                              <p className="line-clamp-2 text-[1.65cqw] leading-[1.15] font-medium text-white">
                                {slide.title}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </ArtifactLayer>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ArtifactLayer({
  show,
  children,
}: {
  show: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className={`absolute inset-0 transition-[opacity,transform,filter] duration-500 ease-[var(--ease-out)] motion-reduce:transition-none ${
        show
          ? "scale-100 opacity-100 blur-0"
          : "pointer-events-none scale-[1.02] opacity-0 blur-[6px]"
      }`}
    >
      {children}
    </div>
  );
}
