"use client";

import { useState } from "react";
import { usePinnedStages } from "@/components/landing/usePinnedStages";

const STEPS = [
  {
    title: "Scan to join",
    body: "Put the QR on screen. People scan it and they're in, with no app and no account.",
  },
  {
    title: "Ask and vote",
    body: "Questions arrive live and the room upvotes what matters most.",
  },
  {
    title: "Moderate together",
    body: "Invite helpers by email to approve, fix typos, and reply. Only your booth sends anything to screen.",
  },
  {
    title: "Run a poll",
    body: "Ask the room a question and show the results on screen as votes come in.",
  },
] as const;

const QUESTIONS = [
  { author: "Grace", age: "1m", text: "How do we pray when we don't feel like it?", votes: 24 },
  { author: "Anonymous", age: "2m", text: "What does Romans 8:28 mean in hard seasons?", votes: 17 },
  { author: "Daniel", age: "4m", text: "Can we sing the closing song again next week?", votes: 6 },
];

const POLL = {
  title: "Which service do you usually attend?",
  voters: 128,
  options: [
    { text: "Morning service", share: 0.46 },
    { text: "Evening service", share: 0.31 },
    { text: "Midweek group", share: 0.23 },
  ],
};

const container =
  "mx-auto w-[calc(100%-40px)] max-w-[1200px] md:w-[calc(100%-64px)] xl:w-[calc(100%-96px)]";

export function EngageStory({ children }: { children: React.ReactNode }): React.ReactElement {
  const {
    ref,
    active: pinnedActive,
    stageProgress,
    enhanced,
    travel,
    goTo,
  } = usePinnedStages(STEPS.length);
  const [manualActive, setManualActive] = useState(1);

  const active = enhanced ? pinnedActive : manualActive;
  const local = enhanced ? stageProgress : 0.85;
  const select = (i: number): void => {
    if (enhanced) goTo(i);
    else setManualActive(i);
  };

  // Continuous fluid values driven by scroll progress on desktop (settled on mobile/click).
  const scanned = active > 0 || (enhanced && local > 0.78);
  const asked =
    active === 0 ? 0 : active > 1 ? 3 : Math.min(3, Math.max(1, Math.ceil(local * 3.2)));
  const voteP = active > 1 ? 1 : active === 1 ? Math.min(1, Math.max(0.25, local * 1.25)) : 0;
  const onScreen = active === 2 && (!enhanced || local > 0.22);
  const replied = active > 2 || (active === 2 && (!enhanced || local > 0.5));
  const pollP = active === 3 ? Math.min(1, Math.max(0.18, local * 1.35)) : 0;

  return (
    <section
      ref={ref}
      id="engage"
      aria-labelledby="engage-title"
      className="relative bg-white"
      style={enhanced ? { minHeight: travel } : undefined}
    >
      <div
        className={
          enhanced
            ? "sticky top-0 flex min-h-screen items-center py-16"
            : "py-[clamp(80px,9vw,124px)]"
        }
      >
        <div className={container}>
          <div className="mx-auto max-w-[680px] text-center">
            {children}

            <ol
              className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[14px] sm:gap-x-7 sm:border-b sm:border-[#EAECEF]"
              aria-label="Engage workflow steps"
            >
              {STEPS.map(({ title }, i) => {
                const on = i === active;
                const fill = enhanced
                  ? on
                    ? Math.max(0.1, stageProgress)
                    : 0
                  : on
                    ? 1
                    : 0;
                return (
                  <li key={title}>
                    <button
                      type="button"
                      onClick={() => select(i)}
                      aria-current={on ? "step" : undefined}
                      className={`landing-press relative pb-3 font-medium transition-colors duration-250 ${
                        on ? "text-[#141518]" : "text-[#7A808D] hover:text-[#141518]"
                      }`}
                    >
                      {title}
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 bottom-0 h-[2px] origin-left rounded-full bg-[#1655F8] transition-opacity duration-250"
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

            <p className="mx-auto mt-4 min-h-[3em] max-w-[52ch] text-[15.5px] leading-[1.6] text-[#6B707C]">
              {STEPS[active].body}
            </p>
          </div>

          <div
            className="mt-8 rounded-[24px] border border-[#EAECEF] bg-[#F8F9FB] p-5 sm:p-8 min-[1024px]:p-9"
            aria-hidden="true"
          >
            <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:gap-8 min-[1201px]:gap-12">
              {/* Room screen */}
              <div className="min-w-0 flex-1">
                <div className="landing-view relative aspect-video w-full overflow-hidden rounded-2xl bg-[#0B0D12] ring-1 ring-black/10 shadow-[0_28px_70px_-24px_rgba(14,18,32,0.38)]">
                  <div
                    className="absolute inset-0 bg-cover bg-center opacity-28"
                    style={{ backgroundImage: "url('/images/kairo-worship-hero.webp')" }}
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,9,14,0.32)_0%,rgba(8,9,14,0.86)_100%)]" />

                  <ScreenLayer show={active === 0}>
                    <div className="flex w-[86%] items-center justify-center gap-[6cqw] rounded-[2cqw] bg-[#141822]/95 px-[5cqw] py-[4cqw] text-white ring-1 ring-white/10 backdrop-blur-md">
                      <div className="w-[20cqw] shrink-0 rounded-[1.2cqw] bg-white p-[1cqw]">
                        <FakeQr />
                      </div>
                      <div className="min-w-0 text-left">
                        <p className="text-[2.2cqw] font-medium text-white/75">Scan to ask a question</p>
                        <p className="mt-[0.5cqw] text-[6.2cqw] leading-none font-bold tracking-[0.5cqw] tabular-nums text-white">
                          K7Q4MP
                        </p>
                        <p className="mt-[1.1cqw] text-[1.9cqw] text-white/65">kairopresenter.com/q/K7Q4MP</p>
                      </div>
                    </div>
                  </ScreenLayer>

                  <ScreenLayer show={active === 1 || active === 2}>
                    {onScreen ? (
                      <div className="w-[86%] animate-[engage-in_.4s_ease-out] rounded-[2cqw] bg-[#141822]/95 px-[5cqw] py-[3.8cqw] text-left text-white ring-1 ring-white/10 backdrop-blur-md">
                        <p className="text-[2cqw] font-medium text-white/70">{QUESTIONS[0].author}</p>
                        <p className="mt-[1.2cqw] text-[4cqw] leading-[1.3] font-medium tracking-tight text-white">
                          {QUESTIONS[0].text}
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-xl bg-black/55 px-[3.5cqw] py-[2cqw] text-center text-white/80 ring-1 ring-white/10 backdrop-blur-sm">
                        <p className="text-[2.1cqw] font-medium text-white">Presenter queue</p>
                        <p className="mt-[0.5cqw] text-[1.7cqw] text-white/60">
                          Incoming questions stay private until approved
                        </p>
                      </div>
                    )}
                  </ScreenLayer>

                  <ScreenLayer show={active === 3}>
                    <div className="w-[86%] rounded-[2cqw] bg-[#141822]/95 p-[4cqw] text-left text-white ring-1 ring-white/10 backdrop-blur-md">
                      <div className="flex items-center justify-between">
                        <span className="text-[1.9cqw] font-medium text-[#72A7FF]">Live poll</span>
                        <span className="text-[1.8cqw] tabular-nums text-white/65">
                          {Math.round(POLL.voters * pollP)} votes
                        </span>
                      </div>
                      <p className="mt-[0.8cqw] text-[3.5cqw] leading-tight font-semibold text-white">{POLL.title}</p>
                      <div className="mt-[2.2cqw] space-y-[1.6cqw]">
                        {POLL.options.map((o) => {
                          const pct = Math.round(o.share * pollP * 100);
                          return (
                            <div key={o.text}>
                              <div className="flex justify-between text-[2.2cqw] font-medium text-white/90">
                                <span>{o.text}</span>
                                <span className="tabular-nums text-white">{pct}%</span>
                              </div>
                              <div className="mt-[0.7cqw] h-[1.2cqw] overflow-hidden rounded-full bg-white/12">
                                <div
                                  className="h-full w-full origin-left rounded-full bg-[#1655F8] transition-transform duration-150 ease-out"
                                  style={{ transform: `scaleX(${(o.share * pollP).toFixed(3)})` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </ScreenLayer>
                </div>

                <div className="mt-3.5 flex h-6 items-center justify-between text-[13px] text-[#6B707C]">
                  <span>Sanctuary screen · 16:9</span>
                  <span
                    className={`inline-flex items-center gap-2 font-medium text-[#141518] transition-opacity duration-300 ${
                      active === 2 ? "opacity-100" : "opacity-0"
                    }`}
                  >
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    {replied ? "Jane replied to Grace" : "Approved by moderator"}
                  </span>
                </div>
              </div>

              {/* Audience phone */}
              <div className="w-full max-w-[252px] shrink-0 self-center sm:w-[31%] sm:self-end min-[1201px]:w-[244px]">
                <div className="rounded-[34px] bg-[#16171C] p-[6px] ring-1 ring-black/15 shadow-[0_28px_64px_-20px_rgba(14,18,32,0.34)]">
                  <div className="landing-view relative aspect-[9/18.5] w-full overflow-hidden rounded-[29px] bg-[#F3F4F7] text-[#0A0B10]">
                    <div className="absolute top-[2cqw] left-1/2 z-20 h-[3.8cqw] w-[26cqw] -translate-x-1/2 rounded-full bg-black" />

                    <div
                      className={`absolute inset-0 z-10 flex flex-col justify-between bg-[#08090D] p-[5cqw] transition-[opacity,transform] duration-350 ease-out ${
                        scanned ? "pointer-events-none scale-105 opacity-0" : "scale-100 opacity-100"
                      }`}
                    >
                      <div className="pt-[6cqw] text-center">
                        <p className="text-[3.8cqw] font-medium text-white/85">Camera</p>
                      </div>
                      <div className="relative mx-auto aspect-square w-[72%]">
                        <div className="absolute inset-0 rounded-[4cqw] border-2 border-amber-400/85" />
                        <div className="flex h-full items-center justify-center p-[4cqw]">
                          <div className="w-[85%] rounded-[2cqw] bg-white p-[2cqw]">
                            <FakeQr />
                          </div>
                        </div>
                        <div
                          className={`absolute -bottom-[8cqw] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#1655F8] px-[3.5cqw] py-[1.4cqw] text-[3.4cqw] font-semibold text-white transition-[opacity,transform] duration-300 ${
                            local > 0.25 ? "scale-100 opacity-100" : "scale-90 opacity-0"
                          }`}
                        >
                          kairopresenter.com/q/K7Q4MP →
                        </div>
                      </div>
                      <div className="pb-[6cqw] text-center">
                        <p className="text-[3.4cqw] text-white/55">Scanning screen QR code…</p>
                      </div>
                    </div>

                    <div className="bg-[#1655F8] px-[4cqw] pt-[8cqw] pb-[3.5cqw] text-white">
                      <div className="flex items-center justify-between text-[3.2cqw] font-medium text-white/80">
                        <span>Grace Church</span>
                        <span className="tabular-nums opacity-80">#K7Q4MP</span>
                      </div>
                      <h3 className="mt-[0.6cqw] text-[4.6cqw] leading-tight font-bold">Sunday Q&amp;A</h3>
                      <div className="mt-[3cqw] flex gap-[1cqw] rounded-[2.5cqw] bg-black/20 p-[0.8cqw]">
                        <span
                          className={`flex-1 rounded-[2cqw] py-[1.2cqw] text-center text-[3.6cqw] font-semibold transition-colors ${
                            active !== 3 ? "bg-white/25 text-white" : "text-white/70"
                          }`}
                        >
                          Q&amp;A
                        </span>
                        <span
                          className={`flex-1 rounded-[2cqw] py-[1.2cqw] text-center text-[3.6cqw] font-semibold transition-colors ${
                            active === 3 ? "bg-white/25 text-white" : "text-white/70"
                          }`}
                        >
                          Polls
                        </span>
                      </div>
                    </div>

                    {active !== 3 ? (
                      <div className="space-y-[3cqw] p-[3.5cqw]">
                        <div className="flex items-center gap-[2.5cqw] rounded-[3cqw] border border-black/8 bg-white px-[3.5cqw] py-[2.8cqw]">
                          <span className="size-[6.5cqw] shrink-0 rounded-full bg-[#E8EAF0]" />
                          <span className="text-[3.6cqw] text-[#666B7E]">Ask a question…</span>
                        </div>
                        <div className="space-y-[2.2cqw]">
                          {asked === 0 ? (
                            <div className="rounded-[3cqw] border border-black/8 bg-white p-[4cqw] text-center">
                              <p className="text-[3.8cqw] font-semibold text-[#1A1C1F]">
                                Connected to Sunday Q&amp;A
                              </p>
                              <p className="mt-[1.2cqw] text-[3.2cqw] leading-[1.4] text-[#666B7E]">
                                Send a question anytime. The room can upvote what they want answered most.
                              </p>
                            </div>
                          ) : (
                            QUESTIONS.slice(0, asked).map((q, i) => (
                              <div
                                key={q.text}
                                className="animate-[engage-in_.35s_ease-out] rounded-[3cqw] border border-black/8 bg-white p-[3.2cqw]"
                              >
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-[3.4cqw] font-semibold text-[#1A1C1F]">{q.author}</p>
                                    <p className="text-[2.6cqw] text-[#6B7280]">{q.age} ago</p>
                                  </div>
                                  <span
                                    className={`flex items-center gap-1 rounded-full px-[2.4cqw] py-[0.8cqw] text-[3.2cqw] font-bold tabular-nums transition-colors ${
                                      i === 0 && voteP > 0.4 ? "bg-[#1655F8] text-white" : "bg-[#F2F3F5] text-[#3C4048]"
                                    }`}
                                  >
                                    ▲ {Math.round(q.votes * voteP)}
                                  </span>
                                </div>
                                <p className="mt-[2cqw] text-[3.6cqw] leading-[1.35] text-[#1A1C1F]">{q.text}</p>
                                {i === 0 && replied ? (
                                  <div className="mt-[2.2cqw] rounded-[2cqw] bg-[#F3F4F7] p-[2.2cqw] text-[3.2cqw] leading-[1.35]">
                                    <p className="font-semibold text-[#1655F8]">Answered by the team</p>
                                    <p className="mt-[0.5cqw] text-[#3C4048]">Pastor will cover this in the sermon.</p>
                                  </div>
                                ) : null}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-[2.8cqw] p-[3.5cqw]">
                        <div className="rounded-[3cqw] border border-black/8 bg-white p-[3.5cqw]">
                          <span className="text-[3cqw] font-semibold text-[#1655F8]">Live poll</span>
                          <p className="mt-[0.8cqw] text-[4cqw] leading-tight font-bold text-[#1A1C1F]">{POLL.title}</p>
                          <div className="mt-[3cqw] space-y-[1.8cqw]">
                            {POLL.options.map((o, idx) => {
                              const isSelected = idx === 0 && local > 0.15;
                              return (
                                <div
                                  key={o.text}
                                  className={`flex items-center justify-between rounded-[2.5cqw] border p-[2.6cqw] text-[3.4cqw] transition-colors ${
                                    isSelected
                                      ? "border-[#1655F8] bg-[#1655F8]/10 font-semibold text-[#1A1C1F]"
                                      : "border-black/10 bg-white text-[#2E3240]"
                                  }`}
                                >
                                  <span>{o.text}</span>
                                  {isSelected && <span className="text-[3cqw] text-[#1655F8]">✓</span>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div className="flex items-center justify-between rounded-[3cqw] border border-black/8 bg-white px-[3.5cqw] py-[2.8cqw] text-[3.2cqw]">
                          <span className="font-medium text-[#1A1C1F]">Vote recorded</span>
                          <span className="tabular-nums text-[#666B7E]">
                            {Math.round(POLL.voters * pollP)} live
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <p className="mt-3.5 text-center text-[13px] text-[#6B707C] sm:text-left">
                  Audience phone · No app
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ScreenLayer({ show, children }: { show: boolean; children: React.ReactNode }): React.ReactElement {
  return (
    <div
      className={`absolute inset-0 grid place-items-center p-[4cqw] transition-[opacity,transform,filter] duration-450 ease-[var(--ease-out)] motion-reduce:transition-none ${
        show
          ? "scale-100 opacity-100 blur-0"
          : "pointer-events-none scale-[.98] opacity-0 blur-[4px]"
      }`}
    >
      {children}
    </div>
  );
}

function FakeQr(): React.ReactElement {
  const n = 21;
  const finder = (x: number, y: number): boolean => {
    for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]])
      if (x >= fx && x < fx + 7 && y >= fy && y < fy + 7) return true;
    return false;
  };
  const cells: React.ReactElement[] = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (!finder(x, y) && ((x * 31 + y * 17 + x * y) % 7) < 3)
        cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />);
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
