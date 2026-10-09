/**
 * Class recipes shared across the landing sections.
 *
 * These are plain strings rather than CSS classes so the whole page stays
 * greppable and Tailwind's scanner can see every utility it needs to emit.
 */

export const cx = (...parts: (string | false | undefined | null)[]): string =>
  parts.filter(Boolean).join(' ')

export const wrap = 'mx-auto w-full max-w-[1320px] px-[clamp(20px,5vw,64px)]'
export const section = 'relative py-[clamp(72px,8vw,120px)]'
export const feature = 'relative py-[clamp(64px,7vw,104px)]'
export const display =
  'm-0 font-display font-extrabold leading-[1.04] tracking-[-0.035em] text-paper'
/**
 * The light-weight opening clause in a headline. Used twice — the hero and the
 * closing CTA — so the two ends of the page rhyme. It previously ran on all six
 * h2s, at which point a device stops being a motif and becomes a tic.
 */
export const thin = 'font-light text-dim'
export const lede = 'm-0 max-w-[46ch] text-[17px] leading-[1.65] text-dim'

export const btn =
  'inline-flex items-center gap-[9px] rounded-full border border-transparent px-6 py-[13px] font-display text-sm font-semibold tracking-[-0.01em] transition duration-200 hover:-translate-y-px active:translate-y-0 motion-reduce:transform-none [&_svg]:h-[15px] [&_svg]:w-[15px] [&_svg]:flex-none'
export const btnPrimary = 'bg-paper text-ink hover:bg-[#E7E4DC]'
export const btnGhost =
  'border-line bg-paper/5 text-paper hover:border-paper/15 hover:bg-paper/10'

/** The bordered icon tile at the top of a privacy card. */
export const iconTile =
  'grid h-[30px] w-[30px] place-items-center rounded-lg border border-accent/25 bg-accent/[0.1] text-accent [&_svg]:h-[15px] [&_svg]:w-[15px]'

/** The soft-topped card used by the "more" and privacy grids. */
export const card =
  'rounded-xl border border-line-soft bg-gradient-to-b from-paper/[0.022] to-transparent p-[26px]'
