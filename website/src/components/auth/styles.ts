/**
 * Class recipes for the auth forms.
 *
 * Same idiom as the landing page's primitives: exported strings rather than CSS
 * classes, so there is one styling language across the whole site and Tailwind
 * can see every utility it needs to emit.
 */

export const field = 'block'

export const label =
  'mb-1.5 block font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint'

export const input =
  'w-full rounded-[10px] border border-line bg-paper/5 px-[14px] py-[11px] text-[14.5px] text-paper transition-colors placeholder:text-faint focus:border-accent/50 focus:bg-accent/5 focus:outline-none disabled:opacity-50'

/** The device-pairing code: wide tracking, centred, monospaced. */
export const codeInput = `${input} text-center font-mono text-[20px] uppercase tracking-[0.18em]`

const btnBase =
  'inline-flex w-full items-center justify-center gap-[9px] rounded-full border border-transparent px-6 py-[13px] font-display text-sm font-semibold tracking-[-0.01em] transition duration-200 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:h-[15px] [&_svg]:w-[15px] [&_svg]:flex-none'

export const btnPrimary = `${btnBase} bg-paper text-ink hover:bg-[#E7E4DC] disabled:hover:bg-paper`
export const btnSecondary = `${btnBase} border-line bg-paper/5 text-paper hover:border-paper/15 hover:bg-paper/10`

/** Inline text button — "Forgot password", "Create one instead". */
export const linkBtn =
  'text-[13px] text-mute underline-offset-2 transition-colors hover:text-paper hover:underline focus-visible:text-paper disabled:opacity-50'

/** Form status line. Rendered only when there is something to say. */
export const msg = 'm-0 text-[13px] leading-relaxed'
export const msgError = 'text-[#fb7185]'
export const msgOk = 'text-accent'
