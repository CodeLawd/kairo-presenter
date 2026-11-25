"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

const SENTENCE_1 =
  "…and that is the heart of the gospel. For God so loved the world that he gave his only Son,".split(" ");
const SENTENCE_2 =
  "and whoever believes in him should not perish. Turn with me to Romans five, verse eight.".split(" ");

const WORD_MS = 190;
const T1 = 300;
const JOHN_END = SENTENCE_1.indexOf("world") + 1;
const D1 = T1 + JOHN_END * WORD_MS + 500;
const COUNTDOWN_MS = 3000;
const L1 = D1 + COUNTDOWN_MS;
const T2 = T1 + SENTENCE_1.length * WORD_MS + 350;
const D2 = T2 + SENTENCE_2.length * WORD_MS + 400;
const M = D2 + 900;
const C2 = M + 1100;
const L2 = C2 + 150;
const END = C2 + 3600;
const LOOP = END + 700;
const SETTLED = L2 + 1000;

const SLIDES = {
  john: {
    reference: "John 3:16",
    text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
  },
  romans: {
    reference: "Romans 5:8",
    text: "But God commendeth his love toward us, in that, while we were yet sinners, Christ died for us.",
  },
} as const;

const STEPS = [
  {
    name: "Listening",
    detail: "Kairo takes a clean feed off the sound desk and transcribes the sermon live.",
  },
  {
    name: "Verse found",
    detail: "Direct references and paraphrases are matched and staged in your translation.",
  },
  {
    name: "On screen",
    detail: "Send with one click, or let Automation put it live after a short countdown.",
  },
] as const;

const STEP_AT = [T1 + 1800, D1 + 900, L2 + 700] as const;

const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));
const ease = (p: number): number => 1 - Math.pow(1 - p, 3);

export function OperatorDemo(): React.ReactElement {
  const rootRef = useRef<HTMLElement | null>(null);
  const [t, setT] = useState(0);
  const [paused, setPaused] = useState(false);

  const jumpRef = useRef<(at: number) => void>(() => {});
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setT(SETTLED);
      setPaused(true);
      jumpRef.current = (at: number): void => setT(at);
      return;
    }

    let visible = false;
    let start = performance.now();
    let currentT = 0;
    let timer: number | null = null;

    const tick = (): void => {
      if (pausedRef.current) return;
      const now = performance.now() - start;
      currentT = now % LOOP;
      setT(currentT);
    };
    const play = (): void => {
      if (timer !== null) return;
      start = performance.now() - currentT;
      tick();
      timer = window.setInterval(tick, 80);
    };
    const pause = (): void => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };

    jumpRef.current = (at: number): void => {
      currentT = at;
      start = performance.now() - at;
      setT(at);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) play();
        else pause();
      },
      { threshold: 0.2 },
    );
    observer.observe(root);
    return () => {
      pause();
      observer.disconnect();
    };
  }, []);

  const words1 = clamp(Math.floor((t - T1) / WORD_MS) + 1, 0, SENTENCE_1.length);
  const words2 = clamp(Math.floor((t - T2) / WORD_MS) + 1, 0, SENTENCE_2.length);
  const speaking =
    (t >= T1 && t < T1 + SENTENCE_1.length * WORD_MS) ||
    (t >= T2 && t < T2 + SENTENCE_2.length * WORD_MS);
  const level = speaking ? 0.45 + 0.55 * Math.abs(Math.sin(t / 95) * Math.sin(t / 41 + 1)) : 0.08;
  const johnHeard = t >= D1;
  const romansHeard = t >= D2;
  const live: keyof typeof SLIDES | null = t >= L2 ? "romans" : t >= L1 ? "john" : null;
  const countdown = Math.ceil((L1 - t) / 1000);
  const fading = t > END;
  const cursor = ease(clamp((t - M) / 900));
  const pressed = Math.abs(t - C2) < 180;
  const step = t < D1 ? 0 : t < L1 ? 1 : t < D2 ? 2 : t < L2 ? 1 : 2;

  return (
    <figure
      ref={rootRef}
      className="m-0 grid items-center gap-12 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:gap-16"
      aria-label="The Kairo operator view: a sermon is transcribed, John 3:16 is detected and sent automatically, then Romans 5:8 is sent by the operator"
    >
      {/* Left column: MindCloud-style minimalist editorial copy + underline tabs */}
      <div>
        <h2
          className="text-[clamp(32px,4vw,52px)] leading-[1.08] font-medium tracking-[-.035em] text-white text-balance"
          id="product-title"
        >
          Hears the verse,
          <br />
          <span className="mc-gradient-text">before you search.</span>
        </h2>

        <p className="mt-5 max-w-[44ch] text-[16px] leading-[1.62] text-[#9EA2AC]">
          Even when the pastor paraphrases without naming a chapter, Kairo
          catches the passage and stages it ready for your operator.
        </p>

        <div className="mt-10 border-b border-white/[.09]">
          <ol className="flex flex-wrap items-center gap-6 text-[14px]">
            {STEPS.map(({ name }, i) => {
              const on = step === i;
              return (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => jumpRef.current(STEP_AT[i])}
                    aria-current={on ? "step" : undefined}
                    className={`landing-press relative pb-3 font-medium transition-colors duration-200 ${
                      on ? "text-white" : "text-[#8E929B] hover:text-white/85"
                    }`}
                  >
                    {name}
                    <span
                      aria-hidden="true"
                      className={`mc-tab-underline absolute inset-x-0 bottom-0 h-[2px] rounded-full transition-opacity duration-200 ${
                        on ? "opacity-100" : "opacity-0"
                      }`}
                    />
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="mt-5 flex items-start justify-between gap-4">
          <p className="min-h-[3em] max-w-[42ch] text-[15px] leading-[1.6] text-[#B8BCC6]">
            {STEPS[step].detail}
          </p>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            className="landing-press shrink-0 pt-0.5 text-[13.5px] font-medium text-[#8E929B] transition-colors hover:text-white"
          >
            {paused ? "Play" : "Pause"}
          </button>
        </div>
      </div>

      {/* Right column: Minimalist floating operator card (clean, zero clutter) */}
      <div
        className="overflow-hidden rounded-[22px] border border-white/[.09] bg-[#1C1D22] p-5 text-[14px] text-[#F2F3F7] shadow-[0_40px_100px_-32px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.08)] sm:p-6"
        aria-hidden="true"
      >
        <div className={`space-y-4 transition-opacity duration-500 ${fading ? "opacity-0" : "opacity-100"}`}>
          {/* Live Program Preview (top focal piece) */}
          <div className="relative aspect-video overflow-hidden rounded-xl bg-black ring-1 ring-white/[.09]">
            <Image
              src="/images/kairo-worship-hero.webp"
              alt=""
              fill
              sizes="(min-width: 1024px) 48vw, 92vw"
              className="object-cover brightness-[.32] blur-[2px]"
            />
            <span className="absolute top-3.5 left-3.5 z-1 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[12px] font-medium text-white/90 backdrop-blur-xs">
              <i className="size-1.5 rounded-full bg-red-500" />
              On air
            </span>

            <Slide shown={live === null}>
              <p className="text-[clamp(18px,2vw,26px)] font-medium tracking-[-.02em] text-white">
                The Heart of the Gospel
              </p>
              <p className="mt-1.5 text-[12px] text-white/60">Sermon · John 3</p>
            </Slide>

            {(["john", "romans"] as const).map((key) => (
              <Slide key={key} shown={live === key}>
                <p className="max-w-[44ch] text-[clamp(13px,1.2vw,16px)] leading-[1.48] font-medium text-white">
                  {SLIDES[key].text}
                </p>
                <p className="mt-2.5 text-[12px] text-white/65">
                  {SLIDES[key].reference} · KJV
                </p>
              </Slide>
            ))}
          </div>

          {/* Minimal live transcript + staged verse strip below */}
          <div className="grid gap-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            {/* Live transcript */}
            <div className="flex min-h-[124px] flex-col justify-between rounded-xl border border-white/[.06] bg-[#16171C] p-4">
              <div className="flex items-center justify-between text-[12.5px] text-[#8E929B]">
                <span>Live transcript</span>
                <Waveform level={level} t={t} />
              </div>
              <p className="mt-2.5 line-clamp-3 text-[13.5px] leading-[1.6] text-[#8E929B]">
                {SENTENCE_1.slice(0, words1).map((word, i) => {
                  const inMatch = johnHeard && i >= SENTENCE_1.indexOf("God") && i < JOHN_END;
                  return (
                    <span
                      key={i}
                      className={inMatch ? "rounded-[3px] bg-[#5C9BFF]/24 px-0.5 text-white" : undefined}
                    >
                      {word}{" "}
                    </span>
                  );
                })}
                {SENTENCE_2.slice(0, words2).map((word, i) => {
                  const inMatch = romansHeard && i >= SENTENCE_2.indexOf("Romans");
                  return (
                    <span
                      key={i}
                      className={inMatch ? "rounded-[3px] bg-[#5C9BFF]/24 px-0.5 text-white" : "text-[#D4D7DF]"}
                    >
                      {word}{" "}
                    </span>
                  );
                })}
                {speaking && (
                  <i className="ml-0.5 inline-block h-3.5 w-px translate-y-0.5 bg-[#8AB4FF] motion-safe:animate-pulse" />
                )}
              </p>
            </div>

            {/* Active staged Scripture card */}
            <div className="flex min-h-[124px] flex-col justify-center rounded-xl border border-white/[.06] bg-[#16171C] p-4">
              {romansHeard ? (
                <div className="animate-[demo-card-in_.35s_cubic-bezier(.22,1,.36,1)]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[14.5px] font-medium text-white">{SLIDES.romans.reference}</span>
                    {live === "romans" ? (
                      <OnScreen />
                    ) : (
                      <span
                        className={`relative inline-flex h-7 items-center rounded-md px-3 text-[12px] font-medium text-white transition-transform ${
                          pressed ? "scale-95 bg-[#1245CC]" : "bg-[#1655F8]"
                        }`}
                      >
                        Send
                        {t >= M && (
                          <svg
                            viewBox="0 0 16 16"
                            className="pointer-events-none absolute top-1/2 left-1/2 size-4"
                            style={{
                              transform: `translate(${(1 - cursor) * 110}px, ${(1 - cursor) * 70}px)`,
                              opacity: cursor > 0.02 ? 1 : 0,
                            }}
                          >
                            <path
                              d="M2 1.5 L2 13 L5.2 10.2 L7.4 14.6 L9.4 13.6 L7.2 9.4 L11.6 9.2 Z"
                              fill="#FFFFFF"
                              stroke="#16161A"
                              strokeWidth="1"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[13px] leading-[1.52] text-[#A4A8B3]">
                    {SLIDES.romans.text}
                  </p>
                </div>
              ) : johnHeard ? (
                <div className="animate-[demo-card-in_.35s_cubic-bezier(.22,1,.36,1)]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[14.5px] font-medium text-white">{SLIDES.john.reference}</span>
                    {live === "john" ? (
                      <OnScreen />
                    ) : (
                      <span className="text-[12px] tabular-nums text-[#8AB4FF]">
                        Sending in {countdown}…
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[13px] leading-[1.52] text-[#A4A8B3]">
                    {SLIDES.john.text}
                  </p>
                </div>
              ) : (
                <p className="text-center text-[13.5px] text-[#7D818B]">
                  Listening for Scripture…
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}

function Waveform({ level, t }: { level: number; t: number }): React.ReactElement {
  return (
    <span className="flex h-3.5 items-center gap-[3px]">
      {Array.from({ length: 7 }, (_, i) => {
        const h = 0.18 + level * 0.82 * Math.abs(Math.sin(t / 110 + i * 1.5));
        return (
          <i
            key={i}
            className="w-[2px] rounded-full bg-[#8AB4FF]/85 transition-[height] duration-75"
            style={{ height: `${Math.round(h * 100)}%` }}
          />
        );
      })}
    </span>
  );
}

function Slide({ shown, children }: { shown: boolean; children: React.ReactNode }): React.ReactElement {
  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center px-[8%] text-center transition-opacity duration-300 ease-out ${shown ? "opacity-100" : "opacity-0"}`}
    >
      {children}
    </div>
  );
}

function OnScreen(): React.ReactElement {
  return (
    <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#8AB4FF]">
      <i className="size-1.5 rounded-full bg-[#8AB4FF]" />
      On screen
    </span>
  );
}
