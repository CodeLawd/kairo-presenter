import type { Metadata, Viewport } from "next";
import {
  isIndexable,
  siteUrl,
  siteName,
  siteTitle,
  siteDescription,
  socialImage,
} from "@/lib/seo";

import { HeroDownload } from "@/components/landing/HeroDownload";
import { SiteNav } from "@/components/landing/SiteNav";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { OperatorDemo } from "@/components/landing/OperatorDemo";
import { ScreenViews } from "@/components/landing/ScreenViews";
import { ImagineStory } from "@/components/landing/ImagineStory";
import { EngageStory } from "@/components/landing/EngageStory";
import { SundayBento } from "@/components/landing/SundayBento";
import { Reveal } from "@/components/landing/Reveal";
import Image from "next/image";
import "./landing.css";

export const viewport: Viewport = { themeColor: "#040920" };

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
  "mx-auto w-[calc(100%-40px)] max-w-[1200px] md:w-[calc(100%-64px)] xl:w-[calc(100%-96px)]";
const lightHeading =
  "text-[clamp(32px,3.8vw,48px)] leading-[1.08] font-medium tracking-[-.035em] text-[#141518] text-balance";
const section = "py-[clamp(80px,9vw,124px)]";

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
    detail: "64-bit · Windows 10+",
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

const boothSpecs = [
  { label: "Outputs", value: "Up to 4 NDI + displays" },
  { label: "Platforms", value: "macOS, Windows, Linux" },
  { label: "Offline Bibles", value: "KJV, BBE, BSB built in" },
  { label: "Congregation", value: "Browser Q&A & polls" },
] as const;

const questions = [
  {
    question: "Does Kairo run my screens directly?",
    answer:
      "Yes. Kairo runs the screens connected to your computer. You can also send up to four NDI feeds to a compatible switcher or stream.",
  },
  {
    question: "Does someone still need to manage what goes live?",
    answer:
      "Yes. Kairo suggests a verse as soon as it is spoken so your operator can check it before sending it live. Automatic output is optional.",
  },
  {
    question:
      "What if the pastor paraphrases instead of reading the reference?",
    answer:
      "Kairo matches passages from the spoken words even without a book and chapter, then lets your operator send the verse with one click.",
  },
  {
    question: "Can the congregation send questions during the service?",
    answer:
      "Yes. With Engage, people scan a QR code or enter a short code on the audience page to ask questions, upvote, and answer polls with no app or account. Moderators approve and reply from the web, and only your booth sends anything to screen.",
  },
  {
    question: "Does it need the internet?",
    answer:
      "Kairo runs screens, local media, and built-in Bibles offline. Live sermon transcription uses Deepgram, so that feature needs an internet connection.",
  },
];

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
        className="landing relative z-10 min-h-screen bg-white font-[var(--font-manrope)] text-[#141518]"
        id="top"
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
          {/* Band 1: Full-viewport atmospheric hero with subtly blended worship photo + white spec bar */}
          <div className="flex min-h-[100svh] flex-col bg-white">
            <section
              className="mc-hero relative isolate flex flex-1 flex-col justify-center overflow-hidden pt-[clamp(108px,14vh,164px)] pb-[clamp(80px,11vh,136px)] text-center text-white"
              aria-labelledby="hero-title"
            >
              {/* Faint atmospheric sanctuary photograph toning down the blue gradient */}
              <Image
                src="/images/hero-sanctuary.jpg"
                alt=""
                fill
                priority
                sizes="100vw"
                className="pointer-events-none -z-1 object-cover opacity-[0.28] mix-blend-luminosity [mask-image:linear-gradient(180deg,rgba(0,0,0,0.9)_0%,rgba(0,0,0,0.6)_65%,transparent_96%)]"
              />
              <div className={`${container} relative`}>
                <div className="landing-hero-copy flex flex-col items-center">
                  <h1
                    className="max-w-[20ch] text-[clamp(42px,5.6vw,72px)] leading-[1.05] font-medium tracking-[-.036em] text-white"
                    id="hero-title"
                  >
                    Every screen in sync.
                    <br />
                    Every verse on cue.
                  </h1>

                  <p className="mt-6 max-w-[48ch] text-[16px] leading-[1.6] text-white/85 text-pretty">
                    Kairo listens to the sermon live, stages Scripture before
                    you search, and runs sanctuary, stage, lobby, and NDI
                    screens from one booth computer.
                  </p>

                  <div className="mt-9">
                    <HeroDownload builds={downloads} variant="hero" />
                  </div>
                </div>
              </div>
            </section>

            {/* Crisp white booth spec bar anchored at the foot of the opening viewport */}
            <div className="bg-white pb-10">
              <div className={container}>
                <dl className="grid grid-cols-2 gap-6 border-t border-black/[.07] pt-7 text-left md:grid-cols-4">
                  {boothSpecs.map(({ label, value }) => (
                    <div key={label}>
                      <dt className="text-[13px] font-medium text-[#6B707C]">
                        {label}
                      </dt>
                      <dd className="mt-1 text-[15px] font-medium tracking-[-.01em] text-[#141518]">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>

          {/* Band 2: Dark Charcoal Minimalist Live Scripture Split */}
          <section
            className={`relative bg-[#16161A] text-white ${section}`}
            id="product"
            aria-labelledby="product-title"
          >
            <div className={container}>
              <OperatorDemo />
            </div>
          </section>

          {/* Editorial Worship Room Photograph Interlude */}
          <section className="relative isolate overflow-hidden bg-[#0A0B10]" aria-label="Why Kairo">
            <div className="relative flex min-h-[400px] flex-col justify-center py-24 md:min-h-[500px] md:py-32">
              <Image
                src="/images/kairo-worship-hero.webp"
                alt=""
                fill
                sizes="100vw"
                className="-z-2 object-cover"
              />
              <div
                className="pointer-events-none absolute inset-0 -z-1 bg-[linear-gradient(180deg,#16161A_0%,rgba(10,13,26,0.58)_22%,rgba(10,13,26,0.68)_78%,rgba(10,13,26,0.88)_100%)]"
                aria-hidden="true"
              />
              <div className={container}>
                <Reveal>
                  <p className="mx-auto max-w-[900px] text-center text-[clamp(26px,3.6vw,48px)] leading-[1.15] font-medium tracking-[-.032em] text-white text-balance">
                    Services don&apos;t always go to plan. A verse nobody
                    scheduled. A song that keeps going. Kairo listens, and keeps
                    up.
                  </p>
                </Reveal>
              </div>
            </div>
          </section>

          {/* Band 3: Light Mode — Sticky-Pinned Screens Showcase */}
          <ScreenViews>
            <h2 className={lightHeading} id="screens-title">
              Every screen, its own job.{" "}
              <span className="text-[#787D8A]">One booth computer.</span>
            </h2>
          </ScreenViews>

          {/* Band 4: Dark Charcoal — Sticky-Pinned Kairo Imagine Studio */}
          <ImagineStory />

          {/* Band 5: Light Mode — Sticky-Pinned Engage */}
          <EngageStory>
            <h2 className={lightHeading} id="engage-title">
              The room asks.{" "}
              <span className="text-[#787D8A]">
                You choose what&apos;s shown.
              </span>
            </h2>
          </EngageStory>

          {/* Band 6: Light Mode — Sticky-Scroll MindCloud Asymmetric Bento */}
          <SundayBento />

          {/* Band 6: Light Mode — FAQ */}
          <section
            className={`border-t border-[#EAECEF] bg-white ${section}`}
            id="questions"
            aria-labelledby="questions-title"
          >
            <div className={`${container} grid gap-12 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:items-start lg:gap-16`}>
              <div className="lg:sticky lg:top-28">
                <h2 className={lightHeading} id="questions-title">
                  Common booth questions.
                </h2>
                <p className="mt-4 max-w-[36ch] text-[16px] leading-[1.6] text-[#6B707C]">
                  How Kairo handles screens, offline reliability, and live
                  moderation.
                </p>
              </div>
              <div className="border-t border-[#EAECEF]">
                {questions.map(({ question, answer }) => (
                  <details
                    className="landing-faq group border-b border-[#EAECEF]"
                    key={question}
                  >
                    <summary className="landing-press landing-press-soft flex min-h-14 cursor-pointer list-none items-center justify-between gap-5 py-5 text-[16px] font-medium tracking-[-.01em] text-[#141518] transition-colors duration-150 hover:text-[#1655F8] [&::-webkit-details-marker]:hidden">
                      {question}
                      <span
                        className="grid size-8 shrink-0 place-items-center text-xl leading-none font-light text-[#6B707C] transition-[transform,color] duration-250 ease-[var(--ease-spring)] group-hover:text-[#141518] group-open:rotate-45"
                        aria-hidden="true"
                      >
                        +
                      </span>
                    </summary>
                    <p className="mb-6 max-w-[60ch] text-[15.5px] leading-[1.65] text-[#5C616E]">
                      {answer}
                    </p>
                  </details>
                ))}
              </div>
            </div>
          </section>

          {/* Band 7: Electric Royal Blue Closing CTA Card (MindCloud signature closer) */}
          <section
            className="bg-white pb-[clamp(80px,9vw,124px)]"
            aria-labelledby="get-title"
          >
            <div className={container}>
              <Reveal>
                <div className="mc-cta-card relative overflow-hidden rounded-[24px] px-7 py-14 text-white shadow-[0_32px_80px_-28px_rgba(20,86,246,0.45)] sm:px-14 sm:py-20">
                  <div className="relative z-10 max-w-[640px]">
                    <h2
                      className="text-[clamp(32px,4vw,52px)] leading-[1.08] font-medium tracking-[-.035em] text-white text-balance"
                      id="get-title"
                    >
                      Ready for Sunday?
                      <br />
                      Download Kairo 2.0.
                    </h2>
                    <p className="mt-4 max-w-[44ch] text-[16px] leading-[1.6] text-white/80">
                      Native builds for Apple silicon, Intel Mac, Windows, and
                      Linux.
                    </p>
                    <div className="mt-8">
                      <HeroDownload builds={downloads} id="get" />
                    </div>
                  </div>
                </div>
              </Reveal>
            </div>
          </section>
        </main>

        <LandingFooter light />
      </div>
    </>
  );
}
