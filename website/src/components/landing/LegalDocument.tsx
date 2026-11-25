import { SubpageShell, subpageContainer as container } from "@/components/landing/SubpageShell";

export type LegalSection = { id: string; title: string; content: React.ReactNode };

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
      <section className="mc-subpage-hero pt-[clamp(124px,15vh,172px)] pb-[clamp(64px,8vh,104px)] text-white">
        <div className={container}>
          <h1 className="max-w-[16ch] text-[clamp(40px,5.4vw,68px)] leading-[1.04] font-medium tracking-[-.036em] text-white">
            {title}
          </h1>
          <p className="mt-5 text-[15px] text-white/80">
            Last updated <time dateTime={updated}>{formatDate(updated)}</time>
          </p>
        </div>
      </section>

      <div
        className={`${container} grid gap-10 border-t border-[#EAECEF] pt-10 pb-[clamp(80px,10vw,132px)] min-[901px]:grid-cols-[240px_minmax(0,1fr)] min-[901px]:gap-12 min-[901px]:pt-14`}
      >
        <nav className="hidden self-start min-[901px]:sticky min-[901px]:top-24 min-[901px]:block" aria-label="On this page">
          <p className="text-[13px] font-semibold text-[#141518]">On this page</p>
          <ol className="mt-4 grid gap-2.5">
            {sections.map((section) => (
              <li key={section.id}>
                <a className="text-[14px] text-[#6B707C] transition-colors hover:text-[#1655F8]" href={`#${section.id}`}>
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="landing-prose max-w-[720px]">
          <div className="text-[17px] leading-[1.68] text-[#3F4450]">{intro}</div>
          {sections.map((section) => (
            <section className="mt-14 scroll-mt-24" id={section.id} key={section.id}>
              <h2>{section.title}</h2>
              {section.content}
            </section>
          ))}
        </div>
      </div>
    </SubpageShell>
  );
}
