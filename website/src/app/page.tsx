import type { Metadata, Viewport } from "next";
import {
  isIndexable,
  siteUrl,
  siteName,
  siteTitle,
  siteDescription,
  socialImage,
} from "@/lib/seo";

import { Fragment } from "react";
import {
  AudioLines,
  BookOpen,
  Film,
  Languages,
  ListMusic,
  MessageCircleQuestion,
  Monitor,
  Presentation,
  Timer,
  Video,
  WifiOff,
} from "lucide-react";
import { HeroDownload } from "@/components/landing/HeroDownload";
import { SiteNav } from "@/components/landing/SiteNav";
import { Stagger } from "@/components/landing/Stagger";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { OperatorDemo } from "@/components/landing/OperatorDemo";
import { ScreenViews } from "@/components/landing/ScreenViews";
import { EngageStory } from "@/components/landing/EngageStory";
import { StretchyFooter } from "@/components/landing/StretchyFooter";
import "./landing.css";
import Image from "next/image";

/** The browser chrome matches the page, not the dashboard. */
export const viewport: Viewport = { themeColor: "#0A0B10" };

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  robots: {
    index: isIndexable,
    follow: true,
    googleBot: {
      index: isIndexable,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    url: "/",
    siteName,
    type: "website",
    locale: "en_US",
    images: [socialImage],
  },
};

const container =
  "mx-auto w-[calc(100%-40px)] max-w-[1440px] md:w-[calc(100%-48px)] xl:w-[calc(100%-80px)]";
// One quiet type scale. Tracking tightens with size: display pulls in, body stays near 0.
const eyebrow = "text-[13px] font-semibold tracking-[.02em] text-[#8AB4FF]";
const heading =
  "text-[clamp(40px,5.2vw,76px)] leading-[1.03] font-semibold tracking-[-.045em] text-balance";
const lede = "text-[clamp(17px,1.5vw,21px)] leading-[1.5] tracking-[-.005em] text-[#9CA1B5] text-pretty";
const section = "py-[clamp(96px,13vw,200px)]";

const downloads = [
  {
    name: "Apple silicon",
    system: "macOS",
    detail: "M1 or later · macOS 11+",
    format: ".dmg",
    platform: "mac-arm64",
  },
  {
    name: "Intel Mac",
    system: "macOS",
    detail: "Intel processor · macOS 11+",
    format: ".dmg",
    platform: "mac-x64",
  },
  {
    name: "Windows",
    system: "Windows",
    detail: "64-bit · Windows 10 or later",
    format: ".exe",
    platform: "windows-x64",
  },
  {
    name: "Linux",
    system: "Linux",
    detail: "64-bit · AppImage",
    format: ".AppImage",
    platform: "linux-x64",
  },
];

const heroPillars = [
  {
    title: "Live Scripture",
    body: "Hears verses & paraphrases live",
    href: "#product",
    Icon: AudioLines,
  },
  {
    title: "Every Screen",
    body: "Room, stage, lobby & NDI feeds",
    href: "#screens",
    Icon: Monitor,
  },
  {
    title: "Congregation Engage",
    body: "QR Q&A and polls, no app needed",
    href: "#engage",
    Icon: MessageCircleQuestion,
  },
] as const;

const thesis =
  "Services don't always go to plan. A verse nobody scheduled. A song that keeps going. Kairo listens, and keeps up.";

const features = [
  {
    title: "Lyrics in two languages",
    body: "A translated line under every lyric.",
    Icon: Languages,
  },
  {
    title: "Bible translations",
    body: "KJV, BBE and BSB built in. More with API.Bible.",
    Icon: BookOpen,
  },
  {
    title: "PowerPoint and PDF",
    body: "Bring in a deck and move through it with a clicker.",
    Icon: Presentation,
  },
  {
    title: "Video backgrounds",
    body: "Loops keep moving while the words change.",
    Icon: Film,
  },
  {
    title: "Live camera input",
    body: "Put a camera or capture card on screen.",
    Icon: Video,
  },
  {
    title: "Stage countdown",
    body: "Timers and notes only the stage can see.",
    Icon: Timer,
  },
  {
    title: "CCLI song records",
    body: "Every song shown, ready when it's time to report.",
    Icon: ListMusic,
  },
  {
    title: "Works offline",
    body: "Slides, media and built-in Bibles, no internet needed.",
    Icon: WifiOff,
  },
];


const questions = [
  {
    question: "Does Kairo run my screens directly?",
    answer:
      "Yes. Kairo runs the screens connected to your computer. You can also send NDI output to a compatible switcher or stream.",
  },
  {
    question: "Does someone still need to manage what goes live?",
    answer:
      "Yes. Kairo can suggest a verse, but someone on your team can check it before it goes live. Automatic output is there if your team chooses to use it.",
  },
  {
    question:
      "What if the pastor paraphrases instead of reading the reference?",
    answer:
      "It can suggest a passage from the words being spoken, even without a book and chapter. Check the suggestion before sending it live.",
  },
  {
    question: "Can the congregation send questions during the service?",
    answer:
      "Yes. With Engage, people join from a short code or QR on the audience page to ask questions, vote and answer polls, with no app or account. Moderators can approve and reply from the website, and only you put anything on screen.",
  },
  {
    question: "Does it need the internet?",
    answer:
      "Kairo can run screens and use local media and built-in Bibles without internet. Live transcription uses Deepgram, so that part needs a connection.",
  },
];

function Thesis(): React.ReactElement {
  const total = thesis.replace(/ /g, "").length;
  let letter = 0;
  return (
    <p className="landing-thesis-text mx-auto max-w-[1100px] text-center text-[clamp(32px,4.4vw,68px)] leading-[1.1] font-semibold tracking-[-.04em] text-balance">
      <span className="sr-only">{thesis}</span>
      <span aria-hidden="true">
        {thesis.split(" ").map((word, w) => (
          <Fragment key={w}>
            {w > 0 && " "}
            <span className="whitespace-nowrap">
              {[...word].map((char, c) => {
                const at = letter++ / total;
                return (
                  <span
                    key={c}
                    style={{ "--at": at.toFixed(4) } as React.CSSProperties}
                  >
                    {char}
                  </span>
                );
              })}
            </span>
          </Fragment>
        ))}
      </span>
    </p>
  );
}

export default function HomePage(): React.ReactElement {
  return (
    <>
      <a
        className="absolute -top-20 left-6 z-[100] rounded-lg bg-white px-[18px] py-3 text-[#11120D] focus:top-3"
        href="#main"
      >
        Skip to content
      </a>
      <SiteNav home />
      <div
        className="landing relative z-10 min-h-screen bg-[#0A0B10] font-[var(--font-manrope)] text-[#F6F3EB]"
        id="top"
        data-stretchy-page=""
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "Organization",
                  "@id": `${siteUrl}/#organization`,
                  name: siteName,
                  alternateName: "Kairo",
                  url: siteUrl,
                },
                {
                  "@type": "WebSite",
                  "@id": `${siteUrl}/#website`,
                  name: siteName,
                  alternateName: "Kairo",
                  url: siteUrl,
                  inLanguage: "en",
                  publisher: { "@id": `${siteUrl}/#organization` },
                },
                {
                  "@type": "SoftwareApplication",
                  "@id": `${siteUrl}/#software`,
                  name: siteName,
                  alternateName: "Kairo",
                  url: siteUrl,
                  description: siteDescription,
                  applicationCategory: "MultimediaApplication",
                  operatingSystem: "macOS, Windows, Linux",
                  image: `${siteUrl}${socialImage.url}`,
                  downloadUrl: `${siteUrl}/#get`,
                  publisher: { "@id": `${siteUrl}/#organization` },
                  featureList: [
                    "Church service planning",
                    "Lyrics, Scripture, slides and media presentation",
                    "Stage confidence monitors",
                    "Independent lobby playlists",
                    "NDI output",
                    "Live Scripture suggestions",
                    "Sermon transcription and recaps",
                    "PowerPoint and PDF import",
                    "CCLI song reporting",
                    "Live audience Q&A and polls",
                    "Question moderation by email invite",
                  ],
                },
                {
                  "@type": "FAQPage",
                  "@id": `${siteUrl}/#questions`,
                  mainEntity: questions.map(({ question, answer }) => ({
                    "@type": "Question",
                    name: question,
                    acceptedAnswer: { "@type": "Answer", text: answer },
                  })),
                },
              ],
            }).replace(/</g, "\u003c"),
          }}
        />

        <main id="main">
          {/* Hero: stage-lit statement, action, and three-pillar wayfinding dock. */}
          <section
            className="landing-hero relative isolate overflow-hidden pt-[clamp(112px,14vh,152px)] pb-[clamp(44px,5vw,72px)] text-center"
            aria-labelledby="hero-title"
          >
            <div className="grain pointer-events-none absolute inset-0 -z-1" aria-hidden="true" />
            <div
              className="landing-hero-arc pointer-events-none absolute inset-x-0 top-0 -z-1 h-[420px]"
              aria-hidden="true"
            />
            <div className={`landing-hero-copy ${container} flex flex-col items-center`}>
              <a
                href="#product"
                className="landing-press inline-flex items-center gap-2.5 rounded-full border border-white/[.11] bg-white/[.04] px-4 py-1.5 text-[13px] font-medium tracking-[.01em] text-[#D8DCEB] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-md hover:border-white/[.2] hover:bg-white/[.07] hover:text-white"
              >
                <span className="size-1.5 rounded-full bg-[#8AB4FF] shadow-[0_0_10px_#8AB4FF]" aria-hidden="true" />
                Built for Sunday teams
              </a>

              <h1
                className="mt-7 max-w-[15ch] text-[clamp(44px,7.2vw,104px)] leading-[.99] font-semibold tracking-[-.048em] text-balance"
                id="hero-title"
              >
                <span className="bg-gradient-to-b from-white via-[#F6F3EB] to-[#C8CDD9] bg-clip-text text-transparent">
                  Church presentations,
                </span>{" "}
                <span className="bg-gradient-to-b from-[#C7DCFF] via-[#8AB4FF] to-[#5888FF] bg-clip-text text-transparent">
                  reimagined.
                </span>
              </h1>

              <p className="mt-6 max-w-[35em] text-[clamp(17px,1.45vw,21px)] leading-[1.52] tracking-[-.005em] text-[#AEB4C9] text-pretty">
                Kairo listens to the sermon, recognizes Scripture as it&apos;s
                spoken, and puts it on every screen—so your team stays in the
                moment.
              </p>

              <div className="mt-9">
                <HeroDownload builds={downloads} variant="hero" />
              </div>

              <nav
                aria-label="Core capabilities"
                className="mt-12 w-full max-w-[960px] overflow-hidden rounded-2xl border border-white/[.09] bg-white/[.025] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md"
              >
                <ul className="grid grid-cols-1 divide-y divide-white/[.07] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                  {heroPillars.map(({ title, body, href, Icon }) => (
                    <li key={title}>
                      <a
                        href={href}
                        className="landing-press landing-press-soft group flex items-center gap-3.5 px-5 py-4 text-left transition-colors duration-200 hover:bg-white/[.04]"
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#3B6BFF]/14 text-[#8AB4FF] ring-1 ring-[#8AB4FF]/22 transition-colors duration-200 group-hover:bg-[#3B6BFF]/22 group-hover:text-[#B4CEFF]">
                          <Icon className="size-[18px]" strokeWidth={1.7} aria-hidden="true" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[14.5px] font-semibold tracking-[-.01em] text-[#F2F3F7]">
                            {title}
                          </span>
                          <span className="mt-0.5 block text-[13px] leading-[1.35] text-[#959BB2]">
                            {body}
                          </span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </section>

          {/* The product shot: the operator view, playing. */}
          <section className="landing-product relative" id="product" aria-label="Live Scripture">
            <div className="landing-product-pin landing-stage-glow pb-[clamp(96px,13vw,200px)]">
              <div className={`${container} landing-shot max-w-[1280px]`}>
                <OperatorDemo />
              </div>
            </div>
          </section>

          {/* Why: the room, full-bleed, and one sentence that fills in as you scroll. */}
          <section className="landing-thesis relative" aria-label="Why Kairo">
            <div className="relative isolate flex min-h-[100svh] flex-col justify-center overflow-hidden py-[120px]">
              <Image
                src="/images/kairo-worship-hero.webp"
                alt=""
                fill
                sizes="100vw"
                className="-z-2 object-cover"
              />
              <div className="landing-thesis-shade absolute inset-0 -z-1" aria-hidden="true" />
              <div className={container}>
                <Thesis />
              </div>
            </div>
          </section>

          <section
            className="landing-screens relative isolate overflow-clip"
            id="screens"
            aria-labelledby="screens-title"
          >
            <div className={`landing-screens-pin relative ${section}`}>
              <div className={container}>
                <ScreenViews>
                  <p className={eyebrow}>Screens</p>
                  <h2 className={`${heading} mt-4`} id="screens-title" data-reveal="">
                    Every screen, its own job.
                  </h2>
                </ScreenViews>
              </div>
            </div>
          </section>

          <section
            className="landing-engage relative isolate overflow-clip"
            id="engage"
            aria-labelledby="engage-title"
          >
            <div className="landing-engage-pin relative py-[80px]">
              <div className={container}>
                <EngageStory>
                  <p className={eyebrow}>Engage</p>
                  <h2 className={`${heading} mt-4`} id="engage-title" data-reveal="">
                    The room asks. You choose what&apos;s shown.
                  </h2>
                </EngageStory>
              </div>
            </div>
          </section>

          <section className={section} aria-labelledby="features-title">
            <div className={container}>
              <div className="mx-auto max-w-[760px] text-center" data-reveal="">
                <p className={eyebrow}>Also in Kairo</p>
                <h2 className={`${heading} mt-4`} id="features-title">
                  Everything else Sunday needs.
                </h2>
              </div>
              <Stagger className="mt-[clamp(56px,7vw,96px)] grid grid-cols-1 gap-x-10 gap-y-10 min-[561px]:grid-cols-2 min-[1101px]:grid-cols-4 min-[1101px]:gap-y-12">
                {features.map(({ title, body, Icon }) => (
                  <li className="border-t border-white/[.09] pt-6" key={title}>
                    <span className="grid size-10 place-items-center rounded-xl bg-[#3B6BFF]/12 text-[#8AB4FF] ring-1 ring-[#8AB4FF]/20">
                      <Icon className="size-5" strokeWidth={1.65} aria-hidden="true" />
                    </span>
                    <h3 className="mt-5 text-[17px] font-semibold tracking-[-.015em] text-[#F2F3F7]">
                      {title}
                    </h3>
                    <p className="mt-1.5 text-[15px] leading-[1.5] text-[#9CA1B5]">{body}</p>
                  </li>
                ))}
              </Stagger>
            </div>
          </section>

          {/* The close: every build, in one place. */}
          <section className={`landing-stage-glow ${section} text-center`} aria-labelledby="get-title">
            <div className={`${container} flex flex-col items-center`} data-reveal="">
              <Image
                src="/brand/kairo-icon.png"
                alt=""
                width={88}
                height={88}
                className="rounded-[22px] shadow-[0_20px_50px_-12px_rgba(59,107,255,0.45),0_0_0_1px_rgba(255,255,255,0.12)]"
              />
              <h2 className={`${heading} mt-8`} id="get-title">
                Ready when Sunday is.
              </h2>
              <p className={`${lede} mt-5 max-w-[30em]`}>
                Kairo runs on Mac, Windows and Linux.
              </p>
              <div className="mt-10 w-full">
                <HeroDownload builds={downloads} id="get" />
              </div>
            </div>
          </section>

          <section
            className={`${container} ${section} pt-0`}
            id="questions"
            aria-labelledby="questions-title"
          >
            <div className="mx-auto max-w-[820px]">
            <h2 className={`${heading} text-center`} id="questions-title">
              Questions.
            </h2>
            <Stagger as="div" className="mt-[clamp(40px,5vw,64px)] border-t border-white/[.09]">
              {questions.map(({ question, answer }) => (
                <details className="landing-faq group border-b border-white/[.09]" key={question}>
                  <summary className="landing-press landing-press-soft flex cursor-pointer list-none items-center justify-between gap-5 py-6 text-[clamp(17px,1.4vw,19px)] font-medium tracking-[-.01em] text-[#ECE9E2] transition-colors duration-200 hover:text-white [&::-webkit-details-marker]:hidden">
                    {question}
                    <span
                      className="grid size-8 shrink-0 place-items-center rounded-full text-2xl leading-none font-normal text-[#8D93AD] transition-[transform,background-color,color] duration-300 ease-[var(--ease-spring)] group-hover:bg-white/[.06] group-hover:text-white group-open:rotate-45 motion-reduce:transition-colors"
                      aria-hidden="true"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mb-6 max-w-[640px] text-base leading-[1.6] text-[#A3A9BD]">
                    {answer}
                  </p>
                </details>
              ))}
            </Stagger>
            </div>
          </section>
        </main>

        <LandingFooter />
      </div>
      <StretchyFooter />
    </>
  );
}
