import type { Metadata } from "next";
import Image from "next/image";
import {
  SubpageShell,
  subpageContainer as container,
} from "@/components/landing/SubpageShell";
import { changelog } from "@/lib/changelog";
import { isIndexable, siteName, socialImage } from "@/lib/seo";

const description =
  "What's new in Kairo Presenter: the features and fixes in every release, newest first.";

export const metadata: Metadata = {
  title: "Changelog",
  description,
  alternates: { canonical: "/changelog" },
  robots: { index: isIndexable, follow: true },
  openGraph: {
    title: `Changelog · ${siteName}`,
    description,
    url: "/changelog",
    siteName,
    type: "website",
    locale: "en_US",
    images: [socialImage],
  },
};

const formatDate = (date: string): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export default function ChangelogPage(): React.ReactElement {
  return (
    <SubpageShell>
      <section className="mc-subpage-hero relative isolate overflow-hidden pt-[clamp(124px,15vh,172px)] pb-[clamp(64px,8vh,104px)] text-white">
        <Image
          src="/images/changelog-booth.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="pointer-events-none -z-1 object-cover opacity-[0.28] mix-blend-luminosity [mask-image:linear-gradient(180deg,rgba(0,0,0,0.9)_0%,rgba(0,0,0,0.6)_65%,transparent_96%)]"
        />
        <div className={`${container} relative`}>
          <h1 className="max-w-[16ch] text-[clamp(40px,5.4vw,68px)] leading-[1.04] font-medium tracking-[-.036em] text-white">
            What&apos;s new in Kairo.
          </h1>
          <p className="mt-5 max-w-[48ch] text-[16px] leading-[1.6] text-white/85">
            New features and fixes in every release, newest first.
          </p>
        </div>
      </section>

      <ol className={`${container} pb-[clamp(80px,10vw,132px)]`}>
        {changelog.map((entry, i) => (
          <li
            className="grid gap-5 border-t border-[#EAECEF] py-10 min-[901px]:grid-cols-[240px_minmax(0,1fr)] min-[901px]:gap-12 min-[901px]:py-14"
            id={`v${entry.version.replaceAll(".", "-")}`}
            key={entry.version}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 self-start min-[901px]:sticky min-[901px]:top-24 min-[901px]:flex-col min-[901px]:items-start">
              <span className="flex items-center gap-2.5">
                <span className="text-[15px] font-semibold tabular-nums text-[#141518]">
                  v{entry.version}
                </span>
                {i === 0 && (
                  <span className="rounded-full bg-[#1655F8]/10 px-2.5 py-0.5 text-[12px] font-semibold text-[#1655F8]">
                    Latest
                  </span>
                )}
              </span>
              <time className="text-[14px] text-[#6B707C]" dateTime={entry.date}>
                {formatDate(entry.date)}
              </time>
            </div>
            <div>
              <h2 className="text-[clamp(22px,2.2vw,30px)] leading-[1.18] font-medium tracking-[-.028em] text-[#141518]">
                {entry.title}
              </h2>
              <ul className="mt-5 grid max-w-[660px] gap-3">
                {entry.notes.map((note) => (
                  <li
                    className="flex gap-3 text-[16px] leading-[1.62] text-[#5C616E]"
                    key={note}
                  >
                    <span
                      className="mt-[.68em] size-1.5 shrink-0 rounded-full bg-[#1655F8]"
                      aria-hidden="true"
                    />
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </SubpageShell>
  );
}
