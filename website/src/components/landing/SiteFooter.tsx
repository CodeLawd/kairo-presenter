import Link from "next/link";
import { Wordmark } from "@/components/brand/Wordmark";
import { IconArrow } from "./icons";
import { btn, btnGhost, cx, wrap } from "./primitives";

/**
 * Columns of real destinations only.
 *
 * Both reference sites run four or five columns, but they have a blog, docs, a
 * store and a support site to fill them. Kairo has three routes and a handful
 * of anchors, so inventing /docs and /terms here would only ship dead links.
 * Add a column when there is something to put in it.
 */
const COLUMNS: { heading: string; links: { href: string; label: string }[] }[] =
  [
    {
      heading: "Product",
      links: [
        { href: "#how", label: "How it works" },
        { href: "#features", label: "Features" },
        { href: "#privacy", label: "Privacy" },
        { href: "#faq", label: "FAQ" },
      ],
    },
    {
      heading: "Account",
      links: [
        { href: "/signup", label: "Create an account" },
        { href: "/login", label: "Sign in" },
      ],
    },
  ];

const linkClass = "text-[13.5px] text-mute transition-colors hover:text-paper";

export function SiteFooter(): React.ReactElement {
  return (
    <footer className="border-t border-line-soft pb-[38px] pt-[clamp(48px,6vw,76px)]">
      <div className={wrap}>
        <div className="grid gap-x-[clamp(32px,6vw,96px)] gap-y-[clamp(36px,5vw,52px)] min-[760px]:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))]">
          {/* Identity and the one thing we want from a reader down here. */}
          <div>
            <Wordmark href="#top" />
            <p className="m-0 mt-4 max-w-[30ch] text-[14.5px] leading-[1.6] text-mute">
              Scripture on the screen before you could type it. A desktop app
              for church tech teams.
            </p>
            <a className={cx(btn, btnGhost, "mt-6")} href="#get">
              Get early access <IconArrow />
            </a>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h2 className="m-0 font-mono text-[10.5px] uppercase tracking-[0.2em] text-faint">
                {col.heading}
              </h2>
              <ul className="m-0 mt-4 grid list-none gap-[11px] pl-0">
                {col.links.map((item) => (
                  <li key={item.href}>
                    {item.href.startsWith("/") ? (
                      <Link className={linkClass} href={item.href}>
                        {item.label}
                      </Link>
                    ) : (
                      <a className={linkClass} href={item.href}>
                        {item.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* Legal sits on its own line under a rule, not mixed in with the nav. */}
        <div className="mt-[clamp(40px,5vw,60px)] flex flex-col gap-3 border-t border-line-soft pt-[22px] min-[760px]:flex-row min-[760px]:items-baseline min-[760px]:justify-between">
          <p className="m-0 flex-none font-mono text-[10.5px] text-faint">
            © {new Date().getFullYear()} Kairo
          </p>
        </div>
      </div>
    </footer>
  );
}
