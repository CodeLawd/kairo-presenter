import type { Metadata } from "next";
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
  BookOpen,
  Film,
  Languages,
  ListMusic,
  Presentation,
  Timer,
  Video,
  WifiOff,
} from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { HeroDownload } from "@/components/landing/HeroDownload";
import { SessionNavLink } from "@/components/landing/SessionNavLink";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { OperatorDemo } from "@/components/landing/OperatorDemo";
import { RotatingWord } from "@/components/landing/RotatingWord";
import { ScreenViews } from "@/components/landing/ScreenViews";
import { StretchyFooter } from "@/components/landing/StretchyFooter";
import { ThesisDots } from "@/components/landing/ThesisDots";
import "./landing.css";
import Image from "next/image";

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
const label = "text-[11px] font-bold tracking-[.18em] text-[#C3BFB7]";
const heading =
  "text-[clamp(36px,4vw,64px)] leading-[1.05] font-medium tracking-[-.055em]";
const hairline = "border-[#403F35]";

const downloads = [
  {
    name: "Apple silicon",
    system: "macOS",
    detail: "For Macs with M1 or later · macOS 11+",
    format: ".dmg",
    platform: "mac-arm64",
  },
  {
    name: "Intel Mac",
    system: "macOS",
    detail: "For Macs with an Intel processor · macOS 11+",
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

const thesis =
  "You can prepare the songs and readings. You can't predict every verse that comes up. Kairo helps you find it, check it, and put it on screen.";

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
    question: "Does it need the internet?",
    answer:
      "Kairo can run screens and use local media and built-in Bibles without internet. Live transcription uses Deepgram, so that part needs a connection.",
  },
];

function Thesis(): React.ReactElement {
  const total = thesis.replace(/ /g, "").length;
  let letter = 0;
  return (
    <p className="landing-thesis-text mt-7 max-w-[1180px] text-[clamp(34px,4.4vw,72px)] leading-[1.08] font-medium tracking-[-.05em]">
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
      <div
        className="landing min-h-screen bg-[#0A0B10] font-[var(--font-manrope)] text-[#F6F3EB]"
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
        <a
          className="absolute -top-20 left-6 z-[100] bg-white px-[18px] py-3 text-[#11120D] focus:top-3"
          href="#main"
        >
          Skip to content
        </a>
        <header
          className={`${container} absolute inset-x-0 top-0 z-5 flex h-[72px] items-center gap-5 min-[701px]:h-[88px] min-[701px]:gap-12`}
        >
          <Logo href="#top" priority />
          <nav
            className="m-auto hidden gap-[34px] min-[701px]:flex"
            aria-label="Main navigation"
          >
            {[
              ["Product", "#product"],
              ["Screens", "#screens"],
              ["Questions", "#questions"],
            ].map(([text, href]) => (
              <a
                className="text-sm font-medium text-[#EBE8E0] hover:underline hover:underline-offset-[5px]"
                href={href}
                key={href}
              >
                {text}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-6 min-[701px]:ml-0">
            <SessionNavLink />
          </div>
        </header>

        <main id="main">
          <section
            className="relative isolate flex h-auto min-h-[760px] flex-col justify-end overflow-hidden bg-[#08060b] min-[701px]:h-[max(680px,100svh)] min-[701px]:min-h-[min(840px,100svh)]"
            aria-labelledby="hero-title"
          >
            <Image
              src="/images/kairo-worship-hero.webp"
              alt=""
              fill
              priority
              sizes="100vw"
              className="landing-hero-photo object-cover"
            />
            <div
              className="landing-hero-shade absolute inset-0"
              aria-hidden="true"
            />
            <div
              className="landing-hero-dissolve pointer-events-none absolute inset-x-0 bottom-0 h-[45%]"
              aria-hidden="true"
            />
            <div
              className={`landing-hero-copy ${container} relative z-2 mb-[150px] min-[701px]:mb-[clamp(110px,18vh,190px)]`}
            >
              <p className={label} style={{ textTransform: "uppercase" }}>
                The future of presentations
              </p>
              <h1
                className="landing-hero-title font-black my-6 text-[clamp(38px,10vw,56px)] leading-[1] font-medium tracking-[-.06em] min-[701px]:text-[clamp(46px,5.4vw,88px)]"
                id="hero-title"
                aria-label="Church Presentations, Reimagined With AI."
              >
                <span className="landing-hero-line">
                  <span
                    className="landing-hero-word"
                    style={{ "--word-index": 0 } as React.CSSProperties}
                  >
                    Church
                  </span>{" "}
                  <span
                    className="landing-hero-word"
                    style={{ "--word-index": 1 } as React.CSSProperties}
                  >
                    Presentations,
                  </span>
                </span>
                <span className="landing-hero-line">
                  <span
                    className="landing-hero-word landing-hero-cue"
                    style={{ "--word-index": 2 } as React.CSSProperties}
                    aria-hidden="true"
                  >
                    <RotatingWord
                      words={["Reimagined", "Simplified", "Automated"]}
                    />
                  </span>{" "}
                  <span
                    className="landing-hero-word"
                    style={{ "--word-index": 3 } as React.CSSProperties}
                  >
                    With
                  </span>{" "}
                  <span
                    className="landing-hero-word text-[#8AB4FF]"
                    style={{ "--word-index": 4 } as React.CSSProperties}
                  >
                    AI.
                  </span>
                </span>
              </h1>
              <p className="max-w-200 text-[clamp(17px,1.4vw,20px)] leading-[1.55] text-[#DED9D2]">
                Kairo brings intelligence to every service, automatically
                detecting Scripture and simplifying presentations so you can
                focus on what matters most.
              </p>
              <HeroDownload builds={downloads} id="get" />
            </div>
          </section>

          <section
            className="landing-thesis relative overflow-clip"
            aria-label="Why Kairo"
          >
            <div className="pointer-events-none sticky top-0 -mb-[100svh] h-[100svh]">
              <ThesisDots />
            </div>
            <div
              className={`landing-thesis-pin ${container} relative z-1 py-[80px] min-[701px]:py-[140px]`}
            >
              <p className={label}>WHY KAIRO</p>
              <Thesis />
            </div>
          </section>

          <section
            className="landing-stage-glow py-[90px] min-[701px]:py-[150px]"
            id="product"
            aria-labelledby="product-title"
          >
            <div className={container}>
              <p className={label}>LIVE SCRIPTURE</p>
              <h2
                className={`${heading} mt-6 mb-10 max-w-[900px] min-[701px]:mb-14`}
                id="product-title"
                data-reveal=""
              >
                The pastor says it.{" "}
                <span className="text-[#7D8399]">Kairo puts it on screen.</span>
              </h2>
              <div data-reveal="">
                <OperatorDemo />
              </div>
            </div>
          </section>

          <section
            className="landing-screens relative isolate overflow-clip bg-[#0E1440]"
            id="screens"
            aria-labelledby="screens-title"
          >
            <div className="landing-screens-pin relative py-[80px] min-[701px]:py-[130px]">
              <div
                className="pointer-events-none absolute inset-0 -z-1 bg-[radial-gradient(ellipse_60%_70%_at_85%_20%,rgba(91,63,214,.35),transparent_70%),radial-gradient(ellipse_50%_60%_at_0%_100%,rgba(29,63,184,.35),transparent_70%)]"
                aria-hidden="true"
              />
              <div className={container}>
                <ScreenViews>
                  <p className={label}>SCREENS</p>
                  <h2
                    className={`${heading} mt-6`}
                    id="screens-title"
                    data-reveal=""
                  >
                    Every screen, its own job.
                  </h2>
                </ScreenViews>
              </div>
            </div>
          </section>

          <section
            className="bg-[#111319] py-[80px] min-[701px]:py-[130px]"
            aria-labelledby="features-title"
          >
            <div className={container}>
              <p className={label}>ALSO IN KAIRO</p>
              <h2
                className={`${heading} mt-6 mb-12 max-w-[760px] min-[701px]:mb-16`}
                id="features-title"
                data-reveal=""
              >
                Everything else Sunday needs.
              </h2>
              <ul
                className="grid grid-cols-1 gap-3 min-[561px]:grid-cols-2 min-[1101px]:grid-cols-4"
                data-reveal=""
              >
                {features.map(({ title, body, Icon }) => (
                  <li
                    className="flex items-start gap-4 rounded-2xl bg-[#181B23] p-5 transition-colors duration-300 hover:bg-[#1D212B] min-[561px]:flex-col min-[561px]:gap-0 min-[561px]:p-6 min-[701px]:p-7"
                    key={title}
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#3B6BFF]/15 text-[#8AB4FF] [&_svg]:size-5">
                      <Icon aria-hidden="true" />
                    </span>
                    <div className="min-[561px]:mt-8 min-[701px]:mt-12">
                      <h3 className="text-[17px] font-medium tracking-[-.025em] text-[#F2F3F7] min-[561px]:text-[18px]">
                        {title}
                      </h3>
                      <p className="mt-1 text-[15px] leading-[1.5] text-[#8D93AD] min-[561px]:mt-1.5">
                        {body}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section
            className={`${container} grid gap-[30px] py-[70px] min-[701px]:py-[120px] min-[901px]:grid-cols-[1fr_1.2fr] min-[901px]:gap-[70px]`}
            id="questions"
          >
            <div>
              <p className={label}>QUESTIONS</p>
              <h2 className={`${heading} mt-6`}>Good to know.</h2>
            </div>
            <div className={`mt-[42px] border-t min-[701px]:mt-0 ${hairline}`}>
              {questions.map(({ question, answer }) => (
                <details
                  className={`group border-b ${hairline}`}
                  key={question}
                >
                  <summary className="flex cursor-pointer list-none justify-between gap-5 py-[25px] text-[19px] [&::-webkit-details-marker]:hidden">
                    {question}
                    <span
                      className="text-2xl leading-none text-[#B1AEA5] transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none"
                      aria-hidden="true"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mb-[25px] max-w-[600px] text-base leading-[1.6] text-[#C1BEB5]">
                    {answer}
                  </p>
                </details>
              ))}
            </div>
          </section>
        </main>

        <LandingFooter />
      </div>
      <StretchyFooter />
    </>
  );
}
