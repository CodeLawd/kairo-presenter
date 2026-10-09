import { IconArrow } from "./icons";
import { FACTS } from "./content";
import { btn, btnGhost, btnPrimary, cx, thin, wrap } from "./primitives";

/**
 * The hero sits on a warm CSS field rather than a photograph — see the note
 * above `@utility field` in globals.css for why. The field itself is rendered
 * at the page root, not here: it has to pass behind the sticky header, and a
 * backdrop owned by this section would be clipped to it.
 *
 * It holds a viewport-scaled minimum height and centers within it, so the fold
 * belongs to the headline rather than to the section under it. `svh` rather
 * than `vh`: on mobile the URL bar collapsing must not resize the hero.
 *
 * The copy is an eyebrow, a headline, one sentence and two buttons. What used
 * to be a third paragraph here is now the "How it works" section, where it does
 * more work.
 */
export function Hero(): React.ReactElement {
  return (
    <>
      <section className="relative flex min-h-[clamp(560px,78svh,840px)] items-center">
        <div
          className={cx(
            wrap,
            "relative z-10 py-[clamp(56px,8vw,96px)] text-center",
          )}
        >
          <p className="m-0 font-mono text-[11px] uppercase tracking-[0.22em] text-accent">
            For church tech teams
          </p>

          <h1 className="mx-auto mt-[18px] max-w-[17ch] font-display text-[clamp(42px,6.6vw,86px)] font-extrabold leading-[1.02] tracking-[-0.045em]">
            <span className={thin}>Your pastor says the verse.</span> It&rsquo;s
            already on screen.
          </h1>

          <p className="mx-auto mt-6 max-w-[42ch] font-display text-[clamp(17px,2.1vw,24px)] font-light leading-[1.4] tracking-[-0.02em] text-[#939086]">
            Kairo hears the reference — even a paraphrase — and has the slide
            waiting{" "}
            <b className="font-bold text-paper">before you could type it</b>.
          </p>

          <div className="mt-[34px] flex flex-wrap justify-center gap-3">
            <a className={cx(btn, btnPrimary)} href="#get">
              Get early access <IconArrow />
            </a>
            <a className={cx(btn, btnGhost)} href="#how">
              See how it works
            </a>
          </div>

          <p className="mt-[26px] font-mono text-[11px] tracking-[0.04em] text-mute">
            Free in early access
            <i className="mx-[0.6em] not-italic text-[#33332B]">·</i>
            macOS and Windows
            <i className="mx-[0.6em] not-italic text-[#33332B]">·</i>
            ProPresenter 7 and NDI
          </p>
        </div>
      </section>

      {/* Three fixed facts. This was a scrolling marquee of eleven feature
          names, which asked to be read and then moved before you could. */}
      <div className="border-y border-line-soft">
        <ul
          className={cx(
            wrap,
            "my-0 flex list-none flex-wrap justify-center gap-x-[clamp(24px,5vw,72px)] gap-y-2 py-[15px] pl-0 sm:justify-between",
          )}
        >
          {FACTS.map((fact) => (
            <li
              key={fact}
              className="inline-flex items-center gap-3 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.18em] text-faint before:block before:h-1 before:w-1 before:rounded-full before:bg-accent-dim before:opacity-80"
            >
              {fact}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
