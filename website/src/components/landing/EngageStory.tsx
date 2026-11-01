"use client";

import { useEffect, useRef, useState } from "react";
import { ChartColumn, MessageCircleQuestion, QrCode, UserCheck } from "lucide-react";

/**
 * The Engage section: a full-viewport stage that pins while you scroll through
 * it. Four beats play on the room screen and the audience page side by side:
 * scan to join, ask and vote, the team moderates, and a poll runs.
 *
 * The drawings follow the real product: the screen card mirrors
 * `renderQuestionHTML` / `renderPollHTML` defaults in src/lib/program.ts, and
 * the phone mirrors website/src/app/q/[code]/AudiencePhone.tsx.
 */

const STEPS = [
  { title: "Scan to join", body: "Put the QR on screen. People scan it and they're in — no app, no account.", Icon: QrCode },
  { title: "Ask and vote", body: "Questions arrive live and the room upvotes what matters most.", Icon: MessageCircleQuestion },
  { title: "Moderate together", body: "Invite helpers by email to approve, fix typos and reply. You send it to the screen.", Icon: UserCheck },
  { title: "Run a poll", body: "Ask the room and show the results on screen as votes come in.", Icon: ChartColumn },
] as const;

const QUESTIONS = [
  { author: "Grace", age: "1m", text: "How do we pray when we don't feel like it?", votes: 24 },
  { author: "Anonymous", age: "2m", text: "What does Romans 8:28 mean in hard seasons?", votes: 17 },
  { author: "Daniel", age: "4m", text: "Can we sing the closing song again next week?", votes: 6 },
];

const POLL = { title: "Which service do you usually attend?", voters: 128, options: [
  { text: "Morning service", share: 0.46 },
  { text: "Evening service", share: 0.31 },
  { text: "Midweek group", share: 0.23 },
] };

const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));
const ease = (p: number): number => 1 - Math.pow(1 - clamp(p), 3);

export function EngageStory({ children }: { children: React.ReactNode }): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const section = rootRef.current?.closest("section");
    if (!section) return;
    let frame = 0;
    const update = (): void => {
      frame = 0;
      const rect = section.getBoundingClientRect();
      const vh = window.innerHeight;
      const run = rect.height - vh;
      const p = run > vh * 0.5 ? -rect.top / run : (vh * 0.6 - rect.top) / (rect.height + vh * 0.2);
      setProgress(clamp(p, 0, 0.9999));
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
    const rect = section.getBoundingClientRect();
    const run = rect.height - window.innerHeight;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: window.scrollY + rect.top + run * ((index + 0.55) / STEPS.length), behavior: reduce ? "auto" : "smooth" });
  };

  const active = Math.min(STEPS.length - 1, Math.floor(progress * STEPS.length));
  const local = progress * STEPS.length - active;
  const beat = (i: number): number => (active > i ? 1 : active < i ? 0 : local);

  const scanned = active > 0 || local > 0.55; // phone has opened the audience page
  const asked = active === 0 ? (scanned ? 0 : 0) : active === 1 ? Math.min(3, 1 + Math.floor(local * 4)) : 3;
  const voteP = active >= 2 ? 1 : active === 1 ? ease((local - 0.35) / 0.6) : 0;
  const onScreen = active === 2 && local > 0.45;
  const replied = active >= 2 && (active > 2 || local > 0.7);
  const pollP = ease((beat(3) - 0.2) / 0.65);

  return (
    <div ref={rootRef} className="grid w-full items-center gap-12 min-[1101px]:grid-cols-[minmax(0,1fr)_minmax(0,1.55fr)] min-[1101px]:gap-16">
      <div className="max-w-[520px]">
        {children}
        <ol className="mt-10 grid gap-2">
          {STEPS.map(({ title, body, Icon }, i) => {
            const on = i === active;
            return (
              <li key={title}>
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  aria-current={on ? "step" : undefined}
                  className={`relative flex w-full items-start gap-4 overflow-hidden rounded-2xl px-4 py-3.5 text-left transition-colors duration-300 ${on ? "bg-white/[.06]" : "hover:bg-white/[.03]"}`}
                >
                  <span className={`grid size-9 shrink-0 place-items-center rounded-xl transition-colors duration-300 [&_svg]:size-[18px] ${on ? "bg-[#3B6BFF] text-white" : "bg-white/[.06] text-[#7D8399]"}`}>
                    <Icon aria-hidden="true" />
                  </span>
                  <span className="min-w-0 pt-1.5">
                    <span className={`block text-[16px] leading-tight font-medium tracking-[-.015em] transition-colors ${on ? "text-[#F6F3EB]" : "text-[#8D93AD]"}`}>{title}</span>
                    <span className={`grid transition-[grid-template-rows,opacity,margin] duration-500 ${on ? "mt-1.5 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                      <span className="overflow-hidden text-[14.5px] leading-[1.5] text-[#A7A9B8]">{body}</span>
                    </span>
                  </span>
                  <span className="absolute bottom-0 left-0 h-[2px] w-full origin-left bg-[#3B6BFF]" style={{ transform: `scaleX(${on ? local : 0})` }} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-6 min-[1201px]:gap-8" aria-hidden="true">
        {/* Room screen */}
        <div className="min-w-0 flex-1">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="flex items-center gap-2 text-[11px] font-bold tracking-[.18em] text-[#A7A9B8]">
              <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
              SANCTUARY SCREEN · LIVE
            </span>
            <span className="text-[11px] font-medium text-[#7D8399]">16:9 Output</span>
          </div>

          <div className="landing-view relative aspect-video w-full overflow-hidden rounded-2xl bg-[#08090E] ring-1 ring-white/15 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.8)]">
            <div className="absolute inset-0 bg-[url('/images/kairo-worship-hero.webp')] bg-cover bg-center opacity-30" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,9,14,0.3)_0%,rgba(8,9,14,0.85)_100%)]" />

            {/* Join card — QR, headline, code, URL */}
            <ScreenLayer show={active === 0}>
              <div className="flex w-[88%] items-center justify-center gap-[6cqw] rounded-[2cqw] bg-[#18212d]/95 px-[5cqw] py-[4cqw] text-white shadow-2xl backdrop-blur-md">
                <div className={`w-[20cqw] shrink-0 rounded-[1.2cqw] bg-white p-[1cqw] transition-shadow duration-500 ${local > 0.25 && !scanned ? "shadow-[0_0_0_0.6cqw_rgba(59,107,255,0.9)]" : "shadow-md"}`}>
                  <FakeQr />
                </div>
                <div className="min-w-0 text-left">
                  <p className="text-[2.2cqw] font-medium text-white/80">Scan to ask a question</p>
                  <p className="mt-[0.4cqw] text-[6.2cqw] leading-none font-bold tracking-[0.6cqw] text-white">K7Q4MP</p>
                  <p className="mt-[1cqw] text-[1.9cqw] text-white/70">kairopresenter.com/q/K7Q4MP</p>
                </div>
              </div>
            </ScreenLayer>

            {/* Question card */}
            <ScreenLayer show={active === 1 || active === 2}>
              {onScreen ? (
                <div className="w-[88%] animate-[engage-in_.45s_ease-out] rounded-[2cqw] bg-[#18212d]/95 px-[5cqw] py-[3.8cqw] text-left text-white shadow-2xl backdrop-blur-md">
                  <div className="flex items-center gap-[1.5cqw]">
                    <span className="size-[1.2cqw] rounded-full bg-[#3B6BFF]" />
                    <p className="text-[2cqw] font-semibold text-white/80">{QUESTIONS[0].author}</p>
                  </div>
                  <p className="mt-[1.2cqw] text-[4cqw] leading-[1.3] font-medium tracking-tight text-white">{QUESTIONS[0].text}</p>
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-black/50 px-[3cqw] py-[1.8cqw] text-center text-white/75 backdrop-blur-sm">
                  <p className="text-[2cqw] font-medium text-white">Presenter Queue</p>
                  <p className="mt-[0.5cqw] text-[1.6cqw] text-white/60">
                    {active === 2 ? "Question approved — ready to present" : "Incoming questions stay private until approved"}
                  </p>
                </div>
              )}
            </ScreenLayer>

            {/* Poll card */}
            <ScreenLayer show={active === 3}>
              <div className="w-[88%] rounded-[2cqw] bg-[#18212d]/95 p-[4cqw] text-left text-white shadow-2xl backdrop-blur-md">
                <div className="flex items-center justify-between">
                  <span className="text-[1.8cqw] font-semibold text-primary uppercase tracking-wider">Live Congregation Poll</span>
                  <span className="text-[1.7cqw] text-white/70">{Math.round(POLL.voters * pollP)} votes</span>
                </div>
                <p className="mt-[0.8cqw] text-[3.6cqw] leading-tight font-bold text-white">{POLL.title}</p>
                <div className="mt-[2.2cqw] space-y-[1.6cqw]">
                  {POLL.options.map((o) => {
                    const pct = Math.round(o.share * pollP * 100);
                    return (
                      <div key={o.text}>
                        <div className="flex justify-between text-[2.2cqw] font-medium text-white/90">
                          <span>{o.text}</span>
                          <span className="tabular-nums font-semibold text-white">{pct}%</span>
                        </div>
                        <div className="mt-[0.7cqw] h-[1.3cqw] overflow-hidden rounded-full bg-white/15">
                          <div className="h-full rounded-full bg-[#3B6BFF] transition-all duration-300" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </ScreenLayer>
          </div>

          {/* Moderator status note below screen */}
          <div className="mt-3.5 flex h-7 items-center">
            <div className={`inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1 text-xs text-[#DAD7D0] transition-all duration-300 ${active === 2 ? "opacity-100" : "opacity-0"}`}>
              <span className="size-1.5 rounded-full bg-emerald-400" />
              {replied ? "Jane (team moderator) replied to Grace" : "Jane (team moderator) approved question"}
            </div>
          </div>
        </div>

        {/* Audience phone */}
        <div className="w-full max-w-[280px] shrink-0 self-center sm:w-[35%] sm:self-end min-[1201px]:w-[260px]">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-[11px] font-bold tracking-[.18em] text-[#A7A9B8]">AUDIENCE PHONE</span>
            <span className="text-[11px] font-medium text-[#7D8399]">No app needed</span>
          </div>

          <div className="rounded-[36px] bg-[#14151C] p-[7px] ring-1 ring-white/20 shadow-[0_30px_70px_-15px_rgba(0,0,0,0.9)]">
            <div className="landing-view relative aspect-[9/18.5] w-full overflow-hidden rounded-[30px] bg-[#F3F4F7] text-[#0A0B10]">
              {/* Dynamic Island */}
              <div className="absolute top-[2cqw] left-1/2 z-20 h-[3.8cqw] w-[26cqw] -translate-x-1/2 rounded-full bg-black" />

              {/* Camera Scanner View during Beat 0 */}
              <div className={`absolute inset-0 z-10 flex flex-col justify-between bg-[#08090D] p-[5cqw] transition-opacity duration-500 ${scanned ? "pointer-events-none opacity-0" : "opacity-100"}`}>
                <div className="pt-[6cqw] text-center">
                  <p className="text-[3.8cqw] font-semibold text-white/90">Camera</p>
                </div>

                {/* Viewfinder Reticle */}
                <div className="relative mx-auto aspect-square w-[72%]">
                  <div className="absolute inset-0 rounded-[4cqw] border-2 border-amber-400/90 shadow-[0_0_20px_rgba(251,191,36,0.35)]" />
                  <div className="flex h-full items-center justify-center p-[4cqw]">
                    <div className="w-[85%] rounded-[2cqw] bg-white p-[2cqw]">
                      <FakeQr />
                    </div>
                  </div>

                  {/* QR Link Pill Banner */}
                  <div className={`absolute -bottom-[8cqw] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#3B6BFF] px-[3.5cqw] py-[1.5cqw] text-[3.6cqw] font-semibold text-white shadow-lg transition-all duration-300 ${local > 0.35 ? "scale-100 opacity-100" : "scale-90 opacity-0"}`}>
                    kairopresenter.com/q/K7Q4MP →
                  </div>
                </div>

                <div className="pb-[6cqw] text-center">
                  <p className="text-[3.4cqw] text-white/60">Scanning screen QR code…</p>
                </div>
              </div>

              {/* Real Audience Page Header */}
              <div className="bg-[#3B6BFF] px-[4cqw] pt-[8cqw] pb-[3.5cqw] text-white">
                <div className="flex items-center justify-between text-[3.2cqw] font-medium text-white/80">
                  <span>Grace Church</span>
                  <span className="font-mono text-[3cqw] opacity-75">#K7Q4MP</span>
                </div>
                <h3 className="mt-[0.6cqw] text-[4.6cqw] leading-tight font-bold">Sunday Q&amp;A</h3>

                {/* Tab switch */}
                <div className="mt-[3cqw] flex gap-[1cqw] rounded-[2.5cqw] bg-black/20 p-[0.8cqw]">
                  <span className={`flex-1 rounded-[2cqw] py-[1.2cqw] text-center text-[3.6cqw] font-semibold transition-colors ${active !== 3 ? "bg-white/25 text-white shadow-xs" : "text-white/70"}`}>
                    Q&amp;A
                  </span>
                  <span className={`flex-1 rounded-[2cqw] py-[1.2cqw] text-center text-[3.6cqw] font-semibold transition-colors ${active === 3 ? "bg-white/25 text-white shadow-xs" : "text-white/70"}`}>
                    Polls
                  </span>
                </div>
              </div>

              {/* Questions Stream */}
              {active !== 3 ? (
                <div className="space-y-[3cqw] p-[3.5cqw]">
                  {/* Ask bar */}
                  <div className="flex items-center gap-[2.5cqw] rounded-[3cqw] border border-black/8 bg-white px-[3.5cqw] py-[2.8cqw] shadow-xs">
                    <span className="size-[6.5cqw] shrink-0 rounded-full bg-[#E8EAF0]" />
                    <span className="text-[3.6cqw] text-[#666B7E]">Ask a question…</span>
                  </div>

                  {/* Question cards */}
                  <div className="space-y-[2.2cqw]">
                    {QUESTIONS.slice(0, asked).map((q, i) => (
                      <div key={q.text} className="animate-[engage-in_.35s_ease-out] rounded-[3cqw] border border-black/8 bg-white p-[3.2cqw] shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-[2cqw]">
                            <span className="grid size-[6.5cqw] place-items-center rounded-full bg-[#E8EAED] text-[3cqw] font-bold text-[#6B7280]">
                              {q.author[0]}
                            </span>
                            <div>
                              <p className="text-[3.4cqw] font-semibold text-[#1A1C1F]">{q.author}</p>
                              <p className="text-[2.6cqw] text-[#6B7280]">{q.age} ago</p>
                            </div>
                          </div>
                          <span className={`flex items-center gap-1 rounded-full px-[2.4cqw] py-[0.8cqw] text-[3.2cqw] font-bold tabular-nums transition-colors ${i === 0 && voteP > 0.4 ? "bg-[#3B6BFF] text-white" : "bg-[#F2F3F5] text-[#3C4048]"}`}>
                            ▲ {Math.round(q.votes * voteP)}
                          </span>
                        </div>
                        <p className="mt-[2cqw] text-[3.6cqw] leading-[1.35] text-[#1A1C1F]">{q.text}</p>
                        {i === 0 && replied ? (
                          <div className="mt-[2.2cqw] rounded-[2cqw] bg-[#F3F4F7] p-[2.2cqw] text-[3.2cqw] leading-[1.35]">
                            <p className="font-semibold text-[#2F5BE0]">Answered by the team</p>
                            <p className="mt-[0.5cqw] text-[#3C4048]">Pastor will cover this in the sermon.</p>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* Poll View on Phone */
                <div className="p-[3.5cqw]">
                  <div className="rounded-[3cqw] border border-black/8 bg-white p-[3.5cqw] shadow-xs">
                    <span className="text-[2.8cqw] font-bold tracking-wider text-[#3B6BFF] uppercase">Live Poll</span>
                    <p className="mt-[0.8cqw] text-[4cqw] leading-tight font-bold text-[#1A1C1F]">{POLL.title}</p>
                    <div className="mt-[3cqw] space-y-[1.8cqw]">
                      {POLL.options.map((o, idx) => {
                        const isSelected = idx === 0 && local > 0.15;
                        return (
                          <div
                            key={o.text}
                            className={`flex items-center justify-between rounded-[2.5cqw] border p-[2.6cqw] text-[3.4cqw] transition-colors ${isSelected ? "border-[#3B6BFF] bg-[#3B6BFF]/10 font-semibold text-[#1A1C1F]" : "border-black/10 bg-white text-[#2E3240]"}`}
                          >
                            <span>{o.text}</span>
                            {isSelected && <span className="text-[3cqw] text-[#3B6BFF]">✓ Selected</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScreenLayer({ show, children }: { show: boolean; children: React.ReactNode }): React.ReactElement {
  return (
    <div className={`absolute inset-0 grid place-items-center p-[4cqw] transition-[opacity,transform] duration-500 ${show ? "scale-100 opacity-100" : "pointer-events-none scale-[.98] opacity-0"}`}>
      {children}
    </div>
  );
}

/** A QR-looking mark: three finder squares and a fixed scatter of modules. */
function FakeQr(): React.ReactElement {
  const n = 21;
  const finder = (x: number, y: number): boolean => {
    for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]]) if (x >= fx && x < fx + 7 && y >= fy && y < fy + 7) return true;
    return false;
  };
  const cells: React.ReactElement[] = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (!finder(x, y) && ((x * 31 + y * 17 + x * y) % 7) < 3) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />);
  const Finder = ({ x, y }: { x: number; y: number }): React.ReactElement => (
    <g>
      <rect x={x} y={y} width="7" height="7" />
      <rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff" />
      <rect x={x + 2} y={y + 2} width="3" height="3" />
    </g>
  );
  return (
    <svg viewBox={`0 0 ${n} ${n}`} className="block h-auto w-full" fill="#0A0B10" shapeRendering="crispEdges">
      {cells}
      <Finder x={0} y={0} />
      <Finder x={n - 7} y={0} />
      <Finder x={0} y={n - 7} />
    </svg>
  );
}
