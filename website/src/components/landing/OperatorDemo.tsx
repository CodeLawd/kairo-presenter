"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

/**
 * The operator view, played as a short loop: a sermon streams into the
 * transcript, Kairo hears John 3:16 and sends it on its own (Automation), then
 * Romans 5:8 arrives and the operator sends it with one click. Three steps above
 * the window light up as the story moves, with a line saying what just happened.
 * Everything is derived from one clock, `t`, so the story stays in step.
 *
 * Plays only while on screen; with reduced motion it shows the finished state.
 */

const SENTENCE_1 =
  "…and that is the heart of the gospel. For God so loved the world that he gave his only Son,".split(" ");
const SENTENCE_2 =
  "and whoever believes in him should not perish. Turn with me to Romans five, verse eight.".split(" ");

const WORD_MS = 190;
const T1 = 300; // first sentence starts
const JOHN_END = SENTENCE_1.indexOf("world") + 1; // "God so loved the world" heard
const D1 = T1 + JOHN_END * WORD_MS + 500; // John 3:16 detected
const COUNTDOWN_MS = 3000; // Automation's countdown before it goes live
const L1 = D1 + COUNTDOWN_MS; // John 3:16 live
const T2 = T1 + SENTENCE_1.length * WORD_MS + 350; // second sentence starts
const D2 = T2 + SENTENCE_2.length * WORD_MS + 400; // Romans 5:8 detected
const M = D2 + 900; // cursor sets off
const C2 = M + 1100; // operator clicks Send
const L2 = C2 + 150; // Romans 5:8 live
const END = C2 + 3600; // hold, then fade
const LOOP = END + 700;
const SETTLED = L2 + 1000; // the still frame for reduced motion

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

const STEPS = ["Listening", "Verse found", "On screen"] as const;

const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));
const ease = (p: number): number => 1 - Math.pow(1 - p, 3);

export function OperatorDemo(): React.ReactElement {
  const rootRef = useRef<HTMLElement | null>(null);
  const [t, setT] = useState(0);
  // Total time played, so the service clock keeps counting across loops.
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setT(SETTLED);
      return;
    }
    let start = performance.now();
    let played = 0;
    let timer: number | null = null;
    const tick = (): void => {
      const now = performance.now() - start;
      setT(now % LOOP);
      setElapsed(played + now);
    };
    const play = (): void => {
      if (timer !== null) return;
      start = performance.now();
      tick();
      timer = window.setInterval(tick, 80);
    };
    const pause = (): void => {
      if (timer !== null) window.clearInterval(timer);
      if (timer !== null) played += performance.now() - start;
      timer = null;
    };
    const observer = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting ? play() : pause()),
      { threshold: 0.25 },
    );
    if (rootRef.current) observer.observe(rootRef.current);
    return () => {
      pause();
      observer.disconnect();
    };
  }, []);

  // ── Derived from the clock ────────────────────────────────────────────────
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
  const seconds = 32 * 60 + 14 + Math.floor(elapsed / 1000);
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  // Which step the story is on, and the line that says so.
  const [step, caption] =
    t < D1
      ? [0, "Kairo listens to the sermon as it's preached."]
      : t < L1
        ? [1, "It hears John 3:16 and gets it ready on its own."]
        : t < D2
          ? [2, "John 3:16 goes up on every screen."]
          : t < L2
            ? [1, "Romans 5:8 is ready. The operator decides."]
            : [2, "One click, and it's on screen."];

  return (
    <figure
      ref={rootRef}
      className="m-0"
      aria-label="The Kairo operator view: a sermon is transcribed, John 3:16 is detected and sent automatically, then Romans 5:8 is sent by the operator"
    >
      {/* The story, in three steps and one line. */}
      <div className="mb-6 flex flex-col gap-4 min-[901px]:mb-8 min-[901px]:flex-row min-[901px]:items-center min-[901px]:justify-between" aria-hidden="true">
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((name, i) => (
            <li
              key={name}
              className={`flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors duration-500 ${
                step === i
                  ? "border-[#3B6BFF] bg-[#3B6BFF]/15 text-[#F2F3F7]"
                  : "border-white/10 text-[#7D8399]"
              }`}
            >
              <span
                className={`grid size-5 place-items-center rounded-full text-[11px] tabular-nums transition-colors duration-500 ${
                  step === i ? "bg-[#3B6BFF] text-white" : "bg-white/[.06] text-[#7D8399]"
                }`}
              >
                {i + 1}
              </span>
              {name}
            </li>
          ))}
        </ol>
        <p key={caption} className="animate-[demo-card-in_.45s_cubic-bezier(.16,1,.3,1)] text-[15px] text-[#C9CEDF] min-[901px]:text-right">
          {caption}
        </p>
      </div>

      {/* The app window. */}
      <div className="overflow-hidden rounded-2xl border border-white/[.08] bg-[#0F1117] text-[14px] text-[#F2F3F7]" aria-hidden="true">
        <div className="flex h-12 items-center gap-4 border-b border-white/[.06] px-4 text-[13px] text-[#A3A9BD]">
          <span className="flex gap-1.5">
            <i className="size-3 rounded-full bg-white/15" />
            <i className="size-3 rounded-full bg-white/15" />
            <i className="size-3 rounded-full bg-white/15" />
          </span>
          <span className="font-semibold text-[#F2F3F7]">Sunday Service</span>
          <span className="flex items-center gap-1.5 rounded-md bg-white/[.05] px-2 py-1 font-mono text-[12px] tabular-nums text-[#F2F3F7]">
            <i className="size-1.5 rounded-full bg-red-500 motion-safe:animate-pulse" />
            {clock}
          </span>
          <span className="ml-auto hidden items-center gap-2 min-[560px]:flex">
            Automation
            <span className="relative h-5 w-9 rounded-full bg-[#3B6BFF]">
              <span className="absolute top-0.5 right-0.5 size-4 rounded-full bg-white" />
            </span>
          </span>
        </div>

        <div
          className={`grid gap-2 p-2 transition-opacity duration-500 min-[701px]:grid-cols-2 min-[1001px]:grid-cols-[minmax(0,.9fr)_minmax(0,1fr)_minmax(0,1.25fr)] ${fading ? "opacity-0" : "opacity-100"}`}
        >
          {/* Transcript: the words as they're spoken, with the matches lit. */}
          <section className="flex min-h-[170px] flex-col rounded-xl bg-[#151821] p-4 min-[701px]:min-h-[380px]">
            <PanelHeader title="Transcript">
              <Waveform level={level} t={t} />
            </PanelHeader>
            <div className="mt-3 flex min-h-0 flex-1 flex-col justify-end overflow-hidden min-[701px]:justify-start">
              <p className="leading-[1.7] text-[#8E94AA]">
                {SENTENCE_1.slice(0, words1).map((word, i) => {
                  const inMatch = johnHeard && i >= SENTENCE_1.indexOf("God") && i < JOHN_END;
                  return (
                    <span key={i} className={inMatch ? "rounded bg-[#3B6BFF]/25 text-white" : undefined}>
                      {word}{" "}
                    </span>
                  );
                })}
                {SENTENCE_2.slice(0, words2).map((word, i) => {
                  const inMatch = romansHeard && i >= SENTENCE_2.indexOf("Romans");
                  return (
                    <span key={i} className={inMatch ? "rounded bg-[#3B6BFF]/25 text-white" : "text-[#C9CEDF]"}>
                      {word}{" "}
                    </span>
                  );
                })}
                {speaking && <i className="ml-0.5 inline-block h-4 w-px translate-y-0.5 bg-[#8AB4FF] motion-safe:animate-pulse" />}
              </p>
            </div>
          </section>

          {/* Scripture: what Kairo heard, ready to send. */}
          <section className="flex flex-col rounded-xl bg-[#151821] p-4">
            <PanelHeader title="Scripture">
              <span className="rounded-full bg-white/[.06] px-2 py-0.5 text-[12px] tabular-nums text-[#A3A9BD]">
                {Number(johnHeard) + Number(romansHeard)} found
              </span>
            </PanelHeader>
            <div className="mt-3 grid gap-2">
              {romansHeard && (
                <VerseCard
                  reference={SLIDES.romans.reference}
                  text={SLIDES.romans.text}
                  match="94% match"
                  live={live === "romans"}
                  action={
                    live === "romans" ? (
                      <OnScreen />
                    ) : (
                      <span
                        className={`relative inline-flex h-7 items-center rounded-md px-3 text-[12px] font-semibold text-white transition-transform ${pressed ? "scale-95 bg-[#2F5BE0]" : "bg-[#3B6BFF]"}`}
                      >
                        Send
                        {t >= M && (
                          <svg
                            viewBox="0 0 16 16"
                            className="pointer-events-none absolute top-1/2 left-1/2 size-4"
                            style={{ transform: `translate(${(1 - cursor) * 150}px, ${(1 - cursor) * 90}px)`, opacity: cursor > 0.02 ? 1 : 0 }}
                          >
                            <path d="M2 1.5 L2 13 L5.2 10.2 L7.4 14.6 L9.4 13.6 L7.2 9.4 L11.6 9.2 Z" fill="#FFFFFF" stroke="#0F1117" strokeWidth="1" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                    )
                  }
                />
              )}
              {johnHeard && (
                <VerseCard
                  reference={SLIDES.john.reference}
                  text={SLIDES.john.text}
                  match="97% match"
                  live={live === "john"}
                  action={
                    live === "john" ? (
                      <OnScreen />
                    ) : live === "romans" ? (
                      <span className="text-[12px] text-[#6F7590]">Shown</span>
                    ) : (
                      <span className="text-[12px] tabular-nums text-[#8AB4FF]">Sending in {countdown}…</span>
                    )
                  }
                />
              )}
              {!johnHeard && (
                <div className="grid place-items-center rounded-lg border border-dashed border-white/10 px-4 py-9 text-center text-[13px] text-[#6F7590]">
                  Verses appear here as they&apos;re heard.
                </div>
              )}
            </div>
          </section>

          {/* Live: what the room sees, and where it's going. */}
          <section className="flex flex-col gap-3 rounded-xl bg-[#151821] p-4 min-[701px]:col-span-2 min-[1001px]:col-span-1">
            <PanelHeader title="Live">
              <span className="flex items-center gap-1.5 text-[12px] text-[#A3A9BD]">
                <i className="size-1.5 rounded-full bg-red-500" /> On air
              </span>
            </PanelHeader>
            <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
              <Image
                src="/images/kairo-worship-hero.webp"
                alt=""
                fill
                sizes="(min-width: 1001px) 30vw, 90vw"
                className="object-cover brightness-[.28] blur-[3px]"
              />
              <Slide shown={live === null}>
                <p className="text-[clamp(16px,2vw,24px)] font-medium tracking-[-.02em] text-white">The Heart of the Gospel</p>
                <p className="mt-1.5 text-[11px] tracking-[.14em] text-white/60 uppercase">Sermon · John 3</p>
              </Slide>
              {(["john", "romans"] as const).map((key) => (
                <Slide key={key} shown={live === key}>
                  <p className="text-[clamp(11px,1.15vw,15px)] leading-[1.4] font-medium text-white">{SLIDES[key].text}</p>
                  <p className="mt-2 text-[10px] tracking-[.14em] text-white/60 uppercase">{SLIDES[key].reference} · KJV</p>
                </Slide>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {["Projector", "Stage", "Stream"].map((name) => (
                <span key={name} className="flex items-center gap-1.5 rounded-md bg-white/[.05] px-2.5 py-1.5 text-[12px] text-[#C9CEDF]">
                  <i className="size-1.5 rounded-full bg-[#8AB4FF]" />
                  {name}
                </span>
              ))}
            </div>
          </section>
        </div>
      </div>
    </figure>
  );
}

function PanelHeader({ title, children }: { title: string; children?: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex h-7 items-center justify-between gap-3">
      <span className="text-[13px] font-semibold text-[#F2F3F7]">{title}</span>
      {children}
    </div>
  );
}

/** A small live waveform: bars rise with the speaker's level. */
function Waveform({ level, t }: { level: number; t: number }): React.ReactElement {
  return (
    <span className="flex h-4 items-center gap-[3px]">
      {Array.from({ length: 7 }, (_, i) => {
        const h = 0.18 + level * 0.82 * Math.abs(Math.sin(t / 110 + i * 1.7));
        return (
          <i
            key={i}
            className="w-[3px] rounded-full bg-[#8AB4FF] transition-[height] duration-75"
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
      className={`absolute inset-0 flex flex-col items-center justify-center px-[8%] text-center transition-opacity duration-500 ${shown ? "opacity-100" : "opacity-0"}`}
    >
      {children}
    </div>
  );
}

function OnScreen(): React.ReactElement {
  return (
    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[#8AB4FF]">
      <i className="size-1.5 rounded-full bg-[#8AB4FF]" /> On screen
    </span>
  );
}

function VerseCard({ reference, text, match, live, action }: {
  reference: string;
  text: string;
  match: string;
  live: boolean;
  action: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className={`animate-[demo-card-in_.45s_cubic-bezier(.16,1,.3,1)] rounded-lg border bg-[#1C2030] px-3.5 py-3 transition-colors duration-300 ${live ? "border-[#3B6BFF]" : "border-white/[.06]"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <b className="text-[15px] font-semibold text-[#F2F3F7]">{reference}</b>
        {action}
      </div>
      <p className="mt-1.5 line-clamp-2 text-[13px] leading-[1.5] text-[#A3A9BD]">{text}</p>
      <p className="mt-2 text-[11px] text-[#6F7590]">{match}</p>
    </div>
  );
}
