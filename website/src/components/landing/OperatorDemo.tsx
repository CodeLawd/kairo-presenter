"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The operator view, played as a short loop drawn from the real app's layout:
 * a sermon streams into the transcript, Kairo hears John 3:16 and sends it on
 * its own (Automation), then Romans 5:8 arrives and the operator sends it by
 * hand. Everything is derived from one clock, `t`, so the story stays in step.
 *
 * Plays only while on screen; with reduced motion it shows the finished state.
 */

const SENTENCE_1 =
  "…and that is the heart of the gospel. For God so loved the world that he gave his only Son,".split(" ");
const SENTENCE_2 =
  "and whoever believes in him should not perish. Turn with me to Romans five, verse eight.".split(" ");

const WORD_MS = 190;
const T1 = 600; // first sentence starts
const JOHN_END = SENTENCE_1.indexOf("world") + 1; // "God so loved the world" heard
const D1 = T1 + JOHN_END * WORD_MS + 500; // John 3:16 detected
const COUNTDOWN_MS = 3000; // Automation's countdown before it goes live
const L1 = D1 + COUNTDOWN_MS; // John 3:16 live
const T2 = T1 + SENTENCE_1.length * WORD_MS + 350; // second sentence starts
const D2 = T2 + SENTENCE_2.length * WORD_MS + 400; // Romans 5:8 detected
const M = D2 + 700; // cursor sets off
const C2 = M + 1100; // operator clicks Send
const L2 = C2 + 150; // Romans 5:8 live
const END = C2 + 3400; // hold, then fade
const LOOP = END + 700;
const SETTLED = L2 + 1000; // the still frame for reduced motion

const SLIDES = {
  john: {
    reference: "John 3:16",
    text: "For God so loved the world, that He gave His only begotten Son, that whoever believes in Him should not perish but have everlasting life.",
  },
  romans: {
    reference: "Romans 5:8",
    text: "But God demonstrates His own love toward us, in that while we were still sinners, Christ died for us.",
  },
} as const;

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
  const level = speaking
    ? 0.38 + 0.42 * Math.abs(Math.sin(t / 95) * Math.sin(t / 41 + 1))
    : 0.03;
  const johnHeard = t >= D1;
  const romansHeard = t >= D2;
  const live: keyof typeof SLIDES | null = t >= L2 ? "romans" : t >= L1 ? "john" : null;
  const countdown = Math.ceil((L1 - t) / 1000);
  const fading = t > END;
  const cursor = ease(clamp((t - M) / 900));
  const pressed = Math.abs(t - C2) < 180;
  const seconds = 12 * 60 + 31 + Math.floor(elapsed / 1000);
  const clock = `00:${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <figure
      ref={rootRef}
      className="m-0 overflow-hidden rounded-xl bg-[#11120D] text-[13px] text-[#ECE8E1] shadow-[0_40px_90px_-30px_#16161666]"
      aria-label="The Kairo operator view: a sermon is transcribed, John 3:16 is detected and sent automatically, then Romans 5:8 is sent by the operator"
    >
      {/* Title bar — the app's header: workspace, Automation, statuses, Clear. */}
      <div className="flex h-10 items-center gap-4 bg-[#24241E] px-3.5 text-xs text-[#ABA89F]">
        <span className="flex gap-1.5" aria-hidden="true">
          <i className="size-2.5 rounded-full bg-[#36362D]" />
          <i className="size-2.5 rounded-full bg-[#36362D]" />
          <i className="size-2.5 rounded-full bg-[#36362D]" />
        </span>
        <span className="font-semibold text-[#ECE8E1]">Operator</span>
        <span className="hidden items-center gap-2 min-[560px]:flex">
          Automation
          <span className="relative h-4 w-7 rounded-full bg-[#FFFBF4]" aria-hidden="true">
            <span className="absolute right-0.5 top-0.5 size-3 rounded-full bg-[#11120D]" />
          </span>
        </span>
        <span className="ml-auto flex items-center gap-4">
          <span className="hidden items-center gap-1.5 min-[560px]:flex">
            <i className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> Screens
          </span>
          <span className="hidden items-center gap-1.5 min-[560px]:flex">
            <i className={`size-1.5 rounded-full transition-colors ${speaking ? "bg-emerald-500" : "bg-[#565449]"}`} aria-hidden="true" /> Audio
          </span>
          <span className="rounded px-2 py-1 text-[#CCC9C1]">Clear</span>
        </span>
      </div>

      <div
        className={`grid min-h-[440px] grid-cols-1 transition-opacity duration-500 min-[701px]:grid-cols-[1.25fr_1fr] min-[981px]:grid-cols-[minmax(230px,0.9fr)_1.3fr_minmax(250px,1fr)] ${fading ? "opacity-0" : "opacity-100"}`}
      >
        {/* Transcript — session row, the words as they're spoken, the input meter. */}
        <section className="hidden min-h-0 flex-col bg-[#1F1F19] min-[981px]:flex" aria-hidden="true">
          <div className="flex h-11 items-center justify-between pl-4 pr-2.5">
            <span className="text-[12px] font-semibold text-[#ECE8E1]">Transcript</span>
            <span className="rounded-md bg-[#272720] px-2.5 py-1 text-[11px] font-semibold text-[#ECE8E1]">Pause</span>
          </div>
          <div className="mx-4 mb-2 flex items-center gap-3 rounded-lg bg-[#272720] py-1.5 pl-3 pr-2">
            <i className="size-2 rounded-full bg-red-500 motion-safe:animate-pulse" />
            <span className="font-mono text-[12px] tabular-nums text-[#FFFBF4]">{clock}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-[#ABA89F]">Sunday Service</span>
          </div>
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 space-y-2 px-4 py-3 text-[13px] leading-[1.7] text-[#ABA89F]">
              <p>
                {SENTENCE_1.slice(0, words1).map((word, i) => {
                  const inMatch = johnHeard && i >= SENTENCE_1.indexOf("God") && i < JOHN_END;
                  return (
                    <span key={i} className={inMatch ? "rounded-sm bg-[#2A3442] text-[#FFFBF4]" : undefined}>
                      {word}{" "}
                    </span>
                  );
                })}
              </p>
              <p className={words2 > 0 ? "text-[#ECE8E1]" : undefined}>
                {SENTENCE_2.slice(0, words2).map((word, i) => {
                  const inMatch = romansHeard && i >= SENTENCE_2.indexOf("Romans");
                  return (
                    <span key={i} className={inMatch ? "rounded-sm bg-[#2A3442] text-[#FFFBF4]" : undefined}>
                      {word}{" "}
                    </span>
                  );
                })}
                {speaking && <i className="ml-0.5 inline-block h-3.5 w-px translate-y-0.5 bg-[#6C91C2] motion-safe:animate-pulse" />}
              </p>
            </div>
            {/* The input meter, as in the app: rounded segments filling from below. */}
            <div className="flex w-6 flex-col items-center gap-2 py-3">
              <i className="size-1.5 rounded-full bg-[#36362D]" />
              <div className="flex w-1.5 flex-1 flex-col-reverse gap-[3px]">
                {Array.from({ length: 18 }, (_, i) => {
                  const lit = level >= (i + 1) / 18;
                  const tone = i >= 16 ? "bg-red-500" : i >= 12 ? "bg-[#FFFBF4]" : "bg-emerald-500";
                  return <i key={i} className={`min-h-0 w-full flex-1 rounded-[2px] transition-colors duration-75 ${lit ? tone : "bg-[#36362D]"}`} />;
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Detected — matches land as cards; the live one carries the blue outline. */}
        <section className="flex min-h-0 flex-col bg-[#11120D] p-4" aria-hidden="true">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-[#ECE8E1]">
              Detected <span className="ml-1 tabular-nums text-[#8C8980]">{Number(johnHeard) + Number(romansHeard)}</span>
            </span>
            <span className="text-[11px] text-[#8C8980]">{speaking ? "Listening…" : "Select to present"}</span>
          </div>
          <div className="grid gap-2.5">
            {romansHeard && (
              <DetectedCard
                reference={SLIDES.romans.reference}
                text={SLIDES.romans.text}
                source="Heard · 94%"
                live={live === "romans"}
                status={
                  live === "romans" ? (
                    <LiveBadge />
                  ) : (
                    <span
                      className={`relative inline-block rounded-md px-3 py-1 text-[11px] font-semibold transition-transform ${pressed ? "scale-95 bg-[#E7E4DC]" : "bg-[#FFFBF4]"} text-[#11120D]`}
                    >
                      Send
                      {t >= M && (
                        <svg
                          viewBox="0 0 16 16"
                          className="pointer-events-none absolute left-1/2 top-1/2 size-4 drop-shadow"
                          style={{ transform: `translate(${(1 - cursor) * 150}px, ${(1 - cursor) * 90}px)`, opacity: cursor > 0.02 ? 1 : 0 }}
                          aria-hidden="true"
                        >
                          <path d="M2 1.5 L2 13 L5.2 10.2 L7.4 14.6 L9.4 13.6 L7.2 9.4 L11.6 9.2 Z" fill="#FFFBF4" stroke="#11120D" strokeWidth="1" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                  )
                }
              />
            )}
            {johnHeard && (
              <DetectedCard
                reference={SLIDES.john.reference}
                text={SLIDES.john.text}
                source="Heard · 97%"
                live={live === "john"}
                status={
                  live === "john" ? (
                    <LiveBadge />
                  ) : live === "romans" ? (
                    <span className="text-[11px] text-[#8C8980]">Sent</span>
                  ) : (
                    <span className="text-[11px] tabular-nums text-[#CCC9C1]">Sending in {countdown}…</span>
                  )
                }
              />
            )}
            {!johnHeard && (
              <div className="grid place-items-center rounded-lg bg-[#1F1F19] px-4 py-10 text-center">
                <p className="text-[12px] text-[#ABA89F]">Verses the preacher reads land here.</p>
              </div>
            )}
          </div>
        </section>

        {/* Live rail — the screen preview and where it goes. */}
        <section className="flex min-h-0 flex-col gap-3 bg-[#1F1F19] p-4" aria-hidden="true">
          <span className="text-[12px] font-semibold text-[#ECE8E1]">Live</span>
          <div className="relative aspect-video overflow-hidden rounded-md bg-black">
            {(["john", "romans"] as const).map((key) => (
              <div
                key={key}
                className={`absolute inset-0 flex flex-col justify-end px-[9%] py-[8%] transition-opacity duration-500 ${live === key ? "opacity-100" : "opacity-0"}`}
              >
                <p className="text-[clamp(10px,1vw,14px)] font-semibold leading-[1.35] text-[#FFFBF4]">{SLIDES[key].text}</p>
                <small className="mt-1.5 text-[9px] tracking-[.14em] text-[#CCC9C1]">{SLIDES[key].reference} · KJV</small>
              </div>
            ))}
            <div className={`absolute inset-0 grid place-items-center text-[11px] text-[#565449] transition-opacity duration-500 ${live ? "opacity-0" : "opacity-100"}`}>
              Nothing is live
            </div>
          </div>
          <div className="grid gap-1.5">
            {["Projector", "Stage display", "Stream · NDI"].map((name) => (
              <span key={name} className="flex items-center justify-between rounded-md bg-[#272720] px-2.5 py-1.5 text-[11px] text-[#CCC9C1]">
                {name}
                <i className={`size-1.5 rounded-full transition-colors duration-300 ${live ? "bg-[#6C91C2]" : "bg-[#36362D]"}`} />
              </span>
            ))}
          </div>
        </section>
      </div>

      <figcaption className="bg-[#1F1F19] px-[18px] py-3 text-xs text-[#8C8980]">
        Kairo hears John 3:16 and sends it on its own, then the operator sends Romans 5:8.
      </figcaption>
    </figure>
  );
}

function LiveBadge(): React.ReactElement {
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#AABED7]">
      <i className="size-1.5 rounded-full bg-[#6C91C2]" /> On screen
    </span>
  );
}

function DetectedCard({ reference, text, source, live, status }: {
  reference: string;
  text: string;
  source: string;
  live: boolean;
  status: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className={`animate-[demo-card-in_.45s_cubic-bezier(.16,1,.3,1)] rounded-lg bg-[#1F1F19] px-3.5 py-3 outline outline-2 transition-[outline-color] duration-300 ${live ? "outline-[#6C91C2]" : "outline-transparent"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <b className="font-semibold text-[#FFFBF4]">{reference}</b>
        {status}
      </div>
      <p className="mt-1.5 line-clamp-2 text-[12px] leading-[1.45] text-[#ABA89F]">{text}</p>
      <p className="mt-2 text-[10px] text-[#8C8980]">{source}</p>
    </div>
  );
}
