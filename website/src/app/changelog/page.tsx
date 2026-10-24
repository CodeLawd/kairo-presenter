import type { Metadata } from "next";
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

const label = "text-[11px] font-bold tracking-[.18em] text-[#C3BFB7]";

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
      <section className="landing-stage-glow pt-[80px] pb-[50px] min-[701px]:pt-[130px] min-[701px]:pb-[80px]">
        <div className={container}>
          <p className={label}>CHANGELOG</p>
          <h1 className="mt-6 text-[clamp(44px,6vw,88px)] leading-[1] font-medium tracking-[-.06em]">
            What&apos;s new in Kairo.
          </h1>
          <p className="mt-6 max-w-[520px] text-[clamp(17px,1.4vw,20px)] leading-[1.55] text-[#A3A9BD]">
            New features and fixes in every release, newest first.
          </p>
        </div>
      </section>

      <ol className={`${container} pb-[100px] min-[701px]:pb-[150px]`}>
        {changelog.map((entry, i) => (
          <li
            className="grid gap-5 border-t border-white/[.08] py-10 min-[901px]:grid-cols-[240px_minmax(0,1fr)] min-[901px]:gap-12 min-[901px]:py-14"
            id={`v${entry.version.replaceAll(".", "-")}`}
            key={entry.version}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 self-start min-[901px]:sticky min-[901px]:top-10 min-[901px]:flex-col min-[901px]:items-start">
              <span className="flex items-center gap-2.5">
                <span className="text-[15px] font-semibold tabular-nums">
                  v{entry.version}
                </span>
                {i === 0 && (
                  <span className="rounded-full bg-[#3B6BFF]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#8AB4FF]">
                    Latest
                  </span>
                )}
              </span>
              <time className="text-sm text-[#7D8399]" dateTime={entry.date}>
                {formatDate(entry.date)}
              </time>
            </div>
            <div>
              <h2 className="text-[clamp(24px,2.4vw,34px)] leading-[1.15] font-medium tracking-[-.04em]">
                {entry.title}
              </h2>
              <ul className="mt-5 grid max-w-[680px] gap-3">
                {entry.notes.map((note) => (
                  <li
                    className="flex gap-3 text-[16px] leading-[1.6] text-[#A3A9BD]"
                    key={note}
                  >
                    <span
                      className="mt-[.7em] size-1.5 shrink-0 rounded-full bg-[#8AB4FF]"
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
