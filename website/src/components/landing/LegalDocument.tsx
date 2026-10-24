import { SubpageShell, subpageContainer as container } from "@/components/landing/SubpageShell";

/**
 * A legal page (privacy, terms) in the site's look: title and last-updated date,
 * then the sections as readable prose with a sticky contents list beside them
 * on wide screens. Sections link by id, so `/privacy#cookies` lands on one.
 */

export type LegalSection = { id: string; title: string; content: React.ReactNode };

const label = "text-[11px] font-bold tracking-[.18em] text-[#C3BFB7]";

const formatDate = (date: string): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export function LegalDocument({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  /** Last updated, YYYY-MM-DD. */
  updated: string;
  intro: React.ReactNode;
  sections: LegalSection[];
}): React.ReactElement {
  return (
    <SubpageShell>
      <section className="landing-stage-glow pt-[80px] pb-[50px] min-[701px]:pt-[130px] min-[701px]:pb-[80px]">
        <div className={container}>
          <p className={label}>LEGAL</p>
          <h1 className="mt-6 text-[clamp(44px,6vw,88px)] leading-[1] font-medium tracking-[-.06em]">
            {title}
          </h1>
          <p className="mt-6 text-sm text-[#7D8399]">
            Last updated <time dateTime={updated}>{formatDate(updated)}</time>
          </p>
        </div>
      </section>

      <div
        className={`${container} grid gap-10 border-t border-white/[.08] pt-10 pb-[100px] min-[901px]:grid-cols-[240px_minmax(0,1fr)] min-[901px]:gap-12 min-[901px]:pt-14 min-[701px]:pb-[150px]`}
      >
        <nav className="hidden self-start min-[901px]:sticky min-[901px]:top-10 min-[901px]:block" aria-label="On this page">
          <p className={label}>ON THIS PAGE</p>
          <ol className="mt-5 grid gap-2.5">
            {sections.map((section) => (
              <li key={section.id}>
                <a className="text-sm text-[#A3A9BD] hover:text-[#F2F3F7]" href={`#${section.id}`}>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="landing-prose max-w-[720px]">
          <div className="text-[18px] leading-[1.65] text-[#C9CEDF]">{intro}</div>
          {sections.map((section) => (
            <section className="mt-14 scroll-mt-8" id={section.id} key={section.id}>
              <h2>{section.title}</h2>
              {section.content}
            </section>
          ))}
        </div>
      </div>
    </SubpageShell>
  );
}
